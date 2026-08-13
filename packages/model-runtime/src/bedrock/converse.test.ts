import { ClaimNormalizationV1Schema } from "@the-town-remembers/model-contracts";
import type {
  ConverseCommand,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  converse,
  type BedrockConverseClient,
  type ConverseParams,
} from "./converse.js";

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

function successResponse(
  body: unknown,
  overrides: Partial<ConverseCommandOutput> = {},
): ConverseCommandOutput {
  return {
    $metadata: {},
    output: {
      message: { role: "assistant", content: [{ text: JSON.stringify(body) }] },
    },
    stopReason: "end_turn",
    usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
    metrics: { latencyMs: 400 },
    ...overrides,
  };
}

interface FixtureClient {
  readonly client: BedrockConverseClient;
  readonly calls: readonly {
    readonly command: ConverseCommand;
    readonly abortSignal: AbortSignal | undefined;
  }[];
}

function fixtureClient(
  responses: readonly (ConverseCommandOutput | Error)[],
): FixtureClient {
  const calls: { command: ConverseCommand; abortSignal: AbortSignal | undefined }[] =
    [];
  let index = 0;
  const client: BedrockConverseClient = {
    send(command, options) {
      calls.push({ command, abortSignal: options?.abortSignal });
      const response = responses[index] ?? responses[responses.length - 1];
      index += 1;
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(response as ConverseCommandOutput);
    },
  };
  return { client, calls };
}

function baseParams(
  overrides: Partial<
    ConverseParams<(typeof ClaimNormalizationV1Schema)["_output"]>
  > = {},
): ConverseParams<(typeof ClaimNormalizationV1Schema)["_output"]> {
  return {
    modelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
    systemPrompt: "<role>You normalize claims.</role>",
    userMessageJson: JSON.stringify({
      task_input_version: "claim-normalization-input/1",
    }),
    outputSchemaName: "claim_normalization_v1",
    outputSchemaDescription: "Normalize one utterance into one bounded claim result",
    jsonSchema: { type: "object" },
    outputSchema: ClaimNormalizationV1Schema,
    temperature: 0,
    maxTokens: 256,
    abortSignal: new AbortController().signal,
    worstCaseMs: 6000,
    ...overrides,
  };
}

const FITS: Parameters<typeof converse>[2] = {
  now: new Date("2026-08-13T12:00:00.000Z"),
  applicationDeadlineAt: new Date("2026-08-13T12:00:24.000Z"),
  worstCaseMs: 6000,
  reserveMs: 4000,
};

describe("converse: success", () => {
  it("returns accepted with the validated typed result and usage", async () => {
    const { client } = fixtureClient([successResponse(VALID_OUTPUT)]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.result).toStrictEqual(VALID_OUTPUT);
      expect(outcome.usage).toStrictEqual({ inputTokens: 120, outputTokens: 40 });
    }
  });

  it("passes the exact system prompt, user message, and structured-output config", async () => {
    const { client, calls } = fixtureClient([successResponse(VALID_OUTPUT)]);
    const params = baseParams();
    await converse(client, params, FITS);
    const input = calls[0]?.command.input;
    expect(input?.system).toStrictEqual([{ text: params.systemPrompt }]);
    expect(input?.messages).toStrictEqual([
      { role: "user", content: [{ text: params.userMessageJson }] },
    ]);
    expect(input?.outputConfig?.textFormat?.type).toBe("json_schema");
    expect(input?.outputConfig?.textFormat?.structure?.jsonSchema?.name).toBe(
      "claim_normalization_v1",
    );
    expect(input?.inferenceConfig).toStrictEqual({ temperature: 0, maxTokens: 256 });
  });

  it("passes the caller's own AbortSignal through to the client, not a fresh one", async () => {
    const { client, calls } = fixtureClient([successResponse(VALID_OUTPUT)]);
    const controller = new AbortController();
    await converse(client, baseParams({ abortSignal: controller.signal }), FITS);
    expect(calls[0]?.abortSignal).toBe(controller.signal);
  });
});

