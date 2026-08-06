/**
 * Operator-only configuration.
 *
 * The migration administrator credential lives here and nowhere else. No
 * Lambda package may import this module: the workspace boundary check rejects
 * `@the-town-remembers/runtime-config/operator` from every deployment unit, so
 * the credential cannot reach a request path even by accident.
 */

import { z } from "zod";

import { parseEnvironment, required, type EnvironmentRecord } from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";
export { DATABASE } from "./reliability.js";

const OperatorConfigSchema = z.strictObject({
  TTR_MIGRATION_DATABASE_URL: z
    .string()
    .refine((value) => value.startsWith("postgresql://"), "must be a PostgreSQL URL"),
});

export interface OperatorConfig {
  /** Held only for the duration of an operator command; never logged. */
  readonly migrationDatabaseUrl: string;
}

export function loadOperatorConfig(source: EnvironmentRecord): OperatorConfig {
  const parsed = parseEnvironment(
    "operator",
    OperatorConfigSchema,
    { TTR_MIGRATION_DATABASE_URL: required(source, "TTR_MIGRATION_DATABASE_URL") },
    source,
  );

  return { migrationDatabaseUrl: parsed.TTR_MIGRATION_DATABASE_URL };
}
