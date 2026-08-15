/**
 * `show`'s narrow reads (`P4-14`): authored clue/claim linkage, already-
 * recorded evidence, the player's own confirmation and clue-discovery
 * history for `D2-J`'s caught-lie test, and the active contributions a
 * caught lie reverses. Claim identity, `npc_beliefs`, and testimony-source
 * reads already live in `persistence/beliefs.ts` and `persistence/claims.ts`
 * — reused directly rather than duplicated here.
 */

import type { Pool } from "pg";

export interface ClueRow {
  readonly clueId: string;
  readonly clueKey: string;
  readonly requiredForResolution: boolean;
}

/** Metadata for a set of clues, keyed by id — present rows only. */
export async function readCluesByIds(
  pool: Pool,
  townId: string,
  clueIds: readonly string[],
): Promise<ReadonlyMap<string, ClueRow>> {
  if (clueIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly id: string;
    readonly clue_key: string;
    readonly required_for_resolution: boolean;
  }>(
    `SELECT id, clue_key, required_for_resolution FROM public.clues
      WHERE town_id = $1 AND id = ANY($2)`,
    [townId, clueIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        clueId: row.id,
        clueKey: row.clue_key,
        requiredForResolution: row.required_for_resolution,
      },
    ]),
  );
}

/** The clue an inspectable reveals alongside `itemId`, if any — Show's item-evidence link. */
export async function readClueForRevealedItem(
  pool: Pool,
  townId: string,
  itemId: string,
): Promise<string | undefined> {
  const result = await pool.query<{ readonly id: string }>(
    `SELECT cl.id FROM public.clues cl
       JOIN public.inspectables i
         ON i.town_id = cl.town_id AND i.id = cl.inspectable_id
      WHERE cl.town_id = $1 AND i.linked_entity_id = $2`,
    [townId, itemId],
  );
  return result.rows[0]?.id;
}

export interface ClueClaimEffectRow {
  readonly clueId: string;
  readonly claimId: string;
  readonly signedWeight: number;
}

/** Every authored `clue_claim_effects` link for a set of clues. */
export async function readClueClaimEffects(
  pool: Pool,
  townId: string,
  clueIds: readonly string[],
): Promise<readonly ClueClaimEffectRow[]> {
  if (clueIds.length === 0) return [];
  const result = await pool.query<{
    readonly clue_id: string;
    readonly claim_id: string;
    readonly signed_weight: number;
  }>(
    `SELECT clue_id, claim_id, signed_weight FROM public.clue_claim_effects
      WHERE town_id = $1 AND clue_id = ANY($2)`,
    [townId, clueIds],
  );
  return result.rows.map((row) => ({
    clueId: row.clue_id,
    claimId: row.claim_id,
    signedWeight: row.signed_weight,
  }));
}

export interface AlreadyRecordedEvidenceRow {
  readonly claimId: string;
  readonly clueId: string;
}

/** Existing direct clue-linked `belief_evidence` rows for this NPC across a set of clues, so a repeat Show is skipped. */
export async function readAlreadyRecordedEvidence(
  pool: Pool,
  townId: string,
  npcId: string,
  clueIds: readonly string[],
): Promise<readonly AlreadyRecordedEvidenceRow[]> {
  if (clueIds.length === 0) return [];
  const result = await pool.query<{
    readonly claim_id: string;
    readonly clue_id: string;
  }>(
    `SELECT claim_id, clue_id FROM public.belief_evidence
      WHERE town_id = $1 AND npc_id = $2 AND clue_id = ANY($3)
        AND evidence_kind IN ('physical_clue', 'contradiction')`,
    [townId, npcId, clueIds],
  );
  return result.rows.map((row) => ({ claimId: row.claim_id, clueId: row.clue_id }));
}

export interface OriginalAssertionRow {
  readonly transmissionId: string;
  readonly confirmedAt: Date;
}

/**
 * The earliest `original_assertion` transmission from `playerId` to `npcId`
 * for each claim — `D2-J` part 1's "the player confirmed a claim directly to
 * the NPC". Alleged hearsay is excluded: attributing a claim to someone else
 * is not confirming it as one's own.
 */
export async function readEarliestOriginalAssertions(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
  claimIds: readonly string[],
): Promise<ReadonlyMap<string, OriginalAssertionRow>> {
  if (claimIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly claim_id: string;
    readonly id: string;
    readonly created_at: Date;
  }>(
    `SELECT DISTINCT ON (claim_id) claim_id, id, created_at
       FROM public.claim_transmissions
      WHERE town_id = $1 AND speaker_actor_id = $2 AND recipient_actor_id = $3
        AND recipient_actor_type = 'npc' AND source_kind = 'original_assertion'
        AND claim_id = ANY($4)
      ORDER BY claim_id, created_at ASC`,
    [townId, playerId, npcId, claimIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.claim_id,
      { transmissionId: row.id, confirmedAt: row.created_at },
    ]),
  );
}

