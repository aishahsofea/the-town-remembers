/**
 * PHASE 0 SHELL — Phase 7 owns the production topology.
 *
 * This stack proves two things and nothing else: that the three Lambda
 * artifacts bundle from their built output, and that synthesis is
 * deterministic and free of plaintext secrets and wildcard grants.
 *
 * It deliberately creates no bucket, distribution, gateway, queue, schedule,
 * secret, alarm, or budget. A placeholder that looked like production
 * infrastructure would be harder to review than its absence.
 */

import { fileURLToPath } from "node:url";

import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";
import {
  AMBIENT_WORKER_TIMING,
  PLAYER_API_TIMING,
  RECOVERY,
  type DeploymentConfig,
} from "@the-town-remembers/runtime-config/deployment";

/** Resources this shell intentionally does not create, and their owner. */
export const DEFERRED_TO_PHASE_7 = [
  "s3-web-bucket",
  "cloudfront-distribution",
  "api-gateway-http-api",
  "sqs-fifo-queue-and-dlq",
  "eventbridge-recovery-schedule",
  "eventbridge-warmup-schedule",
  "secrets-manager-entries",
  "cloudwatch-alarms-and-dashboards",
  "budget-guardrails",
] as const;

export interface FoundationStackProps extends StackProps {
  readonly deployment: DeploymentConfig;
}

interface LambdaDefinition {
  readonly id: string;
  readonly artifactDirectory: string;
  readonly entryModule: string;
  readonly timeoutMs: number;
  readonly memorySizeMib: number;
}

const LAMBDA_DEFINITIONS: readonly LambdaDefinition[] = [
  {
    id: "GameApi",
    artifactDirectory: "apps/game-api/dist",
    entryModule: "handler.handler",
    timeoutMs: PLAYER_API_TIMING.lambdaHardTimeoutMs,
    memorySizeMib: 512,
  },
  {
    id: "AmbientWorker",
    artifactDirectory: "apps/ambient-worker/dist",
    entryModule: "handler.handler",
    timeoutMs: AMBIENT_WORKER_TIMING.lambdaHardTimeoutMs,
    memorySizeMib: 512,
  },
  {
    id: "RecoveryWorker",
    artifactDirectory: "apps/recovery-worker/dist",
    entryModule: "handler.handler",
    timeoutMs: RECOVERY.lambdaHardTimeoutMs,
    memorySizeMib: 256,
  },
];

function repositoryPath(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    for (const definition of LAMBDA_DEFINITIONS) {
      new LambdaFunction(this, definition.id, {
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        handler: definition.entryModule,
        code: Code.fromAsset(repositoryPath(definition.artifactDirectory)),
        timeout: Duration.millis(definition.timeoutMs),
        memorySize: definition.memorySizeMib,
        // Only non-secret identity. Every credential is resolved at runtime
        // through Secrets Manager in Phase 7, never through synthesis.
        environment: {
          TTR_ENV: props.deployment.environment,
          TTR_BUILD_ID: props.deployment.buildId,
        },
      });
    }
  }
}
