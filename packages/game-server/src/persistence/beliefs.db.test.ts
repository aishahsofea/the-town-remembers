import { randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertNpc,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readClaimIdsByNormalizedKeys,
  readContradictingClaimScores,
  readNpcBeliefs,
} from "./beliefs.js";

describe.skipIf(!shouldRunDatabaseTests())("beliefs persistence", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
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
       VALUES ($1, $2, $3, 'evidence_shown', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, worldEventSequence, `test:${eventId}`],
    );
    return eventId;
  }

  async function insertClaim(
    pool: Pool,
    townId: string,
    normalizedKey: string,
  ): Promise<string> {
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
      [townId, id, characterId, locationId, normalizedKey],
    );
    return id;
  }

  async function insertBelief(
    pool: Pool,
    townId: string,
    npcId: string,
    claimId: string,
    score: number,
  ): Promise<void> {
    const eventId = await insertWorldEvent(pool, townId);
    const label = score >= 60 ? "convinced" : score >= 20 ? "leaning" : "doubtful";
    await pool.query(
      `INSERT INTO public.npc_beliefs
         (town_id, npc_id, claim_id, score, label, updated_event_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
      [townId, npcId, claimId, score, label, eventId],
    );
  }

  it("resolves claim IDs by normalized key, empty for an empty request", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const claimId = await insertClaim(pool, townId, "claim:one");

    expect(await readClaimIdsByNormalizedKeys(pool, townId, [])).toEqual(new Map());

    const resolved = await readClaimIdsByNormalizedKeys(pool, townId, [
      "claim:one",
      "claim:missing",
    ]);
    expect(resolved.get("claim:one")).toBe(claimId);
    expect(resolved.has("claim:missing")).toBe(false);
  });

  it("reads only the belief rows that exist", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const believedClaimId = await insertClaim(pool, townId, "claim:believed");
    const unrecordedClaimId = await insertClaim(pool, townId, "claim:unrecorded");
    await insertBelief(pool, townId, npcId, believedClaimId, 75);

    const beliefs = await readNpcBeliefs(pool, townId, npcId, [
      believedClaimId,
      unrecordedClaimId,
    ]);
    expect(beliefs.get(believedClaimId)).toMatchObject({
      score: 75,
      label: "convinced",
    });
    expect(beliefs.has(unrecordedClaimId)).toBe(false);
  });

  it("reads contradicting scores, defaulting a beliefless contradiction to 0", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const claimAId = await insertClaim(pool, townId, "claim:a");
    const claimBId = await insertClaim(pool, townId, "claim:b");
    await pool.query(
      `INSERT INTO public.claim_relations
         (town_id, claim_a_id, claim_b_id, relation_kind, rule_version, created_at)
       VALUES ($1, $2, $3, 'contradicts', 'test', now())`,
      [townId, claimAId, claimBId],
    );

    const noBeliefYet = await readContradictingClaimScores(
      pool,
      townId,
      npcId,
      claimAId,
    );
    expect(noBeliefYet).toEqual([0]);

    await insertBelief(pool, townId, npcId, claimBId, 42);
    const withBelief = await readContradictingClaimScores(
      pool,
      townId,
      npcId,
      claimAId,
    );
    expect(withBelief).toEqual([42]);
  });
});