/** The earliest town-wide discovery instant for each clue this specific player discovered — `undefined` iff never discovered by that player. */
export async function readPlayerClueDiscoveredAt(
  pool: Pool,
  townId: string,
  playerId: string,
  clueIds: readonly string[],
): Promise<ReadonlyMap<string, Date>> {
  if (clueIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly clue_id: string;
    readonly created_at: Date;
  }>(
    `SELECT clue_id, MIN(created_at) AS created_at FROM public.clue_discoveries
      WHERE town_id = $1 AND player_id = $2 AND clue_id = ANY($3)
      GROUP BY clue_id`,
    [townId, playerId, clueIds],
  );
  return new Map(result.rows.map((row) => [row.clue_id, row.created_at]));
}

export interface RelationshipChangeKeyRow {
  readonly reasonKind:
    | "verified_testimony"
    | "evidence_presented"
    | "requested_item_given"
    | "promise_fulfilled"
    | "lie_established"
    | "promise_broken";
  readonly claimId: string | null;
  readonly clueId: string | null;
}

/** Every existing `relationship_changes` row for one (npc, player) pair — repeat-protection scope and `lie_established` history. */
export async function readRelationshipChangeKeys(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
): Promise<readonly RelationshipChangeKeyRow[]> {
  const result = await pool.query<{
    readonly reason_kind: RelationshipChangeKeyRow["reasonKind"];
    readonly claim_id: string | null;
    readonly clue_id: string | null;
  }>(
    `SELECT reason_kind, claim_id, clue_id FROM public.relationship_changes
      WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
    [townId, npcId, playerId],
  );
  return result.rows.map((row) => ({
    reasonKind: row.reason_kind,
    claimId: row.claim_id,
    clueId: row.clue_id,
  }));
}

/**
 * The active (never reversed) primary `player_testimony` row `sourceActorId`
 * contributed to `(npcId, claimId)`, if any — Show's `verified_testimony`
 * reason cites this row's own `source_root_transmission_id`, never a
 * separately re-derived one.
 */
export async function readActivePlayerTestimonyRootTransmission(
  pool: Pool,
  townId: string,
  npcId: string,
  claimId: string,
  sourceActorId: string,
): Promise<string | undefined> {
  const result = await pool.query<{
    readonly source_root_transmission_id: string | null;
  }>(
    `SELECT be.source_root_transmission_id
       FROM public.belief_evidence be
      WHERE be.town_id = $1 AND be.npc_id = $2 AND be.claim_id = $3
        AND be.evidence_kind = 'player_testimony'
        AND be.independent_source_actor_id = $4
        AND NOT EXISTS (
          SELECT 1 FROM public.belief_evidence r
           WHERE r.town_id = be.town_id AND r.reverses_evidence_id = be.id
        )
      LIMIT 1`,
    [townId, npcId, claimId, sourceActorId],
  );
  return result.rows[0]?.source_root_transmission_id ?? undefined;
}

export interface ReversalCandidateRow {
  readonly evidenceId: string;
  readonly signedWeight: number;
}

/**
 * `sourceActorId`'s own active (never reversed) contribution to
 * `(npcId, claimId)` — the primary testimony row itself, plus any of its
 * one-hop contradiction mirrors on this same claim resolved back to the same
 * effective source. Scoped to exactly this claim: `D2-J`'s "knowledge does
 * not teleport" never widens a reversal to a related claim.
 */
export async function readActiveContributionsForReversal(
  pool: Pool,
  townId: string,
  npcId: string,
  claimId: string,
  sourceActorId: string,
): Promise<readonly ReversalCandidateRow[]> {
  const result = await pool.query<{
    readonly id: string;
    readonly signed_weight: number;
  }>(
    `SELECT be.id, be.signed_weight
       FROM public.belief_evidence be
       LEFT JOIN public.belief_evidence primary_row
         ON primary_row.town_id = be.town_id AND primary_row.id = be.mirrors_evidence_id
      WHERE be.town_id = $1 AND be.npc_id = $2 AND be.claim_id = $3
        AND be.evidence_kind NOT IN ('source_reversal', 'corroboration')
        AND COALESCE(be.independent_source_actor_id, primary_row.independent_source_actor_id) = $4
        AND NOT EXISTS (
          SELECT 1 FROM public.belief_evidence r
           WHERE r.town_id = be.town_id AND r.reverses_evidence_id = be.id
        )`,
    [townId, npcId, claimId, sourceActorId],
  );
  return result.rows.map((row) => ({
    evidenceId: row.id,
    signedWeight: row.signed_weight,
  }));
}
