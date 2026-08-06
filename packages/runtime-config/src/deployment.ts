/**
 * CDK deployment configuration.
 *
 * This category names cloud placement only. A secret value never travels
 * through it: Phase 7 resolves credentials through Secrets Manager at runtime
 * rather than through a synthesis-time variable.
 */

import { z } from "zod";

import {
  BuildIdSchema,
  DeploymentEnvironmentSchema,
  parseEnvironment,
  required,
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
  AMBIENT_WORKER_TIMING,
  PLAYER_API_TIMING,
  RECOVERY,
} from "./reliability.js";

const DeploymentConfigSchema = z.strictObject({
  TTR_ENV: DeploymentEnvironmentSchema,
  TTR_BUILD_ID: BuildIdSchema,
  TTR_AWS_REGION: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
  TTR_AWS_ACCOUNT: z.union([z.string().regex(/^\d{12}$/), z.undefined()]),
});

export interface DeploymentConfig {
  readonly environment: DeploymentEnvironment;
  readonly buildId: string;
  readonly awsRegion: string;
  readonly awsAccount: string | undefined;
}

export function loadDeploymentConfig(source: EnvironmentRecord): DeploymentConfig {
  const parsed = parseEnvironment(
    "deployment",
    DeploymentConfigSchema,
    {
      TTR_ENV: required(source, "TTR_ENV"),
      TTR_BUILD_ID: withLocalDefault(source, "TTR_BUILD_ID", "unknown"),
      TTR_AWS_REGION: withLocalDefault(source, "TTR_AWS_REGION", "us-east-1"),
      TTR_AWS_ACCOUNT: required(source, "TTR_AWS_ACCOUNT"),
    },
    source,
  );

  return {
    environment: parsed.TTR_ENV,
    buildId: parsed.TTR_BUILD_ID,
    awsRegion: parsed.TTR_AWS_REGION,
    awsAccount: parsed.TTR_AWS_ACCOUNT,
  };
}
