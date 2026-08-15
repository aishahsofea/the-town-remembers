import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { appendRun, type AppendRunParams } from "./model-runs.js";

/**
 * Never actually connected to: every case below either throws during
 * validation (before `runSerializable` calls `pool.connect()`) or, for the
 * "passes validation" cases, is expected to reach and throw from `connect`
 * itself — proving it got that far without asserting against a real database.
 */
const UNUSED_POOL = {
  connect: () => {
    throw new Error("model-runs validation must throw before the pool is used");
  },
} as unknown as Pool;
const REACHED_DATABASE = /model-runs validation must throw before the pool is used/;

const VALID_USAGE = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const PLAYER_ACTION_ID = "33333333-3333-3333-3333-333333333333";

/** No causal-source field at all — `exactOptionalPropertyTypes` treats an explicit `undefined` differently from an omitted key, so each test adds exactly the source field(s) it means to test. */
const BASE_NO_SOURCE = {
  runId: "11111111-1111-1111-1111-111111111111",
  townId: "22222222-2222-2222-2222-222222222222",
  model: "haiku",
  inferenceProfile: "arn:aws:bedrock:us-east-1:111:inference-profile/haiku",
  promptVersion: "v1",
  usage: VALID_USAGE,
  latencyMs: 250,
  estimatedCostMicroUsd: 100,
  outcome: "accepted",
  now: new Date("2026-08-13T00:00:00.000Z"),
} as const satisfies Omit<
  AppendRunParams,
  "purpose" | "playerActionId" | "ambientJobExecutionId" | "worldEventId"
>;

const VALID_SHA256 = new Uint8Array(32).fill(7);

describe("appendRun validation", () => {
  it("rejects a run with no causal source at all", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        purpose: "episode_embedding",
      }),
    ).rejects.toThrow(/names no causal source/);
  });

  it("accepts a run naming only playerActionId, only ambientJobExecutionId, or only worldEventId", async () => {
    // Each case reaches (and throws from) `UNUSED_POOL`, proving validation
    // itself passed and execution moved on to the database call.
    for (const source of [
      { playerActionId: PLAYER_ACTION_ID },
      { ambientJobExecutionId: PLAYER_ACTION_ID },
      { worldEventId: PLAYER_ACTION_ID },
    ]) {
      await expect(
        appendRun(UNUSED_POOL, Date.now() + 1000, {
          ...BASE_NO_SOURCE,
          ...source,
          purpose: "episode_embedding",
        }),
      ).rejects.toThrow(REACHED_DATABASE);
    }
  });

  it("accepts a run naming more than one causal source (the check requires only 'at least one')", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        playerActionId: PLAYER_ACTION_ID,
        worldEventId: PLAYER_ACTION_ID,
        purpose: "episode_embedding",
      }),
    ).rejects.toThrow(REACHED_DATABASE);
  });

  it("rejects an empty inferenceProfile (D4-N)", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        playerActionId: PLAYER_ACTION_ID,
        inferenceProfile: "",
        purpose: "episode_embedding",
      }),
    ).rejects.toThrow(/empty inferenceProfile/);
  });

  it("rejects a promptSha256 that is not 32 bytes", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        playerActionId: PLAYER_ACTION_ID,
        purpose: "claim_normalization",
        promptSha256: new Uint8Array(16),
        taskInputVersion: "v1",
        outputSchemaVersion: "v1",
        validationPolicyVersion: "v1",
      }),
    ).rejects.toThrow(/not 32/);
  });

  it("accepts a valid 32-byte promptSha256 for a structured purpose and proceeds to the database", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        playerActionId: PLAYER_ACTION_ID,
        purpose: "claim_normalization",
        promptSha256: VALID_SHA256,
        taskInputVersion: "v1",
        outputSchemaVersion: "v1",
        validationPolicyVersion: "v1",
      }),
    ).rejects.toThrow(REACHED_DATABASE);
  });

  it("accepts a well-formed embedding run and proceeds to the database", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        playerActionId: PLAYER_ACTION_ID,
        purpose: "query_embedding",
      }),
    ).rejects.toThrow(REACHED_DATABASE);
  });

  it("accepts a well-formed structured_repair run with targetPromptVersion and proceeds to the database", async () => {
    await expect(
      appendRun(UNUSED_POOL, Date.now() + 1000, {
        ...BASE_NO_SOURCE,
        playerActionId: PLAYER_ACTION_ID,
        purpose: "structured_repair",
        targetPromptVersion: "v1",
        promptSha256: VALID_SHA256,
        taskInputVersion: "v1",
        outputSchemaVersion: "v1",
        validationPolicyVersion: "v1",
      }),
    ).rejects.toThrow(REACHED_DATABASE);
  });
});
