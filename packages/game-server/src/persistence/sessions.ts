/**
 * `player_sessions` row creation, authentication, and refresh (`P3-05`).
 *
 * An active row is accepted until it is revoked or its town retires — there
 * is no inactivity expiry. Retirement outranks even a valid session: it is
 * checked in the same query as the session lookup, so a revoked-vs-retired
 * distinction cannot be forged by presenting an otherwise-valid cookie.
 */

import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@the-town-remembers/database";
import type { Pool } from "pg";

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

/** Verifies that an ambiguously committed join stored this exact minted session. */
export async function hasActiveSessionForJoin(
  pool: Pool,
  params: {
    readonly townId: string;
    readonly playerId: string;
    readonly joinRequestId: string;
    readonly tokenHash: Buffer;
  },
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM public.player_sessions
      WHERE town_id = $1 AND player_id = $2 AND join_request_id = $3
        AND token_hash = $4 AND status = 'active'
      LIMIT 1`,
    [params.townId, params.playerId, params.joinRequestId, params.tokenHash],
  );
  return result.rows.length > 0;
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly playerId: string;
  readonly joinRequestId: string;
  readonly lastCookieIssuedAt: Date;
}

export type AuthenticateOutcome =
  | { readonly outcome: "authenticated"; readonly session: AuthenticatedSession }
  | { readonly outcome: "invalid_session" }
  | { readonly outcome: "town_retired" };

interface AuthenticateRow {
  readonly town_status: string;
  readonly id: string | null;
  readonly player_id: string | null;
  readonly join_request_id: string | null;
  readonly last_cookie_issued_at: Date | null;
}

/** Scoped to `(town_id, token_hash)`, joined against the town's own status. */
export async function authenticate(
  pool: Pool,
  townId: string,
  tokenHash: Buffer,
): Promise<AuthenticateOutcome> {
  const result = await pool.query<AuthenticateRow>(
    `SELECT t.status AS town_status, ps.id, ps.player_id, ps.join_request_id,
            ps.last_cookie_issued_at
       FROM public.towns t
       LEFT JOIN public.player_sessions ps
         ON ps.town_id = t.id AND ps.token_hash = $2 AND ps.status = 'active'
      WHERE t.id = $1`,
    [townId, tokenHash],
  );
  const row = result.rows[0];
  if (!row) return { outcome: "invalid_session" };
  if (row.town_status === "retired") return { outcome: "town_retired" };
  if (
    row.id === null ||
    row.player_id === null ||
    row.join_request_id === null ||
    row.last_cookie_issued_at === null
  ) {
    return { outcome: "invalid_session" };
  }
  return {
    outcome: "authenticated",
    session: {
      sessionId: row.id,
      playerId: row.player_id,
      joinRequestId: row.join_request_id,
      lastCookieIssuedAt: row.last_cookie_issued_at,
    },
  };
}

const REISSUE_INTERVAL_DAYS = 30;

/**
 * Elects at most one of any concurrently authenticated responses to reissue
 * the cookie: the `WHERE` clause is the only lock. Returns whether *this*
 * call won the election, so the caller emits `Set-Cookie` only then (`D3-R`).
 */
export async function reissueIfDue(
  pool: Pool,
  townId: string,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - REISSUE_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
  const result = await pool.query(
    `UPDATE public.player_sessions
        SET last_cookie_issued_at = $3, updated_at = $3
      WHERE town_id = $1 AND id = $2 AND last_cookie_issued_at <= $4`,
    [townId, sessionId, now, cutoff],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Closes the join replay window for confirmation and clears the join secret,
 * in the same statement (`D3-S`). A no-op if the window is already closed —
 * confirmation runs on every authenticated view, not only the first.
 */
export async function confirmBootstrap(
  pool: Pool,
  townId: string,
  joinRequestId: string,
  now: Date,
): Promise<void> {
  await pool.query(
    `UPDATE public.join_requests
        SET bootstrap_confirmed_at = $3, replay_closed_at = $3,
            replay_closed_reason = 'confirmed', join_secret_hash = NULL,
            updated_at = $3
      WHERE town_id = $1 AND idempotency_key = $2
        AND bootstrap_confirmed_at IS NULL AND replay_closed_at IS NULL`,
    [townId, joinRequestId, now],
  );
}
