/**
 * The operator connection.
 *
 * This is the only module in the repository permitted to read
 * `runtime-config/operator`, and the workspace boundary check enforces it. A
 * migration administrator can create, alter, and drop; nothing on a request
 * path may construct one, so the credential has no route into a Lambda even by
 * accident.
 *
 * The pool is deliberately tiny and short-lived: an operator command opens it,
 * runs one migration, and closes it.
 */

import { loadOperatorConfig } from "@the-town-remembers/runtime-config/operator";
import { Pool } from "pg";

const OPERATOR_POOL_SIZE = 1;
const CONNECTION_TIMEOUT_MS = 10_000;

export interface OperatorPoolOptions {
  /** Overrides the configured credential. Used only by the disposable harness. */
  readonly connectionString?: string;
  readonly applicationName?: string;
}

export function createOperatorPool(
  source: Readonly<Record<string, string | undefined>> = process.env,
  options: OperatorPoolOptions = {},
): Pool {
  const connectionString =
    options.connectionString ?? loadOperatorConfig(source).migrationDatabaseUrl;

  return new Pool({
    connectionString,
    max: OPERATOR_POOL_SIZE,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    application_name: options.applicationName ?? "ttr-migrate",
  });
}
