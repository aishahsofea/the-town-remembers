/**
 * Serializable transactions with bounded retry and honest ambiguity.
 *
 * CockroachDB runs SERIALIZABLE by default, which means a transaction can be
 * told after the fact that it must run again. Decision 007 bounds that at three
 * retries with jittered 25/75/225 ms delays, inside the operation's deadline.
 *
 * The callback is re-run whole. That is the point of the design rather than an
 * implementation shortcut: every conditional write re-reads its precondition on
 * the retry, so a transfer that lost a race cannot succeed on the second
 * attempt using the first attempt's stale read.
 *
 * A commit whose acknowledgement is lost is a third outcome, not a failure.
 * The network answered neither yes nor no, so retrying blindly could apply the
 * work twice. `runSerializable` therefore returns an `ambiguous` result whose
 * type has no value to unwrap: the caller has to read its durable operation
 * identity and decide, which is exactly what the accepted contract requires.
 */

import { DATABASE } from "@the-town-remembers/runtime-config/database";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import { DatabaseError, isSerializationConflict, toDatabaseError } from "./errors.js";

export const RETRY_DELAYS_MS = DATABASE.serializationRetryDelaysMs;
export const RETRY_LIMIT = DATABASE.serializationRetryLimit;

export interface TransactionContext {
  /** Parameterized query only; the helper never interpolates a value. */
  query<Row extends QueryResultRow>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>;
}

export interface SerializableOptions {
  /** Absolute epoch milliseconds after which no further attempt may start. */
  readonly deadlineAt: number;
  readonly now?: () => number;
  /** Injected for deterministic tests; production uses `Math.random`. */
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly onAttempt?: (attempt: number) => void;
}

export type SerializableResult<T> =
  | { readonly outcome: "committed"; readonly value: T; readonly retries: number }
  | {
      /**
       * The commit may or may not have applied. There is deliberately no value
       * here: the caller must read the durable ledger before doing anything
       * else.
       */
      readonly outcome: "ambiguous";
      readonly retries: number;
    };

const DEFAULT_SLEEP = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Full jitter around the accepted delay, so a fleet of retrying workers does
 * not synchronize into a second collision.
 */
export function jitteredDelay(attempt: number, random: () => number): number {
  const base = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1) ?? 0;
  return Math.round(base * (0.5 + random()));
}

function contextFor(client: PoolClient): TransactionContext {
  return {
    async query<Row extends QueryResultRow>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<Row[]> {
      const result = await client.query<Row>(sql, [...parameters]);
      return result.rows;
    },
  };
}

/**
 * An error raised by `COMMIT` itself leaves the outcome genuinely unknown: the
 * server may have committed before the connection failed. Anything raised
 * earlier definitively did not commit.
 */
function isAmbiguousCommitFailure(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === undefined || code.startsWith("08") || code === "57P01";
}

export async function runSerializable<T>(
  pool: Pool,
  options: SerializableOptions,
  body: (transaction: TransactionContext) => Promise<T>,
): Promise<SerializableResult<T>> {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? DEFAULT_SLEEP;

  for (let attempt = 0; ; attempt += 1) {
    if (now() >= options.deadlineAt) {
      throw new DatabaseError("deadline_exceeded");
    }
    options.onAttempt?.(attempt);

    const client = await pool.connect();
    let committing = false;
    try {
      await client.query("BEGIN");
      const value = await body(contextFor(client));
      committing = true;
      await client.query("COMMIT");
      return { outcome: "committed", value, retries: attempt };
    } catch (error) {
      if (committing && isAmbiguousCommitFailure(error)) {
        return { outcome: "ambiguous", retries: attempt };
      }

      try {
        await client.query("ROLLBACK");
      } catch {
        // A rollback that fails on a broken connection changes nothing: the
        // server aborts the transaction when the session ends.
      }

      if (!isSerializationConflict(error) || attempt >= RETRY_LIMIT) {
        throw toDatabaseError(error);
      }

      const delay = jitteredDelay(attempt, random);
      if (now() + delay >= options.deadlineAt) {
        throw new DatabaseError("deadline_exceeded");
      }
      await sleep(delay);
    } finally {
      client.release();
    }
  }
}

/**
 * Resolves an ambiguous commit by reading the durable record the operation
 * would have written.
 *
 * This exists so the ambiguous branch cannot be discharged by a blind retry.
 * The caller supplies a read that answers "did my work land?" against its own
 * idempotency key, and gets back a decision instead of a guess.
 */
export async function resolveAmbiguousCommit<T>(
  read: () => Promise<T | undefined>,
): Promise<
  | { readonly outcome: "applied"; readonly value: T }
  | { readonly outcome: "not_applied" }
> {
  const found = await read();
  return found === undefined
    ? { outcome: "not_applied" }
    : { outcome: "applied", value: found };
}
