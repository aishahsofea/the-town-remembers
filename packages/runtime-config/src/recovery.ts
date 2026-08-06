/**
 * Recovery worker runtime configuration.
 *
 * The Phase 0 shell reports no work. Phase 5 adds the outbox and queue access
 * this category will eventually need.
 */

import { z } from "zod";

import {
  BuildIdSchema,
  DeploymentEnvironmentSchema,
  LogLevelSchema,
  parseEnvironment,
  required,
  withDefault,
  withLocalDefault,
  type DeploymentEnvironment,
  type EnvironmentRecord,
} from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";
export { AMBIENT_TRANSITION, DATABASE, RECOVERY } from "./reliability.js";

const RecoveryConfigSchema = z.strictObject({
  TTR_ENV: DeploymentEnvironmentSchema,
  TTR_BUILD_ID: BuildIdSchema,
  TTR_LOG_LEVEL: LogLevelSchema,
});

export interface RecoveryConfig {
  readonly environment: DeploymentEnvironment;
  readonly buildId: string;
  readonly logLevel: z.infer<typeof LogLevelSchema>;
}

export function loadRecoveryConfig(source: EnvironmentRecord): RecoveryConfig {
  const parsed = parseEnvironment(
    "recovery-runtime",
    RecoveryConfigSchema,
    {
      TTR_ENV: required(source, "TTR_ENV"),
      TTR_BUILD_ID: withLocalDefault(source, "TTR_BUILD_ID", "unknown"),
      TTR_LOG_LEVEL: withDefault(source, "TTR_LOG_LEVEL", "info"),
    },
    source,
  );

  return {
    environment: parsed.TTR_ENV,
    buildId: parsed.TTR_BUILD_ID,
    logLevel: parsed.TTR_LOG_LEVEL,
  };
}
