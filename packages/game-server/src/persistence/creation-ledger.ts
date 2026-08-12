/**
 * `town_creation_requests` claim, replay, and completion (Decision 005
 * §"town_creation_requests").
 *
 * The table's primary key is `idempotency_key` alone — the town does not
 * exist yet when the first attempt arrives, so this ledger cannot be scoped
 * to one. The first claim freezes `content_version` and
 * `security_key_version`; every later attempt under the same key reuses those
 * values even after a deployment or a key rotation, which is what lets a
 * replay reconstruct the identical `inviteUrl`.
 */

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  DatabaseError,
  resolveAmbiguousCommit,
  runSerializable,
  type TransactionContext,
} from "@the-town-remembers/database";

import { admitRateLimit, RATE_LIMIT_BUCKETS } from "./rate-limits.js";

/** Matches the join-request ledger's documented claim duration. */
const CLAIM_MS = 30_000;

export interface CreationLedgerRow {
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly contentVersion: string;
  readonly securityKeyVersion: string;
  readonly status: "processing" | "completed" | "failed";
  readonly townId: string | null;
  readonly responseStatus: number | null;
  readonly responsePayload: unknown;
}

export type CreationClaimDecision =
  | {
      readonly outcome: "claimed";
      readonly contentVersion: string;
      readonly securityKeyVersion: string;
      readonly processingToken: string;
    }
  | { readonly outcome: "replay"; readonly row: CreationLedgerRow }
  | { readonly outcome: "hash_mismatch" }
  | { readonly outcome: "rate_limited"; readonly retryAfterSeconds: number };

interface RawRow {
  readonly idempotency_key: string;
  readonly request_hash: Buffer;
  readonly content_version: string;
  readonly security_key_version: string;
  readonly status: "processing" | "completed" | "failed";
  readonly processing_token: string | null;
  readonly processing_expires_at: Date | null;
  readonly town_id: string | null;
  readonly response_status: number | null;
  readonly response_payload: unknown;
}

function toLedgerRow(raw: RawRow): CreationLedgerRow {
  return {
    idempotencyKey: raw.idempotency_key,
    requestHash: raw.request_hash,
    contentVersion: raw.content_version,
    securityKeyVersion: raw.security_key_version,
    status: raw.status,
    townId: raw.town_id,
    responseStatus: raw.response_status,
    responsePayload: raw.response_payload,
  };
}

