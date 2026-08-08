import { Kysely, PostgresDialect, type Insertable, type Updateable } from "kysely";
import { describe, expect, it } from "vitest";

import { asUtc, asUuid, decodeVector, encodeVector, asVector256 } from "./brands.js";
import type { Database, EpisodesTable, WorldEventsTable } from "./schema.js";

/**
 * A builder with no pool behind it. Every assertion here is about the types the
 * schema produces, and a query that is never executed still has to compile.
 */
function builder(): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: undefined as never }),
  });
}

describe("the generated database interface", () => {
  it("compiles a town-scoped select with branded identity", () => {
    const query = builder()
      .selectFrom("public.episodes")
      .select(["id", "summary", "embedding_status"])
      .where("town_id", "=", asUuid("11111111-1111-1111-1111-111111111111"))
      .where("embedding_status", "=", "ready")
      .compile();

    expect(query.sql).toContain("episodes");
    expect(query.parameters).toHaveLength(2);
  });

  it("reads the inspection views without offering a way to write them", () => {
    const query = builder()
      .selectFrom("inspection.npc_beliefs")
      .select(["npc_key", "label", "score"])
      .compile();
    expect(query.sql).toContain("inspection");
  });

  it("permits the one accepted episode update", () => {
    const update: Updateable<EpisodesTable> = {
      embedding: asVector256(Array.from({ length: 256 }, () => 0.5)),
      embedding_status: "ready",
    };
    expect(Object.keys(update).toSorted()).toStrictEqual([
      "embedding",
      "embedding_status",
    ]);
  });

  it("refuses to edit what an NPC experienced", () => {
    const update: Updateable<EpisodesTable> = {};
    // @ts-expect-error an episode's summary is immutable once written
    update.summary = "rewritten";
    expect(update).toBeDefined();
  });

  it("refuses to edit causal history at all", () => {
    const update: Updateable<WorldEventsTable> = {};
    // @ts-expect-error world_events is append-only; nothing about it may change
    update.event_type = "travelled";
    expect(update).toBeDefined();
  });

  it("refuses a closed domain value the database would reject", () => {
    const insert = {
      episode_kind: "direct_observation",
      // @ts-expect-error `settled` is not an embedding status
      embedding_status: "settled",
    } satisfies Partial<Insertable<EpisodesTable>>;
    expect(insert.episode_kind).toBe("direct_observation");
  });

  it("keeps a UUID and a display name from being confused", () => {
    const townId = asUuid("11111111-1111-1111-1111-111111111111");
    const insert: Pick<Insertable<EpisodesTable>, "town_id" | "occurred_at"> = {
      town_id: townId,
      occurred_at: asUtc(new Date()),
    };
    // @ts-expect-error a bare string is not a generated identity
    insert.town_id = "mara_venn";
    expect(insert.occurred_at).toBeInstanceOf(Date);
  });
});

describe("vector encoding", () => {
  it("round-trips through the text form the driver accepts", () => {
    const original = asVector256([0.5, -1, 0]);
    expect(encodeVector(original)).toBe("[0.5,-1,0]");
    expect(decodeVector(encodeVector(original))).toStrictEqual([0.5, -1, 0]);
  });

  it("decodes an empty vector without inventing a zero", () => {
    expect(decodeVector("[]")).toStrictEqual([]);
  });
});
