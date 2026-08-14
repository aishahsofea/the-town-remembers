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

export interface BrokenSecretPromiseCandidate {
  readonly promiseId: string;
  readonly npcId: string;
}

/**
 * Active secrecy promises this structured transmission would break. Telling
 * the requesting NPC is explicitly allowed, so that requester is excluded in
 * SQL and only genuinely terminal transitions are returned.
 */
export async function readSecretPromisesBrokenByTell(
  pool: Pool,
  townId: string,
  playerId: string,
  protectedClaimId: string,
  recipientNpcId: string,
): Promise<readonly BrokenSecretPromiseCandidate[]> {
  const result = await pool.query<{ readonly id: string; readonly npc_id: string }>(
    `SELECT id, npc_id FROM public.promises
      WHERE town_id = $1 AND player_id = $2 AND kind = 'keep_secret'
        AND protected_claim_id = $3 AND status = 'active' AND npc_id <> $4
      ORDER BY id`,
    [townId, playerId, protectedClaimId, recipientNpcId],
  );
  return result.rows.map((row) => ({ promiseId: row.id, npcId: row.npc_id }));
}

export interface AskPromiseOfferReadState {
  readonly activePromises: readonly ActivePromiseRow[];
  readonly oldChapelKey:
    | {
        readonly itemId: string;
        readonly displayName: string;
        readonly heldByActorId: string | null;
      }
    | undefined;
  readonly larkDamagePreviouslyDisclosed: boolean;
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

/**
 * Minimal database state needed to derive Ask's authored promise offers.
 * The offer itself is stored only in the completed action response; these
 * reads merely prove the current gates while the model executor's town-
 * revision guard protects the later atomic commit.
 */
export async function readAskPromiseOfferState(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
  larkDamageClaimId: string | undefined,
): Promise<AskPromiseOfferReadState> {
  const priorDisclosure =
    larkDamageClaimId === undefined
      ? Promise.resolve({ rows: [{ exists: false }] })
      : pool.query<{ readonly exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM public.claim_transmissions
              WHERE town_id = $1 AND speaker_actor_id = $2
                AND recipient_actor_id = $3 AND recipient_actor_type = 'player'
                AND claim_id = $4
           ) AS exists`,
          [townId, npcId, playerId, larkDamageClaimId],
        );
  const [activePromises, keyResult, priorResult] = await Promise.all([
    readActivePromises(pool, townId, npcId, playerId),
    pool.query<{
      readonly id: string;
      readonly display_name: string;
      readonly held_by_actor_id: string | null;
    }>(
      `SELECT i.id, se.display_name, i.held_by_actor_id
         FROM public.items i
         JOIN public.story_entities se ON se.town_id = i.town_id AND se.id = i.id
        WHERE i.town_id = $1 AND se.entity_key = 'old_chapel_key'`,
      [townId],
    ),
    priorDisclosure,
  ]);
  const key = keyResult.rows[0];
  return {
    activePromises,
    oldChapelKey:
      key === undefined
        ? undefined
        : {
            itemId: key.id,
            displayName: key.display_name,
            heldByActorId: key.held_by_actor_id,
          },
    larkDamagePreviouslyDisclosed: priorResult.rows[0]?.exists ?? false,
  };
}
