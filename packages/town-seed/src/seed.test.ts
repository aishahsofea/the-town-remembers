import { createHash } from "node:crypto";

import { BELL_MYSTERY_V1, CLAIM_ENTITY_MATRIX } from "@the-town-remembers/content";
import { CLAIM_ENTITY_MATRIX as DATABASE_CLAIM_MATRIX } from "@the-town-remembers/database";
import {
  useSharedTestDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { materializeTown } from "./materialize.js";
import { planTown } from "./plan.js";
import { summarizeTown } from "./summary.js";

const CREATED_AT = new Date("2026-08-08T12:00:00.000Z");

function inviteHash(salt: string): Uint8Array {
  return createHash("sha256").update(salt).digest();
}

describe("shared claim matrix", () => {
  it("agrees between the authored content and the migrated schema", () => {
    // Content cannot import the database package, so this is where the two
    // declarations of the predicate/type matrix are held to each other.
    expect(CLAIM_ENTITY_MATRIX).toStrictEqual(DATABASE_CLAIM_MATRIX);
  });
});

describe("planning a town", () => {
  it("is deterministic except for generated identities", () => {
    const first = planTown(BELL_MYSTERY_V1, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("a"),
    });
    const second = planTown(BELL_MYSTERY_V1, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("b"),
    });

    expect(first.townId).not.toBe(second.townId);
    expect(first.lastEventSequence).toBe(second.lastEventSequence);
    expect([...first.ids.keys()]).toStrictEqual([...second.ids.keys()]);
    // No generated identity is shared between two towns.
    const shared = [...first.ids.values()].filter((value) =>
      new Set(second.ids.values()).has(value),
    );
    expect(shared).toStrictEqual([]);
  });

  it("refuses to plan against a registry missing a character", () => {
    expect(() =>
      planTown(
        { ...BELL_MYSTERY_V1, characters: [] },
        {
          contentVersion: "bell-mystery-v1",
          createdAt: CREATED_AT,
          inviteTokenHash: inviteHash("a"),
        },
      ),
    ).toThrow(/has no character/);
  });

  it("refuses to plan when a reference cannot be resolved", () => {
    expect(() =>
      planTown(
        { ...BELL_MYSTERY_V1, storyEntities: [] },
        {
          contentVersion: "bell-mystery-v1",
          createdAt: CREATED_AT,
          inviteTokenHash: inviteHash("a"),
        },
      ),
    ).toThrow(/unresolved reference/);
  });

  it("refuses a version the registry does not describe", () => {
    expect(() =>
      planTown(BELL_MYSTERY_V1, {
        contentVersion: "bell-mystery-v2",
        createdAt: CREATED_AT,
        inviteTokenHash: inviteHash("a"),
      }),
    ).toThrow(/does not match/);
  });

  it("places every seed event before the town exists", () => {
    const plan = planTown(BELL_MYSTERY_V1, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("a"),
    });
    for (const event of plan.worldEvents) {
      expect((event["occurred_at"] as Date).getTime()).toBeLessThan(
        CREATED_AT.getTime(),
      );
      expect(event["ambient_eligible"]).toBe(false);
      expect(event["origin_kind"]).toBe("system_seed");
      expect(event["player_action_id"]).toBeNull();
      expect(event["ambient_job_execution_id"]).toBeNull();
    }
  });
});

