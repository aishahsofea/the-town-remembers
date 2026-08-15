#!/usr/bin/env node

/**
 * Runs the structured-output warmup against real Bedrock and prints a
 * summary (`P4-06`; docs/010 "Warmup and cold-start mitigation").
 *
 * Unlike `town-new.mjs`, this does not go through a running API — prewarm
 * has no HTTP route (docs/010: "a non-player Game Lambda warmup path"), so
 * this script builds the real Bedrock client and calls
 * `runPrewarmCommand` directly. It writes no database row of any kind, so
 * it needs no database connection and no `pnpm db:up`.
 *
 * Needs real AWS credentials (the default provider chain) and a `.env` with
 * the `TTR_BEDROCK_*`/`TTR_AWS_REGION` variables set — this makes a real,
 * billed Bedrock call for each runnable warmup pair.
 */

import process from "node:process";

import { applyLocalDefaults } from "./local-env.mjs";

async function main() {
  applyLocalDefaults();

  const [{ loadModelConfig }, { createBedrockConverseClient }, { runPrewarmCommand }] =
    await Promise.all([
      import("@the-town-remembers/runtime-config/model"),
      import("@the-town-remembers/model-runtime"),
      import("@the-town-remembers/game-server"),
    ]);

  const config = loadModelConfig(process.env);
  const client = createBedrockConverseClient(config.region);

  const { results, allSucceeded } = await runPrewarmCommand({ client, config });

  for (const result of results) {
    const cost = (result.estimatedCostMicroUsd / 1_000_000).toFixed(6);
    console.log(
      `${result.outcome === "success" ? "ok  " : "FAIL"}  ${result.modelRole.padEnd(6)}  ${result.schema.padEnd(24)}  ${String(result.latencyMs).padStart(6)}ms  $${cost}`,
    );
  }

  if (!allSucceeded) {
    console.error("\nAt least one warmup pair failed.");
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
