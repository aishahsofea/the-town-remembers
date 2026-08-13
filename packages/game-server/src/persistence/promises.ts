/**
 * Active-promise reads for `NpcContextBuilder` (`P4-09`; docs/008's
 * promise-context gate, `rules/world/promises.ts#hasActivePromise`).
 */

import type { PromiseKind } from "@the-town-remembers/database/domains";
import type { PromiseKey } from "@the-town-remembers/rules";
import type { Pool } from "pg";

export interface ActivePromiseRow {
  readonly promiseId: string;
  readonly kind: PromiseKind;
  readonly protectedClaimId: string | null;
  readonly itemId: string | null;
}

/**
 * Active promises between one NPC and one player — at most one per
 * `(npc, player, kind, subject)` (`uq_promises__active_secret`/
 * `uq_promises__active_item`), so this is never more than two rows.
 */
export async function readActivePromises(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
): Promise<readonly ActivePromiseRow[]> {
  const result = await pool.query<{
    readonly id: string;
    readonly kind: PromiseKind;
    readonly protected_claim_id: string | null;
    readonly item_id: string | null;
  }>(
    `SELECT id, kind, protected_claim_id, item_id FROM public.promises
      WHERE town_id = $1 AND npc_id = $2 AND player_id = $3 AND status = 'active'`,
    [townId, npcId, playerId],
  );
  return result.rows.map((row) => ({
    promiseId: row.id,
    kind: row.kind,
    protectedClaimId: row.protected_claim_id,
    itemId: row.item_id,
  }));
}

/** Projects rows onto `rules/world/promises.ts#PromiseKey` for `hasActivePromise`. */
export function toPromiseKeys(
  npcId: string,
  rows: readonly ActivePromiseRow[],
): readonly PromiseKey[] {
  return rows.map((row) => ({
    npcId,
    kind: row.kind,
    protectedClaimId: row.protectedClaimId,
    protectedItemId: row.itemId,
  }));
}