describe.skipIf(!shouldRunDatabaseTests())("materializing a town", () => {
  let handle: DisposableDatabase | undefined;
  let townId: string;

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("seed"),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = result.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  async function count(table: string): Promise<number> {
    const result = await database().pool.query<{ count: number }>(
      `SELECT count(*)::INT8 AS count FROM public.${table} WHERE town_id = $1`,
      [townId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  it("writes exactly the authored inventory", async () => {
    await expect(count("story_entities")).resolves.toBe(15);
    await expect(count("actors")).resolves.toBe(3);
    await expect(count("npcs")).resolves.toBe(3);
    await expect(count("npc_contact_edges")).resolves.toBe(4);
    await expect(count("claims")).resolves.toBe(12);
    await expect(count("claim_relations")).resolves.toBe(6);
    await expect(count("world_facts")).resolves.toBe(8);
    await expect(count("case_solutions")).resolves.toBe(1);
    await expect(count("items")).resolves.toBe(4);
    await expect(count("inspectables")).resolves.toBe(8);
    await expect(count("clues")).resolves.toBe(7);
    await expect(count("clue_claim_effects")).resolves.toBe(12);
    await expect(count("world_events")).resolves.toBe(11);
    await expect(count("episodes")).resolves.toBe(11);
    await expect(count("episode_references")).resolves.toBe(39);
    await expect(count("claim_transmissions")).resolves.toBe(2);
    await expect(count("belief_evidence")).resolves.toBe(19);
    await expect(count("npc_beliefs")).resolves.toBe(19);
  });

  it("creates no player, visit, action, or discovery", async () => {
    for (const table of [
      "players",
      "player_visits",
      "player_actions",
      "player_sessions",
      "clue_discoveries",
      "case_board_entries",
      "promises",
      "outbox",
    ]) {
      await expect(count(table), table).resolves.toBe(0);
    }
  });

  it("stores every claim under its frozen claim-key:v1 representation", async () => {
    const rows = await database().pool.query<{
      entity_key: string;
      normalized_key: string;
    }>(
      `SELECT s.entity_key, c.normalized_key
         FROM public.claims c
         JOIN public.story_entities s
           ON s.town_id = c.town_id AND s.id = c.subject_entity_id
        WHERE c.town_id = $1
        ORDER BY c.normalized_key`,
      [townId],
    );
    const stored = new Set(rows.rows.map((row) => row.normalized_key));
    for (const expected of BELL_MYSTERY_V1.normalizedKeys.values()) {
      expect(stored.has(expected), expected).toBe(true);
    }
  });

  it("closes the ambient boundary through the final seed event", async () => {
    const row = await database().pool.query<{
      last_event_sequence: number;
      ambient_scheduled_through_sequence: number;
    }>(
      `SELECT last_event_sequence, ambient_scheduled_through_sequence
         FROM public.towns WHERE id = $1`,
      [townId],
    );
    expect(Number(row.rows[0]?.last_event_sequence)).toBe(11);
    expect(Number(row.rows[0]?.ambient_scheduled_through_sequence)).toBe(11);

    // The first player departure therefore begins strictly after the backstory
    // and cannot propagate it as new activity.
    const eligible = await database().pool.query(
      "SELECT 1 FROM public.world_events WHERE town_id = $1 AND ambient_eligible",
      [townId],
    );
    expect(eligible.rowCount).toBe(0);
  });

  it("numbers the seed events one to eleven with derived effect keys", async () => {
    const rows = await database().pool.query<{
      sequence_no: number;
      effect_key: string;
      origin_kind: string;
    }>(
      `SELECT sequence_no, effect_key, origin_kind FROM public.world_events
        WHERE town_id = $1 ORDER BY sequence_no`,
      [townId],
    );
    expect(rows.rows.map((row) => Number(row.sequence_no))).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    for (const row of rows.rows) {
      expect(row.origin_kind).toBe("system_seed");
      expect(row.effect_key).toMatch(/^seed:bell-mystery-v1:[a-z_]+$/);
    }
  });

  it("reproduces every authored belief score and label", async () => {
    const rows = await database().pool.query<{
      npc: string;
      claim: string;
      score: number;
      label: string;
    }>(
      `SELECT ch.entity_key AS npc, c.normalized_key AS claim, b.score, b.label
         FROM public.npc_beliefs b
         JOIN public.npcs n ON n.town_id = b.town_id AND n.id = b.npc_id
         JOIN public.story_entities ch
           ON ch.town_id = n.town_id AND ch.id = n.character_entity_id
         JOIN public.claims c ON c.town_id = b.town_id AND c.id = b.claim_id
        WHERE b.town_id = $1`,
      [townId],
    );

    const actual = new Map(
      rows.rows.map((row) => [`${row.npc}|${row.claim}`, `${row.score}|${row.label}`]),
    );
    for (const belief of BELL_MYSTERY_V1.seedBeliefs) {
      const key = `${belief.npcKey}|${BELL_MYSTERY_V1.normalizedKeys.get(belief.claimKey)}`;
      expect(actual.get(key), key).toBe(`${belief.score}|${belief.label}`);
    }
  });

  it("puts the bell in the chapel and the key in Nessa's hands", async () => {
    const rows = await database().pool.query<{
      item: string;
      location: string | null;
      holder: string | null;
      revealed: string | null;
    }>(
      `SELECT e.entity_key AS item,
              l.entity_key AS location,
              h.display_name AS holder,
              i.revealed_event_id AS revealed
         FROM public.items i
         JOIN public.story_entities e ON e.town_id = i.town_id AND e.id = i.id
         LEFT JOIN public.story_entities l
           ON l.town_id = i.town_id AND l.id = i.location_entity_id
         LEFT JOIN public.actors h ON h.town_id = i.town_id AND h.id = i.held_by_actor_id
        WHERE i.town_id = $1
        ORDER BY e.entity_key`,
      [townId],
    );

    expect(rows.rows).toStrictEqual([
      { item: "festival_bell", location: "old_chapel", holder: null, revealed: null },
      {
        item: "guard_dispatch_seal",
        location: "reeds_garden",
        holder: null,
        revealed: null,
      },
      {
        item: "nessas_field_lens",
        location: "festival_square",
        holder: null,
        revealed: null,
      },
      { item: "old_chapel_key", location: null, holder: "Nessa Reed", revealed: null },
    ]);
  });

  it("keeps the private solution out of every claim and inside case_solutions", async () => {
    const solution = await database().pool.query<{
      culprit: string;
      motive: string;
      location: string;
      item: string;
    }>(
      `SELECT culprit.entity_key AS culprit, motive.entity_key AS motive,
              location.entity_key AS location, item.entity_key AS item
         FROM public.case_solutions s
         JOIN public.story_entities culprit
           ON culprit.town_id = s.town_id AND culprit.id = s.culprit_entity_id
         JOIN public.story_entities motive
           ON motive.town_id = s.town_id AND motive.id = s.motive_entity_id
         JOIN public.story_entities location
           ON location.town_id = s.town_id AND location.id = s.location_entity_id
         JOIN public.story_entities item
           ON item.town_id = s.town_id AND item.id = s.required_item_id
        WHERE s.town_id = $1`,
      [townId],
    );
    expect(solution.rows[0]).toStrictEqual({
      culprit: "corin_hale",
      motive: "protect_lark",
      location: "old_chapel",
      item: "festival_bell",
    });
  });

  it("refuses to summarize a town that does not exist", async () => {
    await expect(
      summarizeTown(database().pool, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/No such town/);
  });

  it("writes an empty row group without emitting a statement", async () => {
    // The bell mystery has no entailment relations, so this is the real
    // shape of an empty group rather than a contrived one.
    const plan = planTown(BELL_MYSTERY_V1, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("empty-group"),
    });
    const result = await materializeTown(
      database().pool,
      {
        contentVersion: "bell-mystery-v1",
        createdAt: CREATED_AT,
        inviteTokenHash: inviteHash("empty-group"),
      },
      { plan: { ...plan, claimRelations: [] }, now: () => Date.now() },
    );
    expect(result.outcome).toBe("committed");
    const relations = await database().pool.query(
      "SELECT 1 FROM public.claim_relations WHERE town_id = $1",
      [plan.townId],
    );
    expect(relations.rowCount).toBe(0);
  }, 60_000);

  it("summarizes safely, naming no secret at any depth", async () => {
    const summary = await summarizeTown(database().pool, townId);
    expect(summary.townId).toBe(townId);
    expect(summary.lastEventSequence).toBe(11);
    expect(summary.ambientScheduledThroughSequence).toBe(11);
    expect(summary.counts["npc_beliefs"]).toBe(19);

    const serialized = JSON.stringify(summary).toLowerCase();
    for (const forbidden of [
      "invite",
      "token",
      "hash",
      "secret",
      "password",
      "cookie",
      "postgresql://",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe.skipIf(!shouldRunDatabaseTests())("seed isolation and rollback", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("creates two equivalent towns that share no identity", async () => {
    const first = await materializeTown(database().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("first"),
    });
    const second = await materializeTown(database().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("second"),
    });
    if (first.outcome !== "committed" || second.outcome !== "committed") {
      throw new Error("Both seeds should commit.");
    }

    const projection = async (townId: string): Promise<string[]> => {
      const rows = await database().pool.query<{ line: string }>(
        `SELECT ch.entity_key || '|' || c.normalized_key || '|' || b.score::STRING AS line
           FROM public.npc_beliefs b
           JOIN public.npcs n ON n.town_id = b.town_id AND n.id = b.npc_id
           JOIN public.story_entities ch
             ON ch.town_id = n.town_id AND ch.id = n.character_entity_id
           JOIN public.claims c ON c.town_id = b.town_id AND c.id = b.claim_id
          WHERE b.town_id = $1
          ORDER BY line`,
        [townId],
      );
      return rows.rows.map((row) => row.line);
    };

    // Semantically equal by stable-key projection...
    expect(await projection(first.value.townId)).toStrictEqual(
      await projection(second.value.townId),
    );
    // ...and sharing no town-owned identity at all.
    const firstIds = new Set(first.value.ids.values());
    const overlap = [...second.value.ids.values()].filter((value) =>
      firstIds.has(value),
    );
    expect(overlap).toStrictEqual([]);
    expect(first.value.townId).not.toBe(second.value.townId);
  }, 120_000);

  it("leaves nothing behind when a seed fails partway", async () => {
    const before = await database().pool.query<{ count: number }>(
      "SELECT count(*)::INT8 AS count FROM public.towns",
    );

    const plan = planTown(BELL_MYSTERY_V1, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: inviteHash("doomed"),
    });
    // A belief whose label contradicts its score is rejected by the schema, so
    // the failure lands after most of the town has already been written.
    const broken = {
      ...plan,
      beliefs: plan.beliefs.map((belief) => ({ ...belief, label: "convinced" })),
    };

    await expect(
      materializeTown(
        database().pool,
        {
          contentVersion: "bell-mystery-v1",
          createdAt: CREATED_AT,
          inviteTokenHash: inviteHash("doomed"),
        },
        { plan: broken },
      ),
    ).rejects.toMatchObject({ category: "check_violation" });

    const after = await database().pool.query<{ count: number }>(
      "SELECT count(*)::INT8 AS count FROM public.towns",
    );
    expect(Number(after.rows[0]?.count)).toBe(Number(before.rows[0]?.count));

    const orphans = await database().pool.query(
      "SELECT 1 FROM public.story_entities WHERE town_id = $1",
      [plan.townId],
    );
    expect(orphans.rowCount).toBe(0);
  }, 120_000);
});
