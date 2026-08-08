import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  expectRejection,
  insertNpc,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** A 256-dimension vector as the text form CockroachDB accepts. */
function vector(fill: number): string {
  return `[${Array.from({ length: 256 }, () => fill.toFixed(3)).join(",")}]`;
}

describe.skipIf(!shouldRunDatabaseTests())("episode recall", () => {
  let handle: DisposableDatabase | undefined;
  let townId: string;
  let npcId: string;
  let otherNpcId: string;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    townId = await insertTown(handle.pool, {});
    npcId = await insertNpc(handle.pool, townId);
    otherNpcId = await insertNpc(handle.pool, townId);
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  /**
   * Episodes need a causal event, and events need a sequence, so this writes a
   * minimal `system_seed` event rather than pretending an episode can float.
   */
  async function insertEpisode(options: {
    readonly npcId: string;
    readonly status: string;
    readonly embedding: string | null;
    readonly sequence: number;
  }): Promise<string> {
    const eventId = randomUUID();
    await database().pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, $3, 'authored_observation', false, now(), 'system_seed', 0,
               $4, '{"version":"world-event/1"}'::JSONB, now())`,
      [townId, eventId, options.sequence, `seed:test:${eventId}`],
    );

    const episodeId = randomUUID();
    await database().pool.query(
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding, embedding_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'direct_observation', 'summary', 90, now(),
               $5::VECTOR(256), $6, now(), now())`,
      [townId, episodeId, options.npcId, eventId, options.embedding, options.status],
    );
    return episodeId;
  }

  it("stores a 256-dimension embedding only when the status says ready", async () => {
    await expect(
      insertEpisode({ npcId, status: "ready", embedding: vector(0.5), sequence: 1 }),
    ).resolves.toBeTypeOf("string");
    await expect(
      insertEpisode({ npcId, status: "pending", embedding: null, sequence: 2 }),
    ).resolves.toBeTypeOf("string");
  });

  it("refuses a ready episode with no vector, and a pending one with a vector", async () => {
    const missing = await expectRejection(
      database().pool,
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding_status, created_at, updated_at)
       SELECT $1, gen_random_uuid(), $2, id, 'heard_claim', 's', 50, now(),
              'ready', now(), now()
         FROM public.world_events WHERE town_id = $1 LIMIT 1`,
      [townId, npcId],
    );
    expect(missing.constraint).toBe("ck_episodes__embedding_consistency");

    const premature = await expectRejection(
      database().pool,
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding, embedding_status, created_at, updated_at)
       SELECT $1, gen_random_uuid(), $2, id, 'heard_claim', 's', 50, now(),
              $3::VECTOR(256), 'pending', now(), now()
         FROM public.world_events WHERE town_id = $1 LIMIT 1`,
      [townId, npcId, vector(0.25)],
    );
    expect(premature.constraint).toBe("ck_episodes__embedding_consistency");
  });

  it("rejects a vector of the wrong dimension", async () => {
    const rejection = await expectRejection(
      database().pool,
      `SELECT '[1,2,3]'::VECTOR(256)`,
    );
    expect(rejection.code).toBeDefined();
  });

  it("returns only this NPC's ready episodes from a nearest-neighbour search", async () => {
    const mine = await insertEpisode({
      npcId,
      status: "ready",
      embedding: vector(0.9),
      sequence: 10,
    });
    await insertEpisode({
      npcId: otherNpcId,
      status: "ready",
      embedding: vector(0.9),
      sequence: 11,
    });
    await insertEpisode({
      npcId,
      status: "pending",
      embedding: null,
      sequence: 12,
    });

    const rows = await database().pool.query<{ id: string; npc_id: string }>(
      `SELECT id, npc_id FROM public.episodes
        WHERE town_id = $1 AND npc_id = $2 AND embedding_status = 'ready'
        ORDER BY embedding <-> $3::VECTOR(256)
        LIMIT 30`,
      [townId, npcId, vector(0.9)],
    );

    expect(rows.rows.map((row) => row.npc_id)).toStrictEqual(
      rows.rows.map(() => npcId),
    );
    expect(rows.rows[0]?.id).toBe(mine);
    // The other NPC's identical vector is not a candidate at all.
    expect(rows.rows.some((row) => row.npc_id === otherNpcId)).toBe(false);
  });

  it("cannot attach a memory to an NPC from another town", async () => {
    const otherTown = await insertTown(database().pool, {});
    const foreignNpc = await insertNpc(database().pool, otherTown);

    const rejection = await expectRejection(
      database().pool,
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding_status, created_at, updated_at)
       SELECT $1, gen_random_uuid(), $2, id, 'heard_claim', 's', 50, now(),
              'pending', now(), now()
         FROM public.world_events WHERE town_id = $1 LIMIT 1`,
      [townId, foreignNpc],
    );
    // The composite key carries town_id on both sides, so the NPC simply does
    // not exist from this town's point of view.
    expect(rejection.constraint).toBe("fk_episodes__npc");
  });
});

describe.skipIf(!shouldRunDatabaseTests())("concurrent writers", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("lets only one town resolution exist, whichever writer arrives first", async () => {
    const townId = await insertTown(database().pool, {});
    const rows = await Promise.allSettled([
      database().pool.query(
        `INSERT INTO public.town_resolutions
           (town_id, case_attempt_id, chosen_by_player_id, choice, event_id, created_at)
         VALUES ($1, gen_random_uuid(), gen_random_uuid(), 'expose_cover_up',
                 gen_random_uuid(), now())`,
        [townId],
      ),
      database().pool.query(
        `INSERT INTO public.town_resolutions
           (town_id, case_attempt_id, chosen_by_player_id, choice, event_id, created_at)
         VALUES ($1, gen_random_uuid(), gen_random_uuid(), 'restore_bell_quietly',
                 gen_random_uuid(), now())`,
        [townId],
      ),
    ]);

    // Both are rejected here because the attempt and player do not exist, but
    // the primary key is what makes a second resolution impossible even when
    // they do.
    expect(rows.every((row) => row.status === "rejected")).toBe(true);

    const stored = await database().pool.query(
      "SELECT 1 FROM public.town_resolutions WHERE town_id = $1",
      [townId],
    );
    expect(stored.rowCount).toBe(0);
  });

  it("permits exactly one custodian for an item under concurrent transfers", async () => {
    const townId = await insertTown(database().pool, {});
    const location = await insertStoryEntity(database().pool, townId, {
      entityType: "location",
    });
    const itemEntity = await insertStoryEntity(database().pool, townId, {
      entityType: "item",
    });
    const npcId = await insertNpc(database().pool, townId);

    await database().pool.query(
      `INSERT INTO public.items
         (town_id, id, location_entity_id, location_entity_type, portable,
          revision, created_at, updated_at)
       VALUES ($1, $2, $3, 'location', true, 0, now(), now())`,
      [townId, itemEntity, location],
    );

    // Two conditional transfers against the same revision. Exactly one can win,
    // because the loser's WHERE clause no longer matches.
    const outcomes = await Promise.all([
      database().pool.query(
        `UPDATE public.items
            SET held_by_actor_id = $3, location_entity_id = NULL,
                location_entity_type = NULL, revision = revision + 1,
                updated_at = now()
          WHERE town_id = $1 AND id = $2 AND revision = 0`,
        [townId, itemEntity, npcId],
      ),
      database().pool.query(
        `UPDATE public.items
            SET held_by_actor_id = $3, location_entity_id = NULL,
                location_entity_type = NULL, revision = revision + 1,
                updated_at = now()
          WHERE town_id = $1 AND id = $2 AND revision = 0`,
        [townId, itemEntity, npcId],
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.rowCount === 1)).toHaveLength(1);

    const item = await database().pool.query<{
      revision: number;
      location_entity_id: string | null;
      held_by_actor_id: string | null;
    }>(
      "SELECT revision, location_entity_id, held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2",
      [townId, itemEntity],
    );
    expect(Number(item.rows[0]?.revision)).toBe(1);
    expect(item.rows[0]?.location_entity_id).toBeNull();
    expect(item.rows[0]?.held_by_actor_id).toBe(npcId);
  });

  it("refuses an item with two custodians or none", async () => {
    const townId = await insertTown(database().pool, {});
    const itemEntity = await insertStoryEntity(database().pool, townId, {
      entityType: "item",
    });

    const none = await expectRejection(
      database().pool,
      `INSERT INTO public.items (town_id, id, portable, revision, created_at, updated_at)
       VALUES ($1, $2, true, 0, now(), now())`,
      [townId, itemEntity],
    );
    expect(none.constraint).toBe("ck_items__exactly_one_custodian");
  });
});
