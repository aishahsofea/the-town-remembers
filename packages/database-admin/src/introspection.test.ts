import { describe, expect, it } from "vitest";

import {
  findForeignKeysMissingTownScope,
  normalizeIndexDefinition,
  type SchemaSnapshot,
} from "./introspection.js";

function snapshotWith(constraints: Record<string, string>): SchemaSnapshot {
  return {
    tables: {
      episodes: { columns: {}, constraints, indexes: {} },
    },
    views: [],
  };
}

describe("index normalization", () => {
  it("removes the database qualifier so snapshots compare across targets", () => {
    expect(
      normalizeIndexDefinition(
        "CREATE INDEX ix ON ttr_test_abc123def456.public.episodes USING btree (town_id)",
        "ttr_test_abc123def456",
      ),
    ).toBe("CREATE INDEX ix ON public.episodes USING btree (town_id)");
  });
});

describe("town-scoped foreign keys", () => {
  it("accepts a key that carries town_id on both sides", () => {
    expect(
      findForeignKeysMissingTownScope(
        snapshotWith({
          fk_episodes__npc:
            "FOREIGN KEY (town_id, npc_id) REFERENCES npcs(town_id, id)",
        }),
        [],
      ),
    ).toStrictEqual([]);
  });

  it("names a key that would let one town reach another's rows", () => {
    expect(
      findForeignKeysMissingTownScope(
        snapshotWith({
          fk_episodes__npc: "FOREIGN KEY (npc_id) REFERENCES npcs(id)",
        }),
        [],
      ),
    ).toStrictEqual(["episodes.fk_episodes__npc"]);
  });

  it("reports a definition it cannot parse rather than passing it", () => {
    // Silence here would be the dangerous outcome: an unrecognized shape would
    // look like a compliant key.
    expect(
      findForeignKeysMissingTownScope(
        snapshotWith({ fk_odd: "FOREIGN KEY something unexpected" }),
        [],
      ),
    ).toStrictEqual(["episodes.fk_odd (unparsed: FOREIGN KEY something unexpected)"]);
  });

  it("exempts the deliberately global tables", () => {
    expect(
      findForeignKeysMissingTownScope(
        snapshotWith({ fk_x: "FOREIGN KEY (npc_id) REFERENCES npcs(id)" }),
        ["episodes"],
      ),
    ).toStrictEqual([]);
  });

  it("ignores constraints that are not foreign keys", () => {
    expect(
      findForeignKeysMissingTownScope(
        snapshotWith({ pk_episodes: "PRIMARY KEY (town_id ASC, id ASC)" }),
        [],
      ),
    ).toStrictEqual([]);
  });
});
