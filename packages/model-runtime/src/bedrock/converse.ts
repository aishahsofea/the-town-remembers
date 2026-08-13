/**
 * The one `converse(request)` entry point (Decision 010). Builds the exact
 * `outputConfig.textFormat.structure.jsonSchema` Bedrock structured output
 * needs, with citations and streaming off, and resolves to a
 * `DependencyOutcome` — never a thrown error and never raw model text on
 * any returned field. Everything after "the AWS call returned a
 * `ConverseResponse`" is deterministic, dependency-free logic this module
 * owns alone; `bedrock/retry.ts` is the only caller allowed to invoke this
 * function twice for one logical request.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { z } from "zod";

import { fitsBeforeReserve, type ConverseFitCheck } from "./deadline.js";
import { classifyBedrockError } from "./error-classification.js";
import type { DependencyOutcome } from "./outcomes.js";

/**
 * The narrow slice of `BedrockRuntimeClient` this module calls, so a test
 * can supply a spy without constructing a real client.
 */
export interface BedrockConverseClient {
  send(
    command: ConverseCommand,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<ConverseCommandOutput>;
}

export function createBedrockConverseClient(region: string): BedrockConverseClient {
  return new BedrockRuntimeClient({ region });
}

export interface ConverseParams<TOutput> {
  /** Resolved model id or inference-profile ARN — deployment configuration, never chosen here. */
  readonly modelId: string;
  readonly systemPrompt: string;
  /** The exact serialized `{task_input_version, trusted_context, untrusted_*}` object. */
  readonly userMessageJson: string;
  readonly outputSchemaName: string;
  readonly outputSchemaDescription: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly abortSignal: AbortSignal;
  readonly worstCaseMs: number;
  /**
   * Invoked with the exact rejected raw text on `parse_failure`/
   * `schema_failure` only. A callback, not a return field — there is
   * nowhere on `DependencyOutcome` this text could otherwise land.
   */
  readonly onRejectedRawText?: (rawText: string) => void;
}

function buildConverseCommand<TOutput>(
  params: ConverseParams<TOutput>,
): ConverseCommand {
  return new ConverseCommand({
    modelId: params.modelId,
    system: [{ text: params.systemPrompt }],
    messages: [{ role: "user", content: [{ text: params.userMessageJson }] }],
    inferenceConfig: {
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    },
    outputConfig: {
      textFormat: {
        type: "json_schema",
        structure: {
          jsonSchema: {
            name: params.outputSchemaName,
            description: params.outputSchemaDescription,
            schema: JSON.stringify(params.jsonSchema),
          },
        },
      },
    },
  });
}

function extractText(response: ConverseCommandOutput): string | undefined {
  const content = response.output?.message?.content;
  if (!content) return undefined;
  for (const block of content) {
    if (typeof block.text === "string") return block.text;
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name: unknown }).name === "AbortError"
  );
}

export async function converse<TOutput>(
  client: BedrockConverseClient,
  params: ConverseParams<TOutput>,
  fitCheck: ConverseFitCheck,
): Promise<DependencyOutcome<TOutput>> {
  if (!fitsBeforeReserve(fitCheck)) {
    return { kind: "timeout", attempted: false };
  }

  let response: ConverseCommandOutput;
  try {
    response = await client.send(buildConverseCommand(params), {
      abortSignal: params.abortSignal,
    });
  } catch (error) {
    if (isAbortError(error)) return { kind: "timeout", attempted: true };
    const classification = classifyBedrockError(error);
    return {
      kind: "transport_failure",
      retryable: classification.retryable,
      errorName: classification.errorName,
    };
  }

  if (response.stopReason !== "end_turn") {
    return { kind: "content_stop", stopReason: response.stopReason ?? "unknown" };
  }

  const rawText = extractText(response);
  if (rawText === undefined) {
    return { kind: "content_stop", stopReason: "no_text" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    params.onRejectedRawText?.(rawText);
    return { kind: "parse_failure" };
  }

  const validated = params.outputSchema.safeParse(parsed);
  if (!validated.success) {
    params.onRejectedRawText?.(rawText);
    return { kind: "schema_failure", issueCount: validated.error.issues.length };
  }

  return {
    kind: "accepted",
    result: validated.data,
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    },
  };
}
