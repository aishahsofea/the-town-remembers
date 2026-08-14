import { ClaimNormalizationV1Schema } from "@the-town-remembers/model-contracts";
import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";

import type { BedrockConverseClient, ConverseParams } from "./converse.js";
import { converseWithRetry, type RetryFitCheck } from "./retry.js";

const VALID_OUTPUT = {
  status: "unsupported" as const,
  subject_entity_id: null,
  predicate: null,
  object_entity_id: null,
  polarity: null,
  context_key: null,
  alleged_source_actor_id: null,
  reason_code: "no_proposition" as const,
};

function successResponse(): ConverseCommandOutput {
  return {
    $metadata: {},
    output: {
      message: { role: "assistant", content: [{ text: JSON.stringify(VALID_OUTPUT) }] },
    },
    stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 },
    metrics: { latencyMs: 300 },
  };
}

function throttled(): Error {
  const error = new Error("rate limited");
  error.name = "ThrottlingException";
  return error;
}

function terminalError(): Error {
  const error = new Error("bad request");
  error.name = "ValidationException";
  return error;
}

function fixtureClient(responses: readonly (ConverseCommandOutput | Error)[]): {
  client: BedrockConverseClient;
  callCount: () => number;
} {
  let index = 0;
  const client: BedrockConverseClient = {
    send() {
      const response = responses[index];
      index += 1;
      if (response === undefined) return Promise.reject(new Error("fixture exhausted"));
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    },
  };
  return { client, callCount: () => index };
}

function baseParams(): ConverseParams<(typeof ClaimNormalizationV1Schema)["_output"]> {
  return {
    modelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
    systemPrompt: "<role>You normalize claims.</role>",
    userMessageJson: "{}",
    outputSchemaName: "claim_normalization_v1",
    outputSchemaDescription: "Normalize one utterance into one bounded claim result",
    jsonSchema: { type: "object" },
    outputSchema: ClaimNormalizationV1Schema,
    temperature: 0,
    maxTokens: 256,
    abortSignal: new AbortController().signal,
    worstCaseMs: 6000,
  };
}

const FIT_CHECK: RetryFitCheck = {
  now: new Date("2026-08-13T12:00:00.000Z"),
  applicationDeadlineAt: new Date("2026-08-13T12:00:24.000Z"),
  worstCaseMs: 6000,
  reserveMs: 4000,
  retryNow: () => new Date("2026-08-13T12:00:07.000Z"),
};

describe("converseWithRetry", () => {
  it("returns the first attempt's outcome unchanged on success", async () => {
    const { client, callCount } = fixtureClient([successResponse()]);
    const outcome = await converseWithRetry(client, baseParams(), FIT_CHECK);
    expect(outcome.kind).toBe("accepted");
    expect(callCount()).toBe(1);
  });

  it("retries exactly once after a retryable transport failure, then succeeds", async () => {
    const { client, callCount } = fixtureClient([throttled(), successResponse()]);
    const outcome = await converseWithRetry(client, baseParams(), FIT_CHECK);
    expect(outcome.kind).toBe("accepted");
    expect(callCount()).toBe(2);
  });

  it("does not retry a terminal (non-retryable) transport failure", async () => {
    const { client, callCount } = fixtureClient([terminalError(), successResponse()]);
    const outcome = await converseWithRetry(client, baseParams(), FIT_CHECK);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: false,
      errorName: "ValidationException",
    });
    expect(callCount()).toBe(1);
  });

  it("throttling twice in a row is terminal after the one allowed retry", async () => {
    const { client, callCount } = fixtureClient([
      throttled(),
      throttled(),
      successResponse(),
    ]);
    const outcome = await converseWithRetry(client, baseParams(), FIT_CHECK);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: true,
      errorName: "ThrottlingException",
    });
    expect(callCount()).toBe(2);
  });

  it("skips the retry as a timeout when the retried call would no longer fit before the reserve", async () => {
    const { client, callCount } = fixtureClient([throttled(), successResponse()]);
    const noRoomForRetry: RetryFitCheck = {
      ...FIT_CHECK,
      retryNow: () => new Date("2026-08-13T12:00:21.000Z"),
    };
    const outcome = await converseWithRetry(client, baseParams(), noRoomForRetry);
    expect(outcome).toStrictEqual({ kind: "timeout", attempted: false });
    expect(callCount()).toBe(1);
  });
});
