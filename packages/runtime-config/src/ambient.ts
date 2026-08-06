/**
 * Ambient Tick worker runtime configuration.
 *
 * The worker shell performs no external effect in Phase 0, so it needs no
 * queue URL, database URL, or model credential. Phase 5 adds them.
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
export {
  AMBIENT_QUEUE,
  AMBIENT_TRANSITION,
  AMBIENT_WORKER_TIMING,
  DATABASE,
  MODEL_RETRIES,
} from "./reliability.js";

const AmbientConfigSchema = z.strictObject({
  TTR_ENV: DeploymentEnvironmentSchema,
  TTR_BUILD_ID: BuildIdSchema,
  TTR_LOG_LEVEL: LogLevelSchema,
});

export interface AmbientConfig {
  readonly environment: DeploymentEnvironment;
  readonly buildId: string;
  readonly logLevel: z.infer<typeof LogLevelSchema>;
}

export function loadAmbientConfig(source: EnvironmentRecord): AmbientConfig {
  const parsed = parseEnvironment(
    "ambient-runtime",
    AmbientConfigSchema,
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
