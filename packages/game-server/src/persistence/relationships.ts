/**
 * Relationship-score and grievance reads for `NpcContextBuilder` (`P4-09`;
 * docs/008's disclosure-tier and stance gates,
 * `rules/beliefs/relationships.ts#stanceFor`).
 */

import type { Pool } from "pg";

export interface RelationshipRow {
  readonly trustScore: number;
  readonly suspicionScore: number;
  readonly revision: number;
}

/** Before any interaction there is no ledger row yet; the authored starting stance is neutral (`0`/`0`, revision `0`). */
const DEFAULT_RELATIONSHIP: RelationshipRow = {
  trustScore: 0,
  suspicionScore: 0,
  revision: 0,
};

export async function readRelationshipScores(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
): Promise<RelationshipRow> {
  const result = await pool.query<{
    readonly trust_score: number;
    readonly suspicion_score: number;
    readonly revision: number;
  }>(
    `SELECT trust_score, suspicion_score, revision FROM public.npc_player_relationships
      WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
    [townId, npcId, playerId],
  );
  const row = result.rows[0];
  if (row === undefined) return DEFAULT_RELATIONSHIP;
  return {
    trustScore: row.trust_score,
    suspicionScore: row.suspicion_score,
    revision: row.revision,
  };
}

/**
 * Whether this player has ever broken a promise to this NPC —
 * `disclosure/tiers.ts`'s `confidential` gate input. Grievances never
 * expire (`rules/beliefs/relationships.ts#hasGrievance`'s own rationale), so
 * this is a plain existence check with no time bound.
 */
export async function hasEverBrokenPromiseToNpc(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.promises
      WHERE town_id = $1 AND npc_id = $2 AND player_id = $3 AND status = 'broken'
      LIMIT 1`,
    [townId, npcId, playerId],
  );
  return result.rows.length > 0;
}
