/**
 * CDK application entry point.
 *
 * Synthesis is programmatic rather than driven by the `aws-cdk` CLI: Phase 0
 * promises only that the app synthesizes deterministically, and the deployment
 * CLI is a Phase 7 concern. Nothing here reads the clock or a random source,
 * so two runs over the same source produce the same template.
 */

import { App, type Environment } from "aws-cdk-lib";
import type { DeploymentConfig } from "@the-town-remembers/runtime-config/deployment";

import { FoundationStack } from "./foundation-stack.js";

export const STACK_NAME_PREFIX = "TheTownRemembers" as const;

export function stackName(deployment: DeploymentConfig): string {
  const suffix =
    deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1);
  return `${STACK_NAME_PREFIX}Foundation${suffix}`;
}

export interface FoundationApp {
  readonly app: App;
  readonly stack: FoundationStack;
}

export interface CreateAppOptions {
  /** Where the cloud assembly is written. Tests leave it to a temporary path. */
  readonly outdir?: string;
}

export function createApp(
  deployment: DeploymentConfig,
  options: CreateAppOptions = {},
): FoundationApp {
  const app = new App(options.outdir === undefined ? {} : { outdir: options.outdir });
  const env: Environment = {
    region: deployment.awsRegion,
    ...(deployment.awsAccount === undefined ? {} : { account: deployment.awsAccount }),
  };

  const stack = new FoundationStack(app, stackName(deployment), {
    stackName: stackName(deployment),
    env,
    deployment,
    description:
      "Phase 0 foundation shell: Lambda bundling contracts only. Phase 7 owns the production topology.",
  });

  return { app, stack };
}
