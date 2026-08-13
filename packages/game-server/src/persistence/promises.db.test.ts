import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { hasActivePromise } from "@the-town-remembers/rules";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readActivePromises, toPromiseKeys } from "./promises.js";

describe.skipIf(!shouldRunDatabaseTests())("promises persistence", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  let worldEventSequence = 0;

  async function insertWorldEvent(pool: Pool, townId: string): Promise<string> {
    const eventId = randomUUID();
    worldEventSequence += 1;
    await pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, $3, 'promise_accepted', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, worldEventSequence, `test:${eventId}`],
    );
    return eventId;
  }

  async function insertClaim(pool: Pool, townId: string): Promise<string> {
    const characterId = await insertStoryEntity(pool, townId, {
      entityType: "character",
    });
    const locationId = await insertStoryEntity(pool, townId, {
      entityType: "location",
    });
    const id = randomUUID();
    await pool.query(
      `INSERT INTO public.claims
         (town_id, id, subject_entity_id, subject_entity_type, predicate,
          object_entity_id, object_entity_type, polarity, context_key,
          normalized_key, created_at)
       VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive',
               'festival_night', $5, now())`,
      [townId, id, characterId, locationId, `claim:${id}`],
    );
    return id;
  }

  async function insertActiveSecretPromise(
    pool: Pool,
    townId: string,
    npcId: string,
    playerId: string,
  ): Promise<{ readonly promiseId: string; readonly claimId: string }> {
    const claimId = await insertClaim(pool, townId);
    const acceptedEvent = await insertWorldEvent(pool, townId);
    const promiseId = randomUUID();
    await pool.query(
      `INSERT INTO public.promises
         (town_id, id, npc_id, player_id, kind, protected_claim_id, status,
          accepted_event_id, terms_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'keep_secret', $5, 'active', $6, 'v1', now(), now())`,
      [townId, promiseId, npcId, playerId, claimId, acceptedEvent],
    );
    return { promiseId, claimId };
  }

  it("reads only this pair's active promises, empty when none exist", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertPlayer(pool, townId);
    const otherPlayerId = await insertPlayer(pool, townId);

    expect(await readActivePromises(pool, townId, npcId, playerId)).toEqual([]);

    const { promiseId, claimId } = await insertActiveSecretPromise(
      pool,
      townId,
      npcId,
      playerId,
    );
    await insertActiveSecretPromise(pool, townId, npcId, otherPlayerId);

    const rows = await readActivePromises(pool, townId, npcId, playerId);
    expect(rows).toEqual([
      { promiseId, kind: "keep_secret", protectedClaimId: claimId, itemId: null },
    ]);
  });

  it("projects rows onto rules.hasActivePromise's PromiseKey shape", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertPlayer(pool, townId);
    const { claimId } = await insertActiveSecretPromise(pool, townId, npcId, playerId);

    const rows = await readActivePromises(pool, townId, npcId, playerId);
    const keys = toPromiseKeys(npcId, rows);

    expect(
      hasActivePromise(keys, {
        npcId,
        kind: "keep_secret",
        protectedClaimId: claimId,
      }),
    ).toBe(true);
    expect(
      hasActivePromise(keys, {
        npcId,
        kind: "keep_secret",
        protectedClaimId: randomUUID(),
      }),
    ).toBe(false);
  });
});
