/**
 * `api_rate_limits` token buckets (`D3-F`) and their scope-key derivation.
 *
 * `tokens_milli` holds tokens x 1000 so the integer refill arithmetic is
 * exact: `floor(elapsedMs x ratePerWindow x 1000 / windowMs)`, clamped to
 * `burst x 1000`, admitted iff the clamped value is at least `1000`. The
 * table's primary key `(scope_kind, scope_key, bucket_kind)` carries no
 * `town_id`, so a per-player or per-town scope folds the town into
 * `scope_key` itself (`rateScopeKey`) — the direct fix for §9.4's gap.
 *
 * The admission check for an *existing* bucket row is one guarded `UPDATE`:
 * the refill, the clamp, and the `>= 1000` admission test all read the row's
 * pre-update columns in the same statement that consumes the token, so two
 * concurrent checks against the same scope cannot both observe the same
 * stale balance. A bucket's very first check is a separate `INSERT ... ON
 * CONFLICT DO NOTHING`, since there is no prior row to refill from — a fresh
 * bucket always starts full, so it is unconditionally admitted.
 */

import { createHash } from "node:crypto";

import type {
  RateLimitBucketKind,
  RateLimitScopeKind,
  TransactionContext,
} from "@the-town-remembers/database";
import { runSerializable } from "@the-town-remembers/database";
import type { Pool } from "pg";

const SCOPE_KEY_DOMAIN = "rate-scope:v1";

/** No town exists yet when a town-creation attempt is scoped (`ip_hash`). */
export const NO_TOWN_SCOPE = "";

/**
 * `SHA-256("rate-scope:v1\n" + scopeKind + "\n" + townId + "\n" + subjectId)`.
 * Folding the town into every scope — not only the per-player one — keeps one
 * derivation uniform across all three configured buckets rather than
 * special-casing the two `ip_hash`-scoped ones.
 */
export function rateScopeKey(
  scopeKind: RateLimitScopeKind,
  townId: string,
  subjectId: string,
): Buffer {
  return createHash("sha256")
    .update(`${SCOPE_KEY_DOMAIN}\n${scopeKind}\n${townId}\n${subjectId}`, "utf8")
    .digest();
}

export interface RateLimitBucketConfig {
  readonly bucketKind: RateLimitBucketKind;
  readonly scopeKind: RateLimitScopeKind;
  /** Tokens granted per `windowMs`, at full sustained rate. */
  readonly ratePerWindow: number;
  readonly windowMs: number;
  readonly burst: number;
}

const MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * MINUTE_MS;

/**
 * The five buckets this phase checks. `D4-S`: a `model_action` admission
 * uses **both** `modelActionPlayer` and `modelActionTown` together — the
 * per-player bucket bounds one player's own burst, the per-town bucket
 * bounds the town's shared model spend regardless of which player is
 * asking. Both share `bucket_kind: "model_action"` but differ in
 * `scope_kind` (`"player"` vs `"town"`), so they occupy distinct
 * `api_rate_limits` rows under the table's own `(scope_kind, scope_key,
 * bucket_kind)` primary key — no schema change needed. Charging both, in
 * the same transaction as the action claim, before the `player_actions`
 * row is created, is `model-executor.ts`'s job (`P4-10`); this module only
 * defines the bucket shapes.
 */
export const RATE_LIMIT_BUCKETS = {
  playerView: {
    bucketKind: "player_view",
    scopeKind: "player",
    ratePerWindow: 30,
    windowMs: MINUTE_MS,
    burst: 10,
  },
  townCreation: {
    bucketKind: "town_creation",
    scopeKind: "ip_hash",
    ratePerWindow: 5,
    windowMs: FIFTEEN_MINUTES_MS,
    burst: 5,
  },
  join: {
    bucketKind: "join",
    scopeKind: "ip_hash",
    ratePerWindow: 10,
    windowMs: FIFTEEN_MINUTES_MS,
    burst: 10,
  },
  modelActionPlayer: {
    bucketKind: "model_action",
    scopeKind: "player",
    ratePerWindow: 6,
    windowMs: MINUTE_MS,
    burst: 3,
  },
  modelActionTown: {
    bucketKind: "model_action",
    scopeKind: "town",
    ratePerWindow: 30,
    windowMs: MINUTE_MS,
    burst: 10,
  },
} as const satisfies Record<string, RateLimitBucketConfig>;

export type RateLimitDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly retryAfterSeconds: number };

/** The token balance a bucket would have right now, clamped to its burst. */
function clampedMilli(
  tokensMilli: number,
  lastRefillAt: Date,
  bucket: RateLimitBucketConfig,
  now: Date,
): number {
  const elapsedMs = Math.max(now.getTime() - lastRefillAt.getTime(), 0);
  const refillMilli = Math.floor(
    (elapsedMs * bucket.ratePerWindow * 1000) / bucket.windowMs,
  );
  return Math.min(tokensMilli + refillMilli, bucket.burst * 1000);
}

