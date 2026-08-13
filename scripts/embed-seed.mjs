#!/usr/bin/env node

/**
 * Runs the resumable episode-embedding backfill against real Bedrock
 * (`P4-07`; `D4-Q`'s "retried by (a) the operator backfill command").
 *
 * Like `model-prewarm.mjs`, this has no HTTP route to go through — it calls
 * `runEmbedSeedCommand` directly against the real database and a real Titan
 * client. Unlike prewarm, it writes real rows (`episodes`, `agent_runs`,
 * `model_cost_reservations`) and needs `pnpm db:up` running first.
 *
 * Usage:
 *   node scripts/embed-seed.mjs <contentVersion> [townId]
 *
 * `contentVersion` is required and is never defaulted — an accidental bare
 * invocation must not silently scan every town in the database. `townId` is
 * optional; omitted, every town at that content version is backfilled.
 *
 * Safe to kill and rerun at any point: see `embed-seed.ts`'s own header for
 * why resumability needs nothing from this script beyond calling the command
 * again.
 */

import process from "node:process";

import { applyLocalDefaults } from "./local-env.mjs";

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CALL_DEADLINE_MS = 8_000;
const DEFAULT_RESERVATION_DEADLINE_MS = 20_000;

async function main() {
  applyLocalDefaults();

  const contentVersion = process.argv[2];
  if (!contentVersion) {
    throw new Error(
      "Usage: node scripts/embed-seed.mjs <contentVersion> [townId]\n" +
        "contentVersion is required — this never scans every town by default.",
    );
  }
  const townId = process.argv[3];

  const [
    { loadModelConfig },
    { createTitanEmbedClient },
    { runEmbedSeedCommand, createRuntimePool },
  ] = await Promise.all([
    import("@the-town-remembers/runtime-config/model"),
    import("@the-town-remembers/model-runtime"),
    import("@the-town-remembers/game-server"),
  ]);

  const config = loadModelConfig(process.env);
  const client = createTitanEmbedClient(config.region);
  const pool = createRuntimePool();

  try {
    const result = await runEmbedSeedCommand({
      pool,
      client,
      modelId: config.titanModelId,
      contentVersion,
      ...(townId ? { townId } : {}),
      batchSize: DEFAULT_BATCH_SIZE,
      concurrency: DEFAULT_CONCURRENCY,
      now: () => new Date(),
      callDeadlineMs: DEFAULT_CALL_DEADLINE_MS,
      reservationDeadlineMs: DEFAULT_RESERVATION_DEADLINE_MS,
    });

    console.log(`towns processed: ${result.townsProcessed}`);
    console.log(`embedded ready:  ${result.readyCount}`);
    console.log(`left failed:     ${result.failedCount}`);
    if (result.failedCount > 0) {
      console.log(
        "\nFailed episodes stay `failed` and are retried by the next run of this script.",
      );
    }
  } finally {
    await pool.end();
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
