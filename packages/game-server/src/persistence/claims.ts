/**
 * Claim relations and active testimony evidence for `tell` (`P4-13`).
 *
 * Claim identity lookup by `normalized_key` and `npc_beliefs` reads already
 * live in `persistence/beliefs.ts` (`readClaimIdsByNormalizedKeys`,
 * `readNpcBeliefs`) — reused directly rather than duplicated here.
 * Authored `claim_relations` rows are seeded, while a newly-created dynamic
 * claim adds its exact-opposite and mutually-exclusive-location relations in
 * the same Tell transaction. The reads here provide that bounded candidate
 * set, mirror backfill support, and testimony-source state.
 */

import type { ClaimRelationKind } from "@the-town-remembers/rules";
import type { Pool } from "pg";

export interface RelationCandidateClaim {
  readonly claimId: string;
  readonly subjectEntityId: string;
  readonly predicate: string;
  readonly objectEntityId: string;
  readonly polarity: string;
  readonly contextKey: string;
}

/**
 * Existing claims that could participate in an automatic relation with a new
 * claim. The pure rules function performs the final comparison; this query
 * only bounds the candidate set by the fields every automatic relation shares.
 */
export async function readDeterministicRelationCandidates(
  pool: Pool,
  townId: string,
  subjectEntityId: string,
  predicate: string,
  contextKey: string,
): Promise<readonly RelationCandidateClaim[]> {
  const result = await pool.query<{
    readonly id: string;
    readonly subject_entity_id: string;
    readonly predicate: string;
    readonly object_entity_id: string;
    readonly polarity: string;
    readonly context_key: string;
  }>(
    `SELECT id, subject_entity_id, predicate, object_entity_id, polarity, context_key
       FROM public.claims
      WHERE town_id = $1 AND subject_entity_id = $2
        AND predicate = $3 AND context_key = $4`,
    [townId, subjectEntityId, predicate, contextKey],
  );
  return result.rows.map((row) => ({
    claimId: row.id,
    subjectEntityId: row.subject_entity_id,
    predicate: row.predicate,
    objectEntityId: row.object_entity_id,
    polarity: row.polarity,
    contextKey: row.context_key,
  }));
}

export interface ClaimSupportEvidenceRow {
  readonly evidenceId: string;
  readonly npcId: string;
  readonly claimId: string;
  readonly signedWeight: number;
}

/**
 * Unreversed primary support eligible for mirror backfill when a newly-created
 * claim adds a contradiction relation. Corroboration, mirrors, negative clue
 * effects, and reversals are deliberately excluded: none is primary support.
 */
export async function readUnreversedPrimarySupport(
  pool: Pool,
  townId: string,
  claimIds: readonly string[],
): Promise<readonly ClaimSupportEvidenceRow[]> {
  if (claimIds.length === 0) return [];
  const result = await pool.query<{
    readonly id: string;
    readonly npc_id: string;
    readonly claim_id: string;
    readonly signed_weight: number;
  }>(
    `SELECT be.id, be.npc_id, be.claim_id, be.signed_weight
       FROM public.belief_evidence be
      WHERE be.town_id = $1 AND be.claim_id = ANY($2)
        AND be.evidence_kind IN (
          'direct_observation', 'player_testimony', 'npc_testimony', 'physical_clue'
        )
        AND be.signed_weight > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.belief_evidence r
           WHERE r.town_id = be.town_id AND r.reverses_evidence_id = be.id
        )`,
    [townId, claimIds],
  );
  return result.rows.map((row) => ({
    evidenceId: row.id,
    npcId: row.npc_id,
    claimId: row.claim_id,
    signedWeight: row.signed_weight,
  }));
}

export interface RelatedClaimRow {
  readonly claimId: string;
  readonly relationKind: ClaimRelationKind;
}

/** Every authored or dynamic claim related to `claimId`; symmetric contradictions are stored both ways, so one direction's query suffices. */
export async function readRelatedClaims(
  pool: Pool,
  townId: string,
  claimId: string,
): Promise<readonly RelatedClaimRow[]> {
  const result = await pool.query<{
    readonly claim_b_id: string;
    readonly relation_kind: ClaimRelationKind;
  }>(
    `SELECT claim_b_id, relation_kind FROM public.claim_relations
      WHERE town_id = $1 AND claim_a_id = $2`,
    [townId, claimId],
  );
  return result.rows.map((row) => ({
    claimId: row.claim_b_id,
    relationKind: row.relation_kind,
  }));
}

/**
 * Every currently-active (never reversed) testimony contribution to one
 * (npc, claim) pair — `player_testimony`/`npc_testimony` evidence rows whose
 * id is not named by another row's `reverses_evidence_id`
 * (`uq_belief_evidence__reverses` allows at most one reversal per source
 * row). Used for the current corroboration count; historical repeat
 * protection is intentionally read separately because a reversed source is
 * inactive but still cannot insert a second row through the schema's unique
 * testimony-source index.
 */
export async function readActiveTestimonySources(
  pool: Pool,
  townId: string,
  npcId: string,
  claimId: string,
): Promise<readonly string[]> {
  const result = await pool.query<{ readonly independent_source_actor_id: string }>(
    `SELECT be.independent_source_actor_id
       FROM public.belief_evidence be
      WHERE be.town_id = $1 AND be.npc_id = $2 AND be.claim_id = $3
        AND be.evidence_kind IN ('player_testimony', 'npc_testimony')
        AND NOT EXISTS (
          SELECT 1 FROM public.belief_evidence r
           WHERE r.town_id = be.town_id AND r.reverses_evidence_id = be.id
        )`,
    [townId, npcId, claimId],
  );
  return result.rows.map((row) => row.independent_source_actor_id);
}

/** All historical testimony sources, including a contribution later reversed. */
export async function readTestimonySources(
  pool: Pool,
  townId: string,
  npcId: string,
  claimId: string,
): Promise<readonly string[]> {
  const result = await pool.query<{ readonly independent_source_actor_id: string }>(
    `SELECT independent_source_actor_id
       FROM public.belief_evidence
      WHERE town_id = $1 AND npc_id = $2 AND claim_id = $3
        AND evidence_kind IN ('player_testimony', 'npc_testimony')`,
    [townId, npcId, claimId],
  );
  return result.rows.map((row) => row.independent_source_actor_id);
}
