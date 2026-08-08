/**
 * The bounded runtime pool.
 *
 * Every limit here comes from Decision 007 and exists because the runtime is a
 * Lambda talking to a shared cluster over the public internet. Two connections
 * per warm environment, a three-second connect timeout, a statement timeout no
 * longer than the remaining request budget, and a transaction that cannot idle.
 * A pool that grew under load would turn one slow query into cluster-wide
 * connection exhaustion.
 *
 * Transport security fails closed in `runtime-config/database`: outside a local
 * environment the DSN must request `sslmode=verify-full`, so a misconfigured
 * deployment cannot silently downgrade to an unverified connection.
 */

import {
  DATABASE,
  loadDatabaseConfig,
} from "@the-town-remembers/runtime-config/database";
import { Pool, types } from "pg";

import { toDatabaseError } from "./errors.js";

const INT8_OID = 20;

/**
 * `pg` returns INT8 as a string to avoid silent precision loss. Every INT8 in
 * this schema is a revision, sequence, counter, or token balance, all far below
 * 2^53, so parsing to `number` is exact and keeps arithmetic ordinary.
 */
types.setTypeParser(INT8_OID, (value) => Number(value));

export interface RuntimePoolOptions {
  /** Overrides the configured credential. Used only by the test harness. */
  readonly connectionString?: string;
  /** Remaining operation budget; the statement timeout never exceeds it. */
  readonly remainingBudgetMs?: number;
  readonly applicationName?: string;
}

export function statementTimeoutMs(remainingBudgetMs?: number): number {
  const ceiling = DATABASE.maximumStatementTimeoutMs;
  if (remainingBudgetMs === undefined) return ceiling;
  return Math.max(1, Math.min(ceiling, remainingBudgetMs));
}

export function createRuntimePool(
  source: Readonly<Record<string, string | undefined>> = process.env,
  options: RuntimePoolOptions = {},
): Pool {
  const connectionString =
    options.connectionString ?? loadDatabaseConfig(source).databaseUrl;

  const pool = new Pool({
    connectionString,
    max: DATABASE.poolSizePerWarmEnvironment,
    connectionTimeoutMillis: DATABASE.connectionTimeoutMs,
    statement_timeout: statementTimeoutMs(options.remainingBudgetMs),
    // A transaction that stops making progress must not hold its connection
    // past the accepted deadline; the pool is only two wide.
    idle_in_transaction_session_timeout: DATABASE.maximumTransactionDeadlineMs,
    application_name: options.applicationName ?? "ttr-runtime",
  });

  // A pool-level error must not become an unhandled rejection that kills the
  // process, and must not carry the connection string into a log.
  pool.on("error", (error) => {
    void toDatabaseError(error);
  });

  return pool;
}
