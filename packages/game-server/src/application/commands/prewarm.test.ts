import type { BedrockConverseClient } from "@the-town-remembers/model-runtime";
import { describe, expect, it } from "vitest";

import { runPrewarmCommand } from "./prewarm.js";

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

type FixtureBody =
  typeof VALID_CLAIM_NORMALIZATION_OUTPUT | typeof VALID_NPC_DIALOGUE_OUTPUT;

/**
 * Deliberately untyped against `@aws-sdk/client-bedrock-runtime`: `game-server`
 * does not depend on the AWS SDK (`D4-A` — only `model-runtime` may), so this
 * relies entirely on `BedrockConverseClient`'s own contextual typing for
 * `send`'s parameter and return shape, never importing `ConverseCommand`/
 * `ConverseCommandOutput` by name.
 */
function spyClient(responses: readonly (FixtureBody | "content_stop")[]): {
  readonly client: BedrockConverseClient;
  readonly callCount: () => number;
} {
  let index = 0;
  const client: BedrockConverseClient = {
    send() {
      const response = responses[index] ?? responses[responses.length - 1]!;
      index += 1;
      if (response === "content_stop") {
        return Promise.resolve({
          $metadata: {},
          output: { message: { role: "assistant", content: [{ text: "" }] } },
          stopReason: "max_tokens",
          usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
          metrics: { latencyMs: 200 },
        });
      }
      return Promise.resolve({
        $metadata: {},
        output: {
          message: {
            role: "assistant",
            content: [{ text: JSON.stringify(response) }],
          },
        },
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        metrics: { latencyMs: 400 },
      });
    },
  };
  return { client, callCount: () => index };
}

const CONFIG = {
  haikuModelId: "haiku-model-id",
  sonnetModelId: "sonnet-model-id",
  haikuInferenceProfileArn: undefined,
  sonnetInferenceProfileArn: undefined,
};

describe("runPrewarmCommand", () => {
  it("runs the three runnable warmup pairs and reports allSucceeded when every pair accepts", async () => {
    const { client, callCount } = spyClient([
      VALID_CLAIM_NORMALIZATION_OUTPUT,
      VALID_NPC_DIALOGUE_OUTPUT,
      VALID_NPC_DIALOGUE_OUTPUT,
    ]);

    const result = await runPrewarmCommand({
      client,
      config: CONFIG,
      now: () => new Date("2026-08-13T12:00:00.000Z"),
    });

    expect(callCount()).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(result.allSucceeded).toBe(true);
    expect(result.results.every((pairResult) => pairResult.outcome === "success")).toBe(
      true,
    );
  });

  it("reports allSucceeded false when any pair fails", async () => {
    const { client } = spyClient([
      "content_stop",
      VALID_NPC_DIALOGUE_OUTPUT,
      VALID_NPC_DIALOGUE_OUTPUT,
    ]);

    const result = await runPrewarmCommand({
      client,
      config: CONFIG,
      now: () => new Date("2026-08-13T12:00:00.000Z"),
    });

    expect(result.allSucceeded).toBe(false);
    expect(result.results[0]!.outcome).toBe("failure");
  });
});
