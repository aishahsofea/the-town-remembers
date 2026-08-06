#!/usr/bin/env node

/**
 * Programmatic CDK synthesis.
 *
 * Phase 0 promises a deterministic synth, not a deployment. Driving the app
 * directly keeps the `aws-cdk` CLI out of the dependency tree until Phase 7
 * actually needs to deploy something.
 */

import process from "node:process";

const { loadDeploymentConfig } =
  await import("../packages/runtime-config/dist/deployment.js");
const { createApp } = await import("../infrastructure/dist/app.js");

const { app } = createApp(loadDeploymentConfig(process.env), {
  outdir: "cdk.out",
});
const assembly = app.synth();
process.stdout.write(
  `${JSON.stringify({ event: "cdk_synth", stacks: assembly.stacks.map((stack) => stack.stackName) })}\n`,
);
