/**
 * Real Bedrock smoke test for structured-output warmup (`P4-06`; docs/010
 * "Warmup and cold-start mitigation").
 *
 * Opt-in only (`D4-U`) — see `live-test-gate.ts`. Runs under `pnpm
 * test:model:live`, never under plain `pnpm test`: the `model-live` vitest
 * project only exists in `vitest.config.ts` when `TTR_MODEL_LIVE_TESTS=1` is
 * already set, and this file's own name (`*.live.test.ts`) is excluded from
 * every other project's `include` glob.
 */

import process from "node:process";

import { loadModelConfig } from "@the-town-remembers/runtime-config/model";
import { describe, expect, it } from "vitest";

import { createBedrockConverseClient } from "./bedrock/index.js";
import { evaluateLiveModelTestGate } from "./live-test-gate.js";
import { RUNNABLE_WARMUP_PAIRS, runWarmup } from "./warmup.js";

const gate = evaluateLiveModelTestGate();
if (!gate.shouldRun) {
  console.warn(`Skipping live Bedrock warmup smoke test: ${gate.skipReason}`);
}

describe.skipIf(!gate.shouldRun)("warmup: live Bedrock smoke", () => {
  it("succeeds against real Bedrock for every runnable warmup pair", async () => {
    const config = loadModelConfig(process.env);
    const client = createBedrockConverseClient(config.region);

    const results = await runWarmup({
      client,
      config,
      now: () => new Date(),
      abortSignal: AbortSignal.timeout(20_000),
      deadlineMs: 20_000,
    });

    expect(results).toHaveLength(RUNNABLE_WARMUP_PAIRS.length);
    for (const result of results) {
      expect(result.outcome).toBe("success");
      expect(result.latencyMs).toBeGreaterThan(0);
    }
  }, 30_000);
});
