/**
 * `join_requests` claim, replay, and closure (Decision 005 §"join_requests").
 *
 * Scoped to `(town_id, idempotency_key)`, unlike the creation ledger: the
 * town already exists. A join attempt's replay window is one hour — long
 * enough to survive an interrupted first session, short enough to bound how
 * long the join-attempt secret stays a usable credential. Closing for
 * confirmation, expiry, or issue exhaustion always clears `join_secret_hash`
 * in the same statement that sets `replay_closed_at`, so a closed row can
 * never authenticate anyone even if compromised afterward.
 */

import { randomUUID } from "node:crypto";

import {
  resolveAmbiguousCommit,
  runSerializable,
  type TransactionContext,
} from "@the-town-remembers/database";
import type { Pool } from "pg";

import { admitRateLimit, RATE_LIMIT_BUCKETS } from "./rate-limits.js";

const CLAIM_MS = 30_000;
const REPLAY_WINDOW_MS = 60 * 60 * 1000;
const MAX_SESSION_ISSUE_COUNT = 3;

export interface JoinLedgerRow {
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly joinSecretHash: Buffer | null;
  readonly status: "processing" | "completed" | "failed";
  readonly playerId: string | null;
  readonly initialVisitId: string | null;
  readonly replayExpiresAt: Date | null;
  readonly bootstrapConfirmedAt: Date | null;
  readonly replayClosedAt: Date | null;
  readonly replayClosedReason: "confirmed" | "expired" | "exhausted" | null;
  readonly sessionIssueCount: number;
  readonly responseStatus: number | null;
  readonly responsePayload: unknown;
}

export type JoinClaimDecision =
  | { readonly outcome: "claimed" }
  | { readonly outcome: "hash_mismatch" }
  | { readonly outcome: "replay"; readonly row: JoinLedgerRow }
  | {
      readonly outcome: "closed";
      readonly reason: "confirmed" | "expired" | "exhausted";
    }
  | { readonly outcome: "rate_limited"; readonly retryAfterSeconds: number };

interface RawRow {
  readonly idempotency_key: string;
  readonly request_hash: Buffer;
  readonly join_secret_hash: Buffer | null;
  readonly status: "processing" | "completed" | "failed";
  readonly processing_expires_at: Date | null;
  readonly player_id: string | null;
  readonly initial_visit_id: string | null;
  readonly replay_expires_at: Date | null;
  readonly bootstrap_confirmed_at: Date | null;
  readonly replay_closed_at: Date | null;
  readonly replay_closed_reason: "confirmed" | "expired" | "exhausted" | null;
  readonly session_issue_count: number;
  readonly response_status: number | null;
  readonly response_payload: unknown;
}

const SELECT_COLUMNS = `idempotency_key, request_hash, join_secret_hash, status,
       processing_expires_at, player_id, initial_visit_id, replay_expires_at,
       bootstrap_confirmed_at, replay_closed_at, replay_closed_reason,
       session_issue_count, response_status, response_payload`;

function toLedgerRow(raw: RawRow): JoinLedgerRow {
  return {
    idempotencyKey: raw.idempotency_key,
    requestHash: raw.request_hash,
    joinSecretHash: raw.join_secret_hash,
    status: raw.status,
    playerId: raw.player_id,
    initialVisitId: raw.initial_visit_id,
    replayExpiresAt: raw.replay_expires_at,
    bootstrapConfirmedAt: raw.bootstrap_confirmed_at,
    replayClosedAt: raw.replay_closed_at,
    replayClosedReason: raw.replay_closed_reason,
    sessionIssueCount: raw.session_issue_count,
    responseStatus: raw.response_status,
    responsePayload: raw.response_payload,
  };
}

async function readRow(
  transaction: TransactionContext,
  townId: string,
  idempotencyKey: string,
): Promise<RawRow | undefined> {
  const rows = await transaction.query<RawRow>(
    `SELECT ${SELECT_COLUMNS} FROM public.join_requests
      WHERE town_id = $1 AND idempotency_key = $2`,
    [townId, idempotencyKey],
  );
  return rows[0];
}

async function readRowViaPool(
  pool: Pool,
  townId: string,
  idempotencyKey: string,
): Promise<RawRow | undefined> {
  const result = await pool.query<RawRow>(
    `SELECT ${SELECT_COLUMNS} FROM public.join_requests
      WHERE town_id = $1 AND idempotency_key = $2`,
    [townId, idempotencyKey],
  );
  return result.rows[0];
}

