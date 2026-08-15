import type {
  ConverseCommand,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { OUTPUT_SCHEMA_NAMES, WARMUP_PAIRS } from "@the-town-remembers/model-contracts";
import { describe, expect, it } from "vitest";

import type { BedrockConverseClient, ModelResolutionConfig } from "./bedrock/index.js";
import { DEFERRED_WARMUP_PAIRS, runWarmup, RUNNABLE_WARMUP_PAIRS } from "./warmup.js";

const VALID_CLAIM_NORMALIZATION_OUTPUT = {
  status: "unsupported" as const,
  subject_entity_id: null,
  predicate: null,
  object_entity_id: null,
  polarity: null,
  context_key: null,
  alleged_source_actor_id: null,
  reason_code: "no_proposition" as const,
};

const VALID_NPC_DIALOGUE_OUTPUT = {
  response_kind: "answer" as const,
  rendering_ids: [],
};

function successResponse(body: unknown): ConverseCommandOutput {
  return {
    $metadata: {},
    output: {
      message: { role: "assistant", content: [{ text: JSON.stringify(body) }] },
    },
    stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    metrics: { latencyMs: 400 },
  };
}

const CONTENT_STOP_RESPONSE: ConverseCommandOutput = {
  $metadata: {},
  output: { message: { role: "assistant", content: [{ text: "" }] } },
  stopReason: "max_tokens",
  usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
  metrics: { latencyMs: 200 },
};

interface FixtureClient {
  readonly client: BedrockConverseClient;
  readonly calls: readonly { readonly modelId: string | undefined }[];
}

function fixtureClient(
  responses: readonly (ConverseCommandOutput | Error)[],
): FixtureClient {
  const calls: { modelId: string | undefined }[] = [];
  let index = 0;
  const client: BedrockConverseClient = {
    send(command: ConverseCommand) {
      calls.push({ modelId: command.input.modelId });
      const response = responses[index] ?? responses[responses.length - 1]!;
      index += 1;
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response);
    },
  };
  return { client, calls };
}

const CONFIG: ModelResolutionConfig = {
  haikuModelId: "haiku-model-id",
  sonnetModelId: "sonnet-model-id",
  haikuInferenceProfileArn: undefined,
  sonnetInferenceProfileArn: undefined,
};

function baseWarmupParams(client: BedrockConverseClient) {
  return {
    client,
    config: CONFIG,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    abortSignal: new AbortController().signal,
    deadlineMs: 30_000,
  };
}

describe("RUNNABLE_WARMUP_PAIRS / DEFERRED_WARMUP_PAIRS", () => {
  it("splits WARMUP_PAIRS into three runnable and one deferred (ambient_choice)", () => {
    expect(RUNNABLE_WARMUP_PAIRS).toHaveLength(3);
    expect(DEFERRED_WARMUP_PAIRS).toHaveLength(1);
    expect(DEFERRED_WARMUP_PAIRS[0]!.schema).toBe(OUTPUT_SCHEMA_NAMES.ambientChoice);
    // TypeScript's own `.filter()` narrowing already proves this statically
    // (that's why the two sides of `!==` need a widening cast to compare at
    // all) — kept anyway as a real runtime guard against a future regression
    // in `RUNNABLE_WARMUP_PAIRS`'s own filter predicate.
    const runnableSchemas: readonly string[] = RUNNABLE_WARMUP_PAIRS.map(
      (pair) => pair.schema,
    );
    expect(runnableSchemas).not.toContain(OUTPUT_SCHEMA_NAMES.ambientChoice);
    expect(RUNNABLE_WARMUP_PAIRS.length + DEFERRED_WARMUP_PAIRS.length).toBe(
      WARMUP_PAIRS.length,
    );
  });
});

describe("runWarmup", () => {
  it("runs all three runnable pairs, resolving each pair's own model role", async () => {
    const { client, calls } = fixtureClient([
      successResponse(VALID_CLAIM_NORMALIZATION_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
    ]);

    const results = await runWarmup(baseWarmupParams(client));

    expect(results).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(results.map((result) => result.modelRole)).toStrictEqual([
      "haiku",
      "haiku",
      "sonnet",
    ]);
    expect(calls.map((call) => call.modelId)).toStrictEqual([
      "haiku-model-id",
      "haiku-model-id",
      "sonnet-model-id",
    ]);
  });

  it("reports success with a positive cost for an accepted response", async () => {
    const { client } = fixtureClient([
      successResponse(VALID_CLAIM_NORMALIZATION_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
    ]);

    const results = await runWarmup(baseWarmupParams(client));

    for (const result of results) {
      expect(result.outcome).toBe("success");
      expect(result.estimatedCostMicroUsd).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports failure with zero cost when a pair does not return usable output", async () => {
    const { client } = fixtureClient([
      CONTENT_STOP_RESPONSE,
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
    ]);

    const results = await runWarmup(baseWarmupParams(client));

    expect(results[0]).toMatchObject({ outcome: "failure", estimatedCostMicroUsd: 0 });
    expect(results[1]).toMatchObject({ outcome: "success" });
    expect(results[2]).toMatchObject({ outcome: "success" });
  });

  it("never contacts the ambient_choice pair — it has no runnable prompt or input yet", async () => {
    const { client, calls } = fixtureClient([
      successResponse(VALID_CLAIM_NORMALIZATION_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
      successResponse(VALID_NPC_DIALOGUE_OUTPUT),
    ]);

    await runWarmup(baseWarmupParams(client));

    expect(calls).toHaveLength(RUNNABLE_WARMUP_PAIRS.length);
  });
});
