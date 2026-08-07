/**
 * Runtime database configuration for the `app_runtime` credential.
 *
 * Three database identities exist and they never share a category. The
 * migration administrator lives in `./operator`, the disposable test target
 * lives in `./test`, and this module holds the least-privileged credential the
 * request path uses. Keeping them apart is what lets the workspace boundary
 * check prove a Lambda cannot reach a DDL credential.
 *
 * Transport security fails closed. Decision 002 requires `sslmode=verify-full`
 * against the public CockroachDB endpoint, so any environment other than
 * `local` rejects a URL that does not request it. A developer running the
 * pinned insecure node locally is the only exception.
 */

import { z } from "zod";

import {
  DeploymentEnvironmentSchema,
  parseEnvironment,
  required,
  type DeploymentEnvironment,
  type EnvironmentRecord,
} from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";
export { DATABASE } from "./reliability.js";

export const REQUIRED_SSL_MODE = "verify-full";

/**
 * Reads `sslmode` without constructing a `URL`, because a malformed value must
 * produce a value-free configuration issue rather than a thrown parser error
 * that could carry the credential in its message.
 */
export function readSslMode(databaseUrl: string): string | undefined {
  const query = databaseUrl.slice(databaseUrl.indexOf("?") + 1);
  if (!databaseUrl.includes("?")) return undefined;
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator) === "sslmode") return pair.slice(separator + 1);
  }
  return undefined;
}

const DatabaseUrlSchema = z
  .string()
  .refine((value) => value.startsWith("postgresql://"), "must be a PostgreSQL URL");

const DatabaseConfigSchema = z
  .strictObject({
    TTR_ENV: DeploymentEnvironmentSchema,
    TTR_DATABASE_URL: DatabaseUrlSchema,
  })
  .refine(
    (value) =>
      value.TTR_ENV === "local" ||
      readSslMode(value.TTR_DATABASE_URL) === REQUIRED_SSL_MODE,
    { error: `must request sslmode=${REQUIRED_SSL_MODE}`, path: ["TTR_DATABASE_URL"] },
  );

export interface DatabaseConfig {
  readonly environment: DeploymentEnvironment;
  /** Held only by the pool factory; never logged and never placed in an error. */
  readonly databaseUrl: string;
}

export function loadDatabaseConfig(source: EnvironmentRecord): DatabaseConfig {
  const parsed = parseEnvironment(
    "database-runtime",
    DatabaseConfigSchema,
    {
      TTR_ENV: required(source, "TTR_ENV"),
      TTR_DATABASE_URL: required(source, "TTR_DATABASE_URL"),
    },
    source,
  );

  return {
    environment: parsed.TTR_ENV,
    databaseUrl: parsed.TTR_DATABASE_URL,
  };
}
