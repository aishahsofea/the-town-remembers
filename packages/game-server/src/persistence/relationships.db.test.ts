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
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasEverBrokenPromiseToNpc, readRelationshipScores } from "./relationships.js";

describe.skipIf(!shouldRunDatabaseTests())("relationships persistence", () => {
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
       VALUES ($1, $2, $3, 'promise_broken', true, now(), 'system_seed', 0, $4, '{}', now())`,
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

  async function insertPromise(
    pool: Pool,
    townId: string,
    npcId: string,
    playerId: string,
    status: "active" | "broken",
  ): Promise<void> {
    const claimId = await insertClaim(pool, townId);
    const acceptedEvent = await insertWorldEvent(pool, townId);
    const resolvedEvent =
      status === "broken" ? await insertWorldEvent(pool, townId) : null;
    await pool.query(
      `INSERT INTO public.promises
         (town_id, id, npc_id, player_id, kind, protected_claim_id, status,
          accepted_event_id, resolved_event_id, terms_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'keep_secret', $5, $6, $7, $8, 'v1', now(), now())`,
      [
        townId,
        randomUUID(),
        npcId,
        playerId,
        claimId,
        status,
        acceptedEvent,
        resolvedEvent,
      ],
    );
  }

  it("defaults to the neutral relationship before any ledger row exists", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertPlayer(pool, townId);

    expect(await readRelationshipScores(pool, townId, npcId, playerId)).toEqual({
      trustScore: 0,
      suspicionScore: 0,
      revision: 0,
    });
  });

  it("reads the current relationship row once one exists", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertPlayer(pool, townId);
    await pool.query(
      `INSERT INTO public.npc_player_relationships
         (town_id, npc_id, player_id, trust_score, suspicion_score, revision, created_at, updated_at)
       VALUES ($1, $2, $3, 35, -10, 2, now(), now())`,
      [townId, npcId, playerId],
    );

    expect(await readRelationshipScores(pool, townId, npcId, playerId)).toEqual({
      trustScore: 35,
      suspicionScore: -10,
      revision: 2,
    });
  });

  it("finds an ever-broken promise only for the pair it actually belongs to", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertPlayer(pool, townId);
    const otherPlayerId = await insertPlayer(pool, townId);

    expect(await hasEverBrokenPromiseToNpc(pool, townId, npcId, playerId)).toBe(false);

    await insertPromise(pool, townId, npcId, otherPlayerId, "active");
    expect(await hasEverBrokenPromiseToNpc(pool, townId, npcId, playerId)).toBe(false);

    await insertPromise(pool, townId, npcId, playerId, "broken");
    expect(await hasEverBrokenPromiseToNpc(pool, townId, npcId, playerId)).toBe(true);
  });
});
