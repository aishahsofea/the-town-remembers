import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  insertActor,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readActiveContributionsForReversal,
  readActivePlayerTestimonyRootTransmission,
  readAlreadyRecordedEvidence,
  readClueClaimEffects,
  readClueForRevealedItem,
  readCluesByIds,
  readEarliestOriginalAssertions,
  readPlayerClueDiscoveredAt,
  readRelationshipChangeKeys,
} from "./evidence.js";

describe.skipIf(!shouldRunDatabaseTests())("evidence persistence", () => {
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
       VALUES ($1, $2, $3, 'evidence_shown', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, worldEventSequence, `test:${eventId}`],
    );
    return eventId;
  }

  async function insertClaim(pool: Pool, townId: string, normalizedKey: string) {
    const characterId = await insertStoryEntity(pool, townId, { entityType: "character" });
    const locationId = await insertStoryEntity(pool, townId, { entityType: "location" });
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
    return id as string;
  }

  async function insertInspectableWithClue(
    pool: Pool,
    townId: string,
    clueKey: string,
    requiredForResolution: boolean,
    linkedItemEntityId?: string,
  ): Promise<{ inspectableId: string; clueId: string }> {
    const locationId = await insertStoryEntity(pool, townId, { entityType: "location" });
    const inspectableId = randomUUID();
    await pool.query(
      `INSERT INTO public.inspectables
         (town_id, id, location_entity_id, location_entity_type, inspectable_key,
          display_name, content_key, enabled, linked_entity_id, linked_entity_type,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'location', $4, $4, $5, true, $6, $7, now(), now())`,
      [
        townId,
        inspectableId,
        locationId,
        `inspectable:${clueKey}`,
        `inspectable.${clueKey}`,
        linkedItemEntityId ?? null,
        linkedItemEntityId === undefined ? null : "item",
      ],
    );
    const clueId = randomUUID();
    await pool.query(
      `INSERT INTO public.clues
         (town_id, id, inspectable_id, clue_key, clue_kind, content_key,
          required_for_resolution, created_at)
       VALUES ($1, $2, $3, $4, 'physical_trace', $5, $6, now())`,
      [townId, clueId, inspectableId, clueKey, `clue.${clueKey}`, requiredForResolution],
    );
    return { inspectableId, clueId };
  }

  async function insertClueClaimEffect(
    pool: Pool,
    townId: string,
    clueId: string,
    claimId: string,
    signedWeight: number,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO public.clue_claim_effects
         (town_id, clue_id, claim_id, effect_kind, signed_weight, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, 'test', now())`,
      [townId, clueId, claimId, signedWeight >= 0 ? "supports" : "contradicts", signedWeight],
    );
  }

  it("reads clue metadata and clue_claim_effects for a set of clues", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const claimId = await insertClaim(pool, townId, "claim:effects");
    const { clueId } = await insertInspectableWithClue(pool, townId, "clue:effects", true);
    await insertClueClaimEffect(pool, townId, clueId, claimId, 70);

    const clues = await readCluesByIds(pool, townId, [clueId]);
    expect(clues.get(clueId)).toMatchObject({
      clueId,
      clueKey: "clue:effects",
      requiredForResolution: true,
    });

    const effects = await readClueClaimEffects(pool, townId, [clueId]);
    expect(effects).toStrictEqual([{ clueId, claimId, signedWeight: 70 }]);
  });

  it("resolves the clue an inspectable reveals alongside an item, and undefined for an unlinked item", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const itemEntityId = await insertStoryEntity(pool, townId, { entityType: "item" });
    const { clueId } = await insertInspectableWithClue(
      pool,
      townId,
      "clue:item-linked",
      false,
      itemEntityId,
    );

    expect(await readClueForRevealedItem(pool, townId, itemEntityId)).toBe(clueId);

    const unlinkedItemEntityId = await insertStoryEntity(pool, townId, {
      entityType: "item",
    });
    expect(
      await readClueForRevealedItem(pool, townId, unlinkedItemEntityId),
    ).toBeUndefined();
  });

  it("reads already-recorded direct evidence but not testimony or reversal rows", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const claimId = await insertClaim(pool, townId, "claim:already-recorded");
    const { clueId } = await insertInspectableWithClue(pool, townId, "clue:recorded", false);
    const eventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, clue_id, event_id, evidence_kind,
          signed_weight, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'physical_clue', 70, 'test', now())`,
      [townId, randomUUID(), npcId, claimId, clueId, eventId],
    );
    // A testimony row against the same npc/claim must not be mistaken for a
    // direct clue link, even when it happens to name no clue.
    const testimonyPlayerId = await insertActor(pool, townId, { actorType: "player" });
    const transmissionId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, now())`,
      [townId, transmissionId, claimId, testimonyPlayerId, npcId, eventId],
    );
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, transmission_id,
          source_root_transmission_id, evidence_kind, signed_weight, trust_snapshot,
          hop_count, independent_source_actor_id, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'player_testimony', 40, 0, 0, $7, 'test', now())`,
      [townId, randomUUID(), npcId, claimId, eventId, transmissionId, testimonyPlayerId],
    );

    expect(await readAlreadyRecordedEvidence(pool, townId, npcId, [clueId])).toStrictEqual([
      { claimId, clueId },
    ]);
  });

  it("reads the earliest original-assertion transmission per claim, excluding alleged hearsay", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertActor(pool, townId, { actorType: "player" });
    const claimId = await insertClaim(pool, townId, "claim:confirmed");
    const hearsayClaimId = await insertClaim(pool, townId, "claim:hearsay-only");
    const earlierEventId = await insertWorldEvent(pool, townId);
    const earlierId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0,
               now() - interval '1 hour')`,
      [townId, earlierId, claimId, playerId, npcId, earlierEventId],
    );
    const laterEventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, now())`,
      [townId, randomUUID(), claimId, playerId, npcId, laterEventId],
    );
    const hearsayEventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, alleged_source_actor_id, root_transmission_id,
          source_kind, hop_count, event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $4, $2, 'alleged_hearsay', 1, $6, 0, now())`,
      [townId, randomUUID(), hearsayClaimId, playerId, npcId, hearsayEventId],
    );

    const result = await readEarliestOriginalAssertions(pool, townId, npcId, playerId, [
      claimId,
      hearsayClaimId,
    ]);
    expect(result.get(claimId)?.transmissionId).toBe(earlierId);
    expect(result.has(hearsayClaimId)).toBe(false);
  });

  it("reads the earliest per-player clue discovery instant", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const playerId = await insertPlayer(pool, townId);
    const otherPlayerId = await insertPlayer(pool, townId);
    const { clueId } = await insertInspectableWithClue(pool, townId, "clue:discovered", false);

    async function insertDiscovery(forPlayerId: string, offsetHours: number): Promise<void> {
      const eventId = await insertWorldEvent(pool, townId);
      await pool.query(
        `INSERT INTO public.clue_discoveries (town_id, id, clue_id, player_id, event_id, created_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval)`,
        [townId, randomUUID(), clueId, forPlayerId, eventId, offsetHours],
      );
    }
    await insertDiscovery(otherPlayerId, -2);
    await insertDiscovery(playerId, -1);

    const result = await readPlayerClueDiscoveredAt(pool, townId, playerId, [clueId]);
    expect(result.has(clueId)).toBe(true);

    const nobodyResult = await readPlayerClueDiscoveredAt(pool, townId, randomUUID(), [
      clueId,
    ]);
    expect(nobodyResult.size).toBe(0);
  });

  it("reads relationship_changes keys scoped to one (npc, player) pair", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertPlayer(pool, townId);
    const claimId = await insertClaim(pool, townId, "claim:relationship-key");
    const transmissionEventId = await insertWorldEvent(pool, townId);
    const transmissionId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, now())`,
      [townId, transmissionId, claimId, playerId, npcId, transmissionEventId],
    );
    const eventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.relationship_changes
         (town_id, id, npc_id, player_id, reason_kind, claim_id,
          source_root_transmission_id, trust_delta, suspicion_delta, rule_version,
          event_id, created_at)
       VALUES ($1, $2, $3, $4, 'lie_established', $5, $6, -30, 40, 'test', $7, now())`,
      [townId, randomUUID(), npcId, playerId, claimId, transmissionId, eventId],
    );

    const keys = await readRelationshipChangeKeys(pool, townId, npcId, playerId);
    expect(keys).toStrictEqual([
      { reasonKind: "lie_established", claimId, clueId: null },
    ]);
  });

  it("resolves the active player-testimony root transmission, and undefined once reversed", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertActor(pool, townId, { actorType: "player" });
    const claimId = await insertClaim(pool, townId, "claim:root-transmission");
    const eventId = await insertWorldEvent(pool, townId);
    const transmissionId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, now())`,
      [townId, transmissionId, claimId, playerId, npcId, eventId],
    );
    const evidenceId = randomUUID();
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, transmission_id,
          source_root_transmission_id, independent_source_actor_id,
          evidence_kind, signed_weight, trust_snapshot, hop_count, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'player_testimony', 40, 0, 0, 'test', now())`,
      [townId, evidenceId, npcId, claimId, eventId, transmissionId, playerId],
    );

    expect(
      await readActivePlayerTestimonyRootTransmission(pool, townId, npcId, claimId, playerId),
    ).toBe(transmissionId);

    const reversalEventId = await insertWorldEvent(pool, townId);
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, evidence_kind, signed_weight,
          reverses_evidence_id, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, 'source_reversal', -40, $6, 'test', now())`,
      [townId, randomUUID(), npcId, claimId, reversalEventId, evidenceId],
    );
    expect(
      await readActivePlayerTestimonyRootTransmission(pool, townId, npcId, claimId, playerId),
    ).toBeUndefined();
  });

  it("resolves a discredited source's active contribution and its same-claim mirror to the same effective source", async () => {
    const pool = db().pool;
    const townId = await insertTown(pool);
    const npcId = await insertNpc(pool, townId);
    const playerId = await insertActor(pool, townId, { actorType: "player" });
    const claimId = await insertClaim(pool, townId, "claim:reversal-target");
    const eventId = await insertWorldEvent(pool, townId);

    const transmissionId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id,
          recipient_actor_type, root_transmission_id, source_kind, hop_count,
          event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $2, 'original_assertion', 0, $6, 0, now())`,
      [townId, transmissionId, claimId, playerId, npcId, eventId],
    );
    const primaryId = randomUUID();
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, transmission_id,
          source_root_transmission_id, evidence_kind, signed_weight, trust_snapshot,
          hop_count, independent_source_actor_id, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'player_testimony', 40, 0, 0, $7, 'test', now())`,
      [townId, primaryId, npcId, claimId, eventId, transmissionId, playerId],
    );
    // A same-claim mirror from a *different* claim's relation, whose
    // effective source resolves back to the same player via `mirrors_evidence_id`.
    const mirrorId = randomUUID();
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, evidence_kind, signed_weight,
          mirrors_evidence_id, rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, 'contradiction', -40, $6, 'test', now())`,
      [townId, mirrorId, npcId, claimId, eventId, primaryId],
    );
    // A physical clue contribution from someone else entirely must not appear.
    const { clueId } = await insertInspectableWithClue(pool, townId, "clue:unrelated", false);
    await pool.query(
      `INSERT INTO public.belief_evidence
         (town_id, id, npc_id, claim_id, event_id, clue_id, evidence_kind, signed_weight,
          rule_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'physical_clue', 70, 'test', now())`,
      [townId, randomUUID(), npcId, claimId, eventId, clueId],
    );

    const active = await readActiveContributionsForReversal(
      pool,
      townId,
      npcId,
      claimId,
      playerId,
    );
    expect(new Set(active.map((row) => row.evidenceId))).toStrictEqual(
      new Set([primaryId, mirrorId]),
    );
  });
});
