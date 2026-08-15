import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  insertActor,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  SHA256_PLACEHOLDER,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  hasCapability,
  isCoLocated,
  readActiveVisitLocation,
  readGrantedCapabilities,
  readItemCustody,
  readNpcSnapshot,
} from "./npc-state.js";

describe.skipIf(!shouldRunDatabaseTests())("npc-state persistence", () => {
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
       VALUES ($1, $2, $3, 'capability_changed', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, worldEventSequence, `test:${eventId}`],
    );
    return eventId;
  }

  async function insertPlayerAction(
    pool: Pool,
    townId: string,
    playerId: string,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO public.player_actions
         (town_id, id, player_id, idempotency_key, action_kind, request_hash,
          request_payload, status, outcome, response_status, response_payload,
          attempt_count, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, 'start_visit', $5, '{}', 'completed', 'applied',
               200, '{}', 1, now(), now(), now())`,
      [townId, id, playerId, randomUUID(), SHA256_PLACEHOLDER],
    );
    return id;
  }

  async function insertActiveVisit(
    pool: Pool,
    townId: string,
    playerId: string,
    locationEntityId: string,
  ): Promise<string> {
    const actionId = await insertPlayerAction(pool, townId, playerId);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO public.player_visits
         (town_id, id, player_id, current_location_entity_id, status,
          start_revision, started_by_action_id, started_at)
       VALUES ($1, $2, $3, $4, 'active', 0, $5, now())`,
      [townId, id, playerId, locationEntityId, actionId],
    );
    return id;
  }

  it("reads an NPC's snapshot, or undefined for a missing NPC", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);

    const snapshot = await readNpcSnapshot(pool, townId, npcId);
    expect(snapshot?.npcId).toBe(npcId);
    expect(snapshot?.characterKey).toBeTruthy();

    const missing = await readNpcSnapshot(pool, townId, randomUUID());
    expect(missing).toBeUndefined();
  });

  it("computes co-location from the player's active visit and the NPC's location", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const locationEntityId = await insertStoryEntity(pool, townId, {
      entityType: "location",
    });
    const elsewhereEntityId = await insertStoryEntity(pool, townId, {
      entityType: "location",
    });
    const npcId = await insertNpc(pool, townId, { locationEntityId });
    const playerId = await insertPlayer(pool, townId);

    const noVisit = await readActiveVisitLocation(pool, townId, playerId);
    expect(noVisit).toBeUndefined();
    expect(isCoLocated(noVisit, await readNpcSnapshot(pool, townId, npcId))).toBe(
      false,
    );

    await insertActiveVisit(pool, townId, playerId, elsewhereEntityId);
    const elsewhere = await readActiveVisitLocation(pool, townId, playerId);
    expect(isCoLocated(elsewhere, await readNpcSnapshot(pool, townId, npcId))).toBe(
      false,
    );
  });

  it("reads only granted capabilities", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const playerId = await insertPlayer(pool, townId);
    const grantedEvent = await insertWorldEvent(pool, townId);
    const revokedEvent = await insertWorldEvent(pool, townId);

    await pool.query(
      `INSERT INTO public.player_capabilities
         (town_id, id, player_id, capability_key, status, granted_event_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'enter_old_chapel', 'granted', $4, now(), now())`,
      [townId, randomUUID(), playerId, grantedEvent],
    );
    await pool.query(
      `INSERT INTO public.player_capabilities
         (town_id, id, player_id, capability_key, status, granted_event_id,
          revoked_event_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'some_other_key', 'revoked', $4, $5, now(), now())`,
      [townId, randomUUID(), playerId, grantedEvent, revokedEvent],
    );

    const capabilities = await readGrantedCapabilities(pool, townId, playerId);
    expect(hasCapability(capabilities, "enter_old_chapel")).toBe(true);
    expect(hasCapability(capabilities, "some_other_key")).toBe(false);
  });

  it("reads item custody by ID, empty for an empty request", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const holderId = await insertActor(pool, townId, { actorType: "npc" });
    const itemId = await insertStoryEntity(pool, townId, { entityType: "item" });
    await pool.query(
      `INSERT INTO public.items
         (town_id, id, held_by_actor_id, portable, created_at, updated_at)
       VALUES ($1, $2, $3, true, now(), now())`,
      [townId, itemId, holderId],
    );

    expect(await readItemCustody(pool, townId, [])).toEqual(new Map());

    const custody = await readItemCustody(pool, townId, [itemId]);
    expect(custody.get(itemId)).toEqual({
      itemId,
      heldByActorId: holderId,
      locationEntityId: null,
      revision: 0,
    });
  });
});
