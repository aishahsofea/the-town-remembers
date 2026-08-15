import { randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readGroundingEpisodes, readReceivedTransmissions } from "./board.js";

describe.skipIf(!shouldRunDatabaseTests())("board persistence", () => {
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

  async function insertOriginalAssertion(
    pool: Pool,
    townId: string,
    claimId: string,
    speakerActorId: string,
    recipientNpcId: string,
    createdAt: Date,
  ): Promise<string> {
    const id = randomUUID();
    const eventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id, recipient_actor_type,
          root_transmission_id, source_kind, hop_count, event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, $7)`,
      [townId, id, claimId, speakerActorId, recipientNpcId, eventId, createdAt],
    );
    return id;
  }

  async function insertEpisodeWithClaimReference(
    pool: Pool,
    townId: string,
    npcId: string,
    claimId: string,
    episodeKind: "direct_observation" | "heard_claim",
    occurredAt: Date,
  ): Promise<string> {
    const episodeId = randomUUID();
    const eventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'test episode', 50, $6, 'pending', now(), now())`,
      [townId, episodeId, npcId, eventId, episodeKind, occurredAt],
    );
    await pool.query(
      `INSERT INTO public.episode_references
         (town_id, episode_id, reference_kind, claim_id, created_at)
       VALUES ($1, $2, 'claim', $3, now())`,
      [townId, episodeId, claimId],
    );
    return episodeId;
  }

  it("reads no grounding episodes for an empty claim list", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);

    expect(await readGroundingEpisodes(pool, townId, npcId, [])).toEqual(new Map());
  });

  it("finds the direct_observation or heard_claim episode grounding a claim", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const directClaimId = await insertClaim(pool, townId);
    const heardClaimId = await insertClaim(pool, townId);
    const now = new Date();
    const directEpisodeId = await insertEpisodeWithClaimReference(
      pool,
      townId,
      npcId,
      directClaimId,
      "direct_observation",
      now,
    );
    const heardEpisodeId = await insertEpisodeWithClaimReference(
      pool,
      townId,
      npcId,
      heardClaimId,
      "heard_claim",
      now,
    );

    const groundings = await readGroundingEpisodes(pool, townId, npcId, [
      directClaimId,
      heardClaimId,
    ]);
    expect(groundings.get(directClaimId)).toEqual({
      episodeId: directEpisodeId,
      episodeKind: "direct_observation",
    });
    expect(groundings.get(heardClaimId)).toEqual({
      episodeId: heardEpisodeId,
      episodeKind: "heard_claim",
    });
  });

  it("prefers direct_observation over heard_claim when a claim has both", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const claimId = await insertClaim(pool, townId);
    const now = new Date();
    // Inserted heard_claim first, so a naive "first row wins" query would
    // pick the wrong one — this proves the ordering, not just presence.
    await insertEpisodeWithClaimReference(
      pool,
      townId,
      npcId,
      claimId,
      "heard_claim",
      now,
    );
    const directEpisodeId = await insertEpisodeWithClaimReference(
      pool,
      townId,
      npcId,
      claimId,
      "direct_observation",
      now,
    );

    const groundings = await readGroundingEpisodes(pool, townId, npcId, [claimId]);
    expect(groundings.get(claimId)).toEqual({
      episodeId: directEpisodeId,
      episodeKind: "direct_observation",
    });
  });

  it("reads no transmissions for an empty claim list", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);

    expect(await readReceivedTransmissions(pool, townId, npcId, [])).toEqual(new Map());
  });

  it("picks the earliest transmission when a claim reached the NPC more than once", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const speakerId = await insertPlayer(pool, townId);
    const claimId = await insertClaim(pool, townId);

    const earlier = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-01T01:00:00Z");
    const earlierId = await insertOriginalAssertion(
      pool,
      townId,
      claimId,
      speakerId,
      npcId,
      earlier,
    );
    await insertOriginalAssertion(pool, townId, claimId, speakerId, npcId, later);

    const received = await readReceivedTransmissions(pool, townId, npcId, [claimId]);
    expect(received.get(claimId)).toEqual({
      transmissionId: earlierId,
      claimId,
      sourceKind: "original_assertion",
    });
  });
});