/**
 * Seconds until the clamped balance would reach one full token (1000 milli).
 * Its one caller only reaches this after the guarded consuming `UPDATE`
 * already failed against this identical row snapshot, so `deficitMilli` is
 * always positive here — a fresh bucket is admitted unconditionally and
 * never reaches this function at all.
 */
function retryAfterSecondsFor(
  tokensMilli: number,
  lastRefillAt: Date,
  bucket: RateLimitBucketConfig,
  now: Date,
): number {
  const deficitMilli = 1000 - clampedMilli(tokensMilli, lastRefillAt, bucket, now);
  const msNeeded = Math.ceil(
    (deficitMilli * bucket.windowMs) / (bucket.ratePerWindow * 1000),
  );
  return Math.ceil(msNeeded / 1000);
}

/**
 * Admits or rejects one request against one bucket, inside the caller's
 * already-open serializable transaction (`D3-F`). Never inserts a row for a
 * rejection: a caller gating a ledger claim on this (creation, join) can
 * therefore leave no trace of a rate-limited attempt without needing a
 * `DELETE` grant it does not hold.
 */
export async function admitRateLimit(
  transaction: TransactionContext,
  bucket: RateLimitBucketConfig,
  scopeKey: Buffer,
  now: Date,
): Promise<RateLimitDecision> {
  const burstMilli = bucket.burst * 1000;

  const inserted = await transaction.query<{ tokens_milli: number }>(
    `INSERT INTO public.api_rate_limits
       (scope_kind, scope_key, bucket_kind, tokens_milli, last_refill_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, $5)
     ON CONFLICT (scope_kind, scope_key, bucket_kind) DO NOTHING
     RETURNING tokens_milli`,
    [bucket.scopeKind, scopeKey, bucket.bucketKind, burstMilli - 1000, now],
  );
  if (inserted.length > 0) return { admitted: true };

  const consumed = await transaction.query<{ tokens_milli: number }>(
    `UPDATE public.api_rate_limits
        SET tokens_milli = LEAST(
              tokens_milli + (FLOOR(GREATEST(
                (EXTRACT(EPOCH FROM ($4::timestamptz - last_refill_at)) * 1000)::INT8, 0
              ) * $5::INT8 / $6::INT8))::INT8,
              $7::INT8
            ) - 1000,
            last_refill_at = $4,
            updated_at = $4
      WHERE scope_kind = $1 AND scope_key = $2 AND bucket_kind = $3
        AND LEAST(
              tokens_milli + (FLOOR(GREATEST(
                (EXTRACT(EPOCH FROM ($4::timestamptz - last_refill_at)) * 1000)::INT8, 0
              ) * $5::INT8 / $6::INT8))::INT8,
              $7::INT8
            ) >= 1000
      RETURNING tokens_milli`,
    [
      bucket.scopeKind,
      scopeKey,
      bucket.bucketKind,
      now,
      bucket.ratePerWindow * 1000,
      bucket.windowMs,
      burstMilli,
    ],
  );
  if (consumed.length > 0) return { admitted: true };

  const current = await transaction.query<{
    tokens_milli: number;
    last_refill_at: Date;
  }>(
    `SELECT tokens_milli, last_refill_at FROM public.api_rate_limits
      WHERE scope_kind = $1 AND scope_key = $2 AND bucket_kind = $3`,
    [bucket.scopeKind, scopeKey, bucket.bucketKind],
  );
  const row = current[0];
  // A row must exist here: the fresh-bucket insert above only no-ops on a
  // conflict, which means a row was already present.
  if (!row) return { admitted: false, retryAfterSeconds: 1 };
  return {
    admitted: false,
    retryAfterSeconds: retryAfterSecondsFor(
      row.tokens_milli,
      row.last_refill_at,
      bucket,
      now,
    ),
  };
}

/**
 * Standalone admission check that opens its own serializable transaction —
 * for a route with no other write to share one with (`player-view`'s poll).
 * An ambiguous commit is treated as not admitted: the connection was lost
 * exactly at the moment this check's fate became unknowable, and a rate
 * limit's failure mode should lean conservative rather than guess generous.
 */
export async function checkRateLimit(
  pool: Pool,
  deadlineAt: number,
  bucket: RateLimitBucketConfig,
  scopeKey: Buffer,
  now: Date,
): Promise<RateLimitDecision> {
  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    admitRateLimit(transaction, bucket, scopeKey, now),
  );
  return result.outcome === "committed"
    ? result.value
    : { admitted: false, retryAfterSeconds: 1 };
}
