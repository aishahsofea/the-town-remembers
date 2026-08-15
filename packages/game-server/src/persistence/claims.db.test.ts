import { randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertActor,
  insertNpc,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readActiveTestimonySources, readRelatedClaims } from "./claims.js";

describe.skipIf(!shouldRunDatabaseTests())("claims persistence", () => {
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
       VALUES ($1, $2, $3, 'claim_transmitted', true, now(), 'system_seed', 0, $4, '{}', now())`,
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

  async function insertTestimonyEvidence(
    pool: Pool,
    townId: string,
    npcId: string,
    claimId: string,
    independentSourceActorId: string,
  ): Promise<string> {
    const eventId = await insertWorldEvent(pool, townId);
    const transmissionId = await insertOriginalAssertionTransmission(
      pool,
      townId,
      npcId,
      claimId,
      eventId,
    );
    const evidenceId = randomUUID();
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, transmission_id,
          source_root_transmission_id, independent_source_actor_id,
          evidence_kind, signed_weight, trust_snapshot, hop_count, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'player_testimony', 40, 0, 0, 'test', now())`,
      [
        townId,
        evidenceId,
        npcId,
        claimId,
        eventId,
        transmissionId,
        independentSourceActorId,
      ],
    );
    return evidenceId;
  }

  async function insertOriginalAssertionTransmission(
    pool: Pool,
    townId: string,
    npcId: string,
    claimId: string,
    eventId: string,
  ): Promise<string> {
    const speakerId = await insertActor(pool, townId, { actorType: "player" });
    const id = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, now())`,
      [townId, id, claimId, speakerId, npcId, eventId],
    );
    return id;
  }

  it("reads related claims in both authored directions", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const claimAId = await insertClaim(pool, townId, "claim:a");
    const claimBId = await insertClaim(pool, townId, "claim:b");
    await pool.query(
      `INSERT INTO public.claim_relations
         (town_id, claim_a_id, claim_b_id, relation_kind, rule_version, created_at)
       VALUES ($1, $2, $3, 'contradicts', 'test', now()),
              ($1, $3, $2, 'contradicts', 'test', now())`,
      [townId, claimAId, claimBId],
    );

    expect(await readRelatedClaims(pool, townId, claimAId)).toStrictEqual([
      { claimId: claimBId, relationKind: "contradicts" },
    ]);
    expect(await readRelatedClaims(pool, townId, claimBId)).toStrictEqual([
      { claimId: claimAId, relationKind: "contradicts" },
    ]);
  });

  it("returns no related claims for one with no seeded relation", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const claimId = await insertClaim(pool, townId, "claim:isolated");
    expect(await readRelatedClaims(pool, townId, claimId)).toStrictEqual([]);
  });

  it("reads only currently-active testimony sources, excluding a reversed one", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const claimId = await insertClaim(pool, townId, "claim:testimony");
    const sourceA = await insertActor(pool, townId, { actorType: "player" });
    const sourceB = await insertActor(pool, townId, { actorType: "player" });

    const evidenceA = await insertTestimonyEvidence(
      pool,
      townId,
      npcId,
      claimId,
      sourceA,
    );
    await insertTestimonyEvidence(pool, townId, npcId, claimId, sourceB);

    const beforeReversal = await readActiveTestimonySources(
      pool,
      townId,
      npcId,
      claimId,
    );
    expect(new Set(beforeReversal)).toStrictEqual(new Set([sourceA, sourceB]));

    const reversalEventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, evidence_kind, signed_weight,
          reverses_evidence_id, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, 'source_reversal', -40, $6, 'test', now())`,
      [townId, randomUUID(), npcId, claimId, reversalEventId, evidenceA],
    );

    const afterReversal = await readActiveTestimonySources(
      pool,
      townId,
      npcId,
      claimId,
    );
    expect(afterReversal).toStrictEqual([sourceB]);
  });
});
