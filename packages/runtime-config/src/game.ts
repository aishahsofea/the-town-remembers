/**
 * Game API runtime configuration.
 *
 * Phase 0 needs no secret to run the health shell, so no database, model,
 * queue, or secret-store variable exists here yet. Phase 1 and Phase 4 add
 * theirs; the operator migration credential never appears in this category.
 */

import { z } from "zod";

import {
  BuildIdSchema,
  DeploymentEnvironmentSchema,
  LogLevelSchema,
  OriginSchema,
  PortSchema,
  parseEnvironment,
  withDefault,
  withLocalDefault,
  required,
  type DeploymentEnvironment,
  type EnvironmentRecord,
} from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";
export {
  DATABASE,
  MODEL_RETRIES,
  PLAYER_API_TIMING,
  AMBIENT_TRANSITION,
  OUTBOX_PUBLICATION,
} from "./reliability.js";

/** Shared with the test harness so one variable governs the local port. */
export const DEFAULT_API_PORT = 5174;

const GameConfigSchema = z.strictObject({
  TTR_ENV: DeploymentEnvironmentSchema,
  TTR_BUILD_ID: BuildIdSchema,
  TTR_LOG_LEVEL: LogLevelSchema,
  TTR_APP_ORIGIN: OriginSchema,
  TTR_API_PORT: PortSchema,
});

export interface GameConfig {
  readonly environment: DeploymentEnvironment;
  readonly buildId: string;
  readonly logLevel: z.infer<typeof LogLevelSchema>;
  readonly appOrigin: string;
  /** Port the local `node:http` adapter binds. Unused by the Lambda entry. */
  readonly apiPort: number;
}

export function loadGameConfig(source: EnvironmentRecord): GameConfig {
  const parsed = parseEnvironment(
    "game-runtime",
    GameConfigSchema,
    {
      TTR_ENV: required(source, "TTR_ENV"),
      TTR_BUILD_ID: withLocalDefault(source, "TTR_BUILD_ID", "unknown"),
      TTR_LOG_LEVEL: withDefault(source, "TTR_LOG_LEVEL", "info"),
      TTR_APP_ORIGIN: withLocalDefault(
        source,
        "TTR_APP_ORIGIN",
        "http://localhost:5173",
      ),
      TTR_API_PORT: withDefault(source, "TTR_API_PORT", String(DEFAULT_API_PORT)),
    },
    source,
  );

  return {
    environment: parsed.TTR_ENV,
    buildId: parsed.TTR_BUILD_ID,
    logLevel: parsed.TTR_LOG_LEVEL,
    appOrigin: parsed.TTR_APP_ORIGIN,
    apiPort: parsed.TTR_API_PORT,
  };
}