describe("converse: transport failures", () => {
  it("classifies a throttling error as retryable transport_failure", async () => {
    const throttled = new Error("rate limited");
    throttled.name = "ThrottlingException";
    const { client } = fixtureClient([throttled]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: true,
      errorName: "ThrottlingException",
    });
  });

  it("classifies a 500 as retryable transport_failure", async () => {
    const serverError = new Error("internal error");
    serverError.name = "InternalServerException";
    (serverError as Error & { $metadata: { httpStatusCode: number } }).$metadata = {
      httpStatusCode: 500,
    };
    const { client } = fixtureClient([serverError]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome.kind).toBe("transport_failure");
    if (outcome.kind === "transport_failure") expect(outcome.retryable).toBe(true);
  });

  it("classifies an access-denied error as terminal transport_failure", async () => {
    const denied = new Error("no access");
    denied.name = "AccessDeniedException";
    const { client } = fixtureClient([denied]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: false,
      errorName: "AccessDeniedException",
    });
  });
});

describe("converse: timeout", () => {
  it("returns timeout with attempted=false and never constructs an AWS call when the worst case does not fit", async () => {
    const { client, calls } = fixtureClient([successResponse(VALID_OUTPUT)]);
    const sendSpy = vi.spyOn(client, "send");
    const tooLate: Parameters<typeof converse>[2] = {
      now: new Date("2026-08-13T12:00:21.000Z"),
      applicationDeadlineAt: new Date("2026-08-13T12:00:24.000Z"),
      worstCaseMs: 1000,
      reserveMs: 4000,
    };
    const outcome = await converse(client, baseParams(), tooLate);
    expect(outcome).toStrictEqual({ kind: "timeout", attempted: false });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("returns timeout with attempted=true when the client call itself aborts", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const { client } = fixtureClient([abortError]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "timeout", attempted: true });
  });
});

describe("converse: content stop", () => {
  it("returns content_stop for stopReason: max_tokens", async () => {
    const { client } = fixtureClient([
      successResponse(VALID_OUTPUT, { stopReason: "max_tokens" }),
    ]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "content_stop", stopReason: "max_tokens" });
  });

  it("returns content_stop for a refusal (guardrail_intervened)", async () => {
    const { client } = fixtureClient([
      successResponse(VALID_OUTPUT, { stopReason: "guardrail_intervened" }),
    ]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({
      kind: "content_stop",
      stopReason: "guardrail_intervened",
    });
  });
});

describe("converse: malformed and semantically invalid output", () => {
  it("returns parse_failure for text that is not valid JSON, and hands the exact raw text to the callback", async () => {
    const { client } = fixtureClient([
      successResponse("placeholder", {
        output: { message: { role: "assistant", content: [{ text: "{not json" }] } },
      }),
    ]);
    const onRejectedRawText = vi.fn();
    const outcome = await converse(client, baseParams({ onRejectedRawText }), FITS);
    expect(outcome).toStrictEqual({ kind: "parse_failure" });
    expect(onRejectedRawText).toHaveBeenCalledWith("{not json");
  });

  it("returns schema_failure for JSON that does not match the accepted output schema", async () => {
    const { client } = fixtureClient([successResponse({ status: "invented_status" })]);
    const onRejectedRawText = vi.fn();
    const outcome = await converse(client, baseParams({ onRejectedRawText }), FITS);
    expect(outcome.kind).toBe("schema_failure");
    if (outcome.kind === "schema_failure")
      expect(outcome.issueCount).toBeGreaterThan(0);
    expect(onRejectedRawText).toHaveBeenCalledWith(
      JSON.stringify({ status: "invented_status" }),
    );
  });

  it("returns accepted for output that is schema-valid but references content this layer cannot judge", async () => {
    // converse() has no trusted_context and cannot know "ent_nonexistent" isn't a
    // real entity — that membership check is validation/normalization.ts's job
    // (P4-03). This proves the separation: schema-valid, semantically bogus
    // content is still "accepted" here.
    const semanticallyBogus = {
      status: "normalized" as const,
      subject_entity_id: "ent_nonexistent",
      predicate: "was_at" as const,
      object_entity_id: "ent_also_nonexistent",
      polarity: "positive" as const,
      context_key: "not_a_real_context",
      alleged_source_actor_id: null,
      reason_code: null,
    };
    const { client } = fixtureClient([successResponse(semanticallyBogus)]);
    const outcome = await converse(client, baseParams(), FITS);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted")
      expect(outcome.result).toStrictEqual(semanticallyBogus);
  });
});
