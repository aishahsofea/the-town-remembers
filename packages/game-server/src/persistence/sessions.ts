/**
 * `player_sessions` row creation.
 *
 * `P3-05` adds authentication, monthly reissuance, and revocation; this is
 * only the mint every join path (first-time and replay) shares.
 */

import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@the-town-remembers/database";

export interface MintSessionParams {
  readonly townId: string;
  readonly playerId: string;
  readonly joinRequestId: string;
  readonly tokenHash: Buffer;
  readonly now: Date;
}

export async function mintSessionForPlayer(
  transaction: TransactionContext,
  params: MintSessionParams,
): Promise<{ readonly sessionId: string }> {
  const sessionId = randomUUID();
  await transaction.query(
    `INSERT INTO public.player_sessions
       (town_id, id, player_id, join_request_id, token_hash, status,
        last_cookie_issued_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, $6)`,
    [
      params.townId,
      sessionId,
      params.playerId,
      params.joinRequestId,
      params.tokenHash,
      params.now,
    ],
  );
  return { sessionId };
}