/**
 * Closes an open row for a reason discovered while reading it — expiry
 * discovered synchronously, or issue-count exhaustion. Confirmation closure
 * is `sessions.ts`'s job (`P3-05`), driven by the first authenticated view.
 */
async function closeRow(
  transaction: TransactionContext,
  townId: string,
  idempotencyKey: string,
  reason: "expired" | "exhausted",
  now: Date,
): Promise<void> {
  await transaction.query(
    `UPDATE public.join_requests
        SET replay_closed_at = $3, replay_closed_reason = $4,
            join_secret_hash = NULL, updated_at = $3
      WHERE town_id = $1 AND idempotency_key = $2`,
    [townId, idempotencyKey, now, reason],
  );
}

export interface JoinClaimParams {
  readonly townId: string;
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly joinSecretHash: Buffer;
  readonly rateLimitScopeKey: Buffer;
  readonly now: () => Date;
  readonly deadlineAt: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

type SingleAttemptOutcome = JoinClaimDecision | { readonly outcome: "live_processing" };

async function attemptOnce(
  pool: Pool,
  deadlineAt: number,
  params: Omit<JoinClaimParams, "deadlineAt" | "sleep">,
): Promise<SingleAttemptOutcome> {
  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();

    const existing = await readRow(transaction, params.townId, params.idempotencyKey);

    if (existing !== undefined) {
      if (!existing.request_hash.equals(params.requestHash)) {
        return { outcome: "hash_mismatch" } as const satisfies SingleAttemptOutcome;
      }
      if (existing.replay_closed_at !== null) {
        return {
          outcome: "closed",
          reason: existing.replay_closed_reason!,
        } as const satisfies SingleAttemptOutcome;
      }
      if (
        existing.replay_expires_at !== null &&
        existing.replay_expires_at.getTime() <= now.getTime()
      ) {
        await closeRow(
          transaction,
          params.townId,
          params.idempotencyKey,
          "expired",
          now,
        );
        return {
          outcome: "closed",
          reason: "expired",
        } as const satisfies SingleAttemptOutcome;
      }
      if (existing.status === "processing") {
        if (
          existing.processing_expires_at !== null &&
          existing.processing_expires_at.getTime() > now.getTime()
        ) {
          return { outcome: "live_processing" } as const satisfies SingleAttemptOutcome;
        }
        // A crashed first attempt whose claim expired: reclaim it. This is a
        // retry of an already-counted attempt, not a new operation, so it
        // never touches the rate limiter.
        await transaction.query(
          `UPDATE public.join_requests
              SET processing_token = $3, processing_expires_at = $4,
                  attempt_count = attempt_count + 1, updated_at = $5
            WHERE town_id = $1 AND idempotency_key = $2`,
          [
            params.townId,
            params.idempotencyKey,
            randomUUID(),
            new Date(now.getTime() + CLAIM_MS),
            now,
          ],
        );
        return { outcome: "claimed" } as const satisfies SingleAttemptOutcome;
      }
      if (existing.session_issue_count >= MAX_SESSION_ISSUE_COUNT) {
        await closeRow(
          transaction,
          params.townId,
          params.idempotencyKey,
          "exhausted",
          now,
        );
        return {
          outcome: "closed",
          reason: "exhausted",
        } as const satisfies SingleAttemptOutcome;
      }
      return {
        outcome: "replay",
        row: toLedgerRow(existing),
      } as const satisfies SingleAttemptOutcome;
    }

    // A genuinely new idempotency key: gate on the join rate bucket before
    // claiming, inside this same transaction (`D3-F`). `app_runtime` holds no
    // DELETE grant on this table (`0013_grants.sql`), so a claimed row can
    // never be un-inserted — the row must simply never be inserted when the
    // bucket rejects.
    const admission = await admitRateLimit(
      transaction,
      RATE_LIMIT_BUCKETS.join,
      params.rateLimitScopeKey,
      now,
    );
    if (!admission.admitted) {
      return {
        outcome: "rate_limited",
        retryAfterSeconds: admission.retryAfterSeconds,
      } as const satisfies SingleAttemptOutcome;
    }

    const inserted = await transaction.query<{ idempotency_key: string }>(
      `INSERT INTO public.join_requests
         (town_id, idempotency_key, request_hash, join_secret_hash, status,
          processing_token, processing_expires_at, attempt_count,
          replay_expires_at, session_issue_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, 1, $7, 0, $8, $8)
       ON CONFLICT (town_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [
        params.townId,
        params.idempotencyKey,
        params.requestHash,
        params.joinSecretHash,
        randomUUID(),
        new Date(now.getTime() + CLAIM_MS),
        new Date(now.getTime() + REPLAY_WINDOW_MS),
        now,
      ],
    );
    if (inserted.length === 0) {
      // Unreachable under serializable isolation: our own read above, in this
      // same transaction, already established that no row exists.
      throw new Error("join request claim vanished mid-claim");
    }
    return { outcome: "claimed" } as const satisfies SingleAttemptOutcome;
  });

  if (result.outcome === "committed") return result.value;

  const resolved = await resolveAmbiguousCommit(async () =>
    readRowViaPool(pool, params.townId, params.idempotencyKey),
  );
  if (resolved.outcome === "not_applied") return { outcome: "live_processing" };
  if (!resolved.value.request_hash.equals(params.requestHash))
    return { outcome: "hash_mismatch" };
  if (resolved.value.replay_closed_at !== null) {
    return { outcome: "closed", reason: resolved.value.replay_closed_reason! };
  }
  if (resolved.value.status === "processing") return { outcome: "live_processing" };
  return { outcome: "replay", row: toLedgerRow(resolved.value) };
}

const DEFAULT_SLEEP = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Claims the row for a first attempt, or resolves an existing one to a
 * replay or a closure. The presented join-attempt secret is *not* checked
 * here — `application/join.ts` compares it against the returned row only
 * after confirming the row is open, so an unknown key and a wrong secret are
 * indistinguishable (`404`, never `401`). A live concurrent first attempt is
 * retried with a short bounded wait rather than surfaced to the caller,
 * matching the creation ledger's approach for the same reason: this route's
 * wire contract has no `202 processing` shape.
 */
export async function claimJoinRequest(
  pool: Pool,
  params: JoinClaimParams,
): Promise<JoinClaimDecision> {
  const sleep = params.sleep ?? DEFAULT_SLEEP;

  for (;;) {
    const outcome = await attemptOnce(pool, params.deadlineAt, params);
    if (outcome.outcome !== "live_processing") return outcome;

    if (params.now().getTime() >= params.deadlineAt) {
      throw new Error("join claim deadline exceeded");
    }
    await sleep(50);
  }
}

export interface JoinCompleteParams {
  readonly townId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly initialVisitId: string | null;
  readonly responseStatus: number;
  readonly responsePayload: Readonly<Record<string, unknown>>;
  readonly now: () => Date;
}

export async function completeJoinRequest(
  pool: Pool,
  deadlineAt: number,
  params: JoinCompleteParams,
): Promise<void> {
  await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();
    await transaction.query(
      `UPDATE public.join_requests
          SET status = 'completed', player_id = $3, initial_visit_id = $4,
              response_status = $5, response_payload = $6,
              processing_token = NULL, processing_expires_at = NULL,
              session_issue_count = 1, completed_at = $7, updated_at = $7
        WHERE town_id = $1 AND idempotency_key = $2`,
      [
        params.townId,
        params.idempotencyKey,
        params.playerId,
        params.initialVisitId,
        params.responseStatus,
        JSON.stringify(params.responsePayload),
        now,
      ],
    );
  });
}

/**
 * Atomically claims one of the row's (at most three) session slots inside the
 * given transaction — the check and the increment are the same statement, so
 * concurrent replays cannot all read the count before any of them commits and
 * overshoot the cap. The caller mints the session in the same transaction
 * only if this returns `true`.
 */
export async function claimReplaySessionSlot(
  transaction: TransactionContext,
  townId: string,
  idempotencyKey: string,
  now: Date,
): Promise<boolean> {
  const claimed = await transaction.query<{ session_issue_count: number }>(
    `UPDATE public.join_requests
        SET session_issue_count = session_issue_count + 1, updated_at = $3
      WHERE town_id = $1 AND idempotency_key = $2 AND status = 'completed'
        AND replay_closed_at IS NULL AND session_issue_count < $4
      RETURNING session_issue_count`,
    [townId, idempotencyKey, now, MAX_SESSION_ISSUE_COUNT],
  );
  return claimed.length > 0;
}

/** Closes a row whose replay session slots are exhausted. */
export async function closeExhaustedReplay(
  pool: Pool,
  deadlineAt: number,
  townId: string,
  idempotencyKey: string,
  now: () => Date,
): Promise<void> {
  await runSerializable(pool, { deadlineAt }, async (transaction) => {
    await closeRow(transaction, townId, idempotencyKey, "exhausted", now());
  });
}
