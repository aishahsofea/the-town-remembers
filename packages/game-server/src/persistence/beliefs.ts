/**
 * Claim lookup and belief-score reads for `NpcContextBuilder`'s disclosure
 * candidates (`P4-09`; docs/008's belief/contestation gate,
 * `rules/beliefs/labels.ts#isSelectedBelief`).
 *
 * A claim or belief row absent from the returned map is not an error: a
 * claim with no `claims` row has never been normalized in this town, and an
 * `npc_beliefs` row is created only once evidence exists (Decision 008's
 * ledger is append-only and current-aggregate-on-first-write). Callers treat
 * either absence as score `0` / label `doubtful` — unbelieved, not unknown.
 */

import type { Pool } from "pg";

/** `claimKey -> claim UUID`, resolved by `claims.normalized_key` (`content#claimNormalizedKeys`). */
export async function readClaimIdsByNormalizedKeys(
  pool: Pool,
  townId: string,
  normalizedKeys: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (normalizedKeys.length === 0) return new Map();
  const result = await pool.query<{
    readonly id: string;
    readonly normalized_key: string;
  }>(
    `SELECT id, normalized_key FROM public.claims
      WHERE town_id = $1 AND normalized_key = ANY($2)`,
    [townId, normalizedKeys],
  );
  return new Map(result.rows.map((row) => [row.normalized_key, row.id]));
}

export interface NpcBeliefRow {
  readonly claimId: string;
  readonly score: number;
  readonly label: string;
  readonly revision: number;
}

/** Current belief rows for one NPC across a set of claims — present rows only. */
export async function readNpcBeliefs(
  pool: Pool,
  townId: string,
  npcId: string,
  claimIds: readonly string[],
): Promise<ReadonlyMap<string, NpcBeliefRow>> {
  if (claimIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly claim_id: string;
    readonly score: number;
    readonly label: string;
    readonly revision: number;
  }>(
    `SELECT claim_id, score, label, revision FROM public.npc_beliefs
      WHERE town_id = $1 AND npc_id = $2 AND claim_id = ANY($3)`,
    [townId, npcId, claimIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.claim_id,
      {
        claimId: row.claim_id,
        score: row.score,
        label: row.label,
        revision: row.revision,
      },
    ]),
  );
}

/**
 * The NPC's belief scores across every claim that contradicts `claimId`
 * (`claim_relations` stores both directions, so this is a single hop). A
 * contradicting claim with no belief row contributes `0` — no evidence
 * against it is not the same as evidence at zero, but it is the correct
 * input to `contestationLead`'s "no contradicting evidence" case either way.
 */
export async function readContradictingClaimScores(
  pool: Pool,
  townId: string,
  npcId: string,
  claimId: string,
): Promise<readonly number[]> {
  const result = await pool.query<{ readonly score: number }>(
    `SELECT COALESCE(nb.score, 0) AS score
       FROM public.claim_relations cr
       LEFT JOIN public.npc_beliefs nb
         ON nb.town_id = cr.town_id AND nb.npc_id = $2 AND nb.claim_id = cr.claim_b_id
      WHERE cr.town_id = $1 AND cr.claim_a_id = $3 AND cr.relation_kind = 'contradicts'`,
    [townId, npcId, claimId],
  );
  return result.rows.map((row) => row.score);
}