async function readRow(
  transaction: TransactionContext,
  idempotencyKey: string,
): Promise<RawRow | undefined> {
  const rows = await transaction.query<RawRow>(
    `SELECT idempotency_key, request_hash, content_version, security_key_version, status,
            processing_token, processing_expires_at, town_id, response_status, response_payload
       FROM public.town_creation_requests
      WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return rows[0];
}

async function readRowViaPool(
  pool: Pool,
  idempotencyKey: string,
): Promise<RawRow | undefined> {
  const result = await pool.query<RawRow>(
    `SELECT idempotency_key, request_hash, content_version, security_key_version, status,
            processing_token, processing_expires_at, town_id, response_status, response_payload
       FROM public.town_creation_requests
      WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return result.rows[0];
}

/**
 * One claim attempt, and one attempt only: it never waits. `claimCreationRequest`
 * is the caller that turns a live concurrent claim into a bounded wait.
 */
type SingleAttemptOutcome =
  CreationClaimDecision | { readonly outcome: "live_processing" };

async function attemptOnce(
  pool: Pool,
  deadlineAt: number,
  params: {
    readonly idempotencyKey: string;
    readonly requestHash: Buffer;
    readonly contentVersion: string;
    readonly securityKeyVersion: string;
    readonly rateLimitScopeKey: Buffer;
    readonly now: () => Date;
  },
): Promise<SingleAttemptOutcome> {
  const processingToken = randomUUID();
  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();
    const claimExpiry = new Date(now.getTime() + CLAIM_MS);

    const existing = await readRow(transaction, params.idempotencyKey);

    if (existing !== undefined) {
      if (!existing.request_hash.equals(params.requestHash)) {
        return { outcome: "hash_mismatch" } as const satisfies SingleAttemptOutcome;
      }
      if (existing.status !== "processing") {
        return {
          outcome: "replay",
          row: toLedgerRow(existing),
        } as const satisfies SingleAttemptOutcome;
      }
      if (
        existing.processing_expires_at !== null &&
        existing.processing_expires_at.getTime() > now.getTime()
      ) {
        return { outcome: "live_processing" } as const satisfies SingleAttemptOutcome;
      }

      // The prior claim expired without completing (a crashed attempt):
      // reclaim it. This is a retry of an already-counted attempt, not a new
      // operation, so it never touches the rate limiter.
      await transaction.query(
        `UPDATE public.town_creation_requests
            SET processing_token = $2, processing_expires_at = $3,
                attempt_count = attempt_count + 1, updated_at = $4
          WHERE idempotency_key = $1 AND status = 'processing'`,
        [params.idempotencyKey, processingToken, claimExpiry, now],
      );
      return {
        outcome: "claimed",
        contentVersion: existing.content_version,
        securityKeyVersion: existing.security_key_version,
        processingToken,
      } as const satisfies SingleAttemptOutcome;
    }

    // A genuinely new idempotency key: gate on the town-creation rate bucket
    // before claiming, inside this same transaction (`D3-F`). `app_runtime`
    // holds no DELETE grant on this table (`0013_grants.sql`), so a claimed
    // row can never be un-inserted — the row must simply never be inserted
    // when the bucket rejects.
    const admission = await admitRateLimit(
      transaction,
      RATE_LIMIT_BUCKETS.townCreation,
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
      `INSERT INTO public.town_creation_requests
         (idempotency_key, request_hash, content_version, security_key_version,
          status, processing_token, processing_expires_at, attempt_count,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, 1, $7, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [
        params.idempotencyKey,
        params.requestHash,
        params.contentVersion,
        params.securityKeyVersion,
        processingToken,
        claimExpiry,
        now,
      ],
    );
    if (inserted.length === 0) {
      // Unreachable under serializable isolation: our own read above, in this
      // same transaction, already established that no row exists.
      throw new DatabaseError("unknown");
    }
    return {
      outcome: "claimed",
      contentVersion: params.contentVersion,
      securityKeyVersion: params.securityKeyVersion,
      processingToken,
    } as const satisfies SingleAttemptOutcome;
  });

  if (result.outcome === "committed") return result.value;

  // The commit's fate is unknown; read the durable ledger rather than guess.
  const resolved = await resolveAmbiguousCommit(async () =>
    readRowViaPool(pool, params.idempotencyKey),
  );
  if (resolved.outcome === "not_applied") return { outcome: "live_processing" };
  if (!resolved.value.request_hash.equals(params.requestHash))
    return { outcome: "hash_mismatch" };
  if (resolved.value.status !== "processing")
    return { outcome: "replay", row: toLedgerRow(resolved.value) };
  if (resolved.value.processing_token === processingToken) {
    return {
      outcome: "claimed",
      contentVersion: resolved.value.content_version,
      securityKeyVersion: resolved.value.security_key_version,
      processingToken,
    };
  }
  return { outcome: "live_processing" };
}

export interface ClaimParams {
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly contentVersion: string;
  readonly securityKeyVersion: string;
  readonly rateLimitScopeKey: Buffer;
  readonly now: () => Date;
  readonly deadlineAt: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_SLEEP = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Claims the row for this attempt, replays a terminal one, or reports a
 * fingerprint mismatch. A live concurrent claim (another request already
 * holds an unexpired processing token) is retried with a short bounded wait
 * rather than surfaced to the caller — this route's wire contract has no
 * `202 processing` shape, so the two concurrent callers converge on the same
 * terminal replay instead.
 */
export async function claimCreationRequest(
  pool: Pool,
  params: ClaimParams,
): Promise<CreationClaimDecision> {
  const sleep = params.sleep ?? DEFAULT_SLEEP;

  for (;;) {
    const outcome = await attemptOnce(pool, params.deadlineAt, params);
    if (outcome.outcome !== "live_processing") return outcome;

    if (params.now().getTime() >= params.deadlineAt) {
      throw new DatabaseError("deadline_exceeded");
    }
    await sleep(50);
  }
}

export interface CompleteParams {
  readonly idempotencyKey: string;
  readonly processingToken: string;
  readonly townId: string;
  readonly responseStatus: number;
  readonly responsePayload: Readonly<Record<string, unknown>>;
  readonly now: () => Date;
}

/** Marks a claimed row completed, conditional on the current processing claim. */
export async function completeCreationRequest(
  pool: Pool,
  deadlineAt: number,
  params: CompleteParams,
): Promise<void> {
  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();
    const updated = await transaction.query<{ readonly idempotency_key: string }>(
      `UPDATE public.town_creation_requests
          SET status = 'completed', town_id = $2, response_status = $3,
              response_payload = $4, processing_token = NULL,
              processing_expires_at = NULL, completed_at = $5, updated_at = $5
        WHERE idempotency_key = $1 AND status = 'processing'
          AND processing_token = $6
        RETURNING idempotency_key`,
      [
        params.idempotencyKey,
        params.townId,
        params.responseStatus,
        JSON.stringify(params.responsePayload),
        now,
        params.processingToken,
      ],
    );
    return { matched: updated.length > 0 };
  });

  if (result.outcome === "committed") {
    if (result.value.matched) return;
    const row = await readRowViaPool(pool, params.idempotencyKey);
    if (row?.status === "completed" && row.town_id === params.townId) return;
    throw new DatabaseError("unknown");
  }

  const row = await readRowViaPool(pool, params.idempotencyKey);
  if (row?.status === "completed" && row.town_id === params.townId) return;
  throw new DatabaseError("ambiguous_commit");
}

/** Finds a materialized town by the deterministic hash derived from a creation key. */
export async function readTownIdByInviteHash(
  pool: Pool,
  inviteHash: Uint8Array,
): Promise<string | undefined> {
  const result = await pool.query<{ readonly id: string }>(
    "SELECT id FROM public.towns WHERE invite_token_hash = $1",
    [Buffer.from(inviteHash)],
  );
  return result.rows[0]?.id;
}
