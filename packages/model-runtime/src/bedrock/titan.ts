/**
 * Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`) via Bedrock's
 * `InvokeModel` API (`P4-07`; docs/003 "Titan Text Embeddings V2").
 *
 * A different shape from `converse.ts`'s Converse API: an embedding call has
 * no system prompt, no structured-output grammar, and no `trusted_context`
 * — just input text and a requested dimension count, and a plain float
 * array back. It shares `converse.ts`'s deadline check
 * (`deadline.ts#fitsBeforeReserve`) and error classification
 * (`classifyBedrockError`) but is otherwise its own module, since there is
 * nothing else in common to factor out.
 *
 * `dimensions: 256` matches `database#EMBEDDING_DIMENSIONS` and the
 * `episodes.embedding VECTOR(256)` column exactly — this module is the one
 * place that number is a request parameter rather than a schema constant,
 * so `TITAN_EMBEDDING_DIMENSIONS` exists to keep the two from drifting
 * apart independently.
 *
 * Every failure outcome carries only a kind and small safe metadata, the
 * same discipline `bedrock/outcomes.ts` holds `DependencyOutcome` to — a
 * malformed or wrong-shaped response is never exposed as its own raw text.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

import { fitsBeforeReserve, type ConverseFitCheck } from "./deadline.js";
import { classifyBedrockError } from "./error-classification.js";

export const TITAN_EMBEDDING_DIMENSIONS = 256;

/** The narrow slice of `BedrockRuntimeClient` this module calls, so a test can supply a spy without constructing a real client. */
export interface TitanEmbedClient {
  send(
    command: InvokeModelCommand,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<InvokeModelCommandOutput>;
}

export function createTitanEmbedClient(region: string): TitanEmbedClient {
  return new BedrockRuntimeClient({ region });
}

export const TITAN_EMBED_OUTCOME_KINDS = [
  "transport_failure",
  "timeout",
  "invalid_response",
  "wrong_dimension",
  "non_finite_value",
  "accepted",
] as const;

export type TitanEmbedOutcomeKind = (typeof TITAN_EMBED_OUTCOME_KINDS)[number];

export interface TitanTransportFailureOutcome {
  readonly kind: "transport_failure";
  readonly retryable: boolean;
  readonly errorName: string;
}

export interface TitanTimeoutOutcome {
  readonly kind: "timeout";
  /** False when the call's worst case never fit before the reserve — no AWS call was constructed at all. */
  readonly attempted: boolean;
}

/** The response body was not JSON, or had no `embedding` array at all. */
export interface TitanInvalidResponseOutcome {
  readonly kind: "invalid_response";
}

export interface TitanWrongDimensionOutcome {
  readonly kind: "wrong_dimension";
  readonly actualLength: number;
}

export interface TitanNonFiniteValueOutcome {
  readonly kind: "non_finite_value";
}

export interface TitanAcceptedOutcome {
  readonly kind: "accepted";
  readonly embedding: readonly number[];
  readonly inputTextTokenCount: number;
}

export type TitanEmbedOutcome =
  | TitanTransportFailureOutcome
  | TitanTimeoutOutcome
  | TitanInvalidResponseOutcome
  | TitanWrongDimensionOutcome
  | TitanNonFiniteValueOutcome
  | TitanAcceptedOutcome;

export interface EmbedTextParams {
  /** Resolved model id or inference-profile ARN — deployment configuration, never chosen here. */
  readonly modelId: string;
  readonly inputText: string;
  readonly abortSignal: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name: unknown }).name === "AbortError"
  );
}

interface TitanResponseBody {
  readonly embedding?: unknown;
  readonly inputTextTokenCount?: unknown;
}

function parseResponseBody(
  output: InvokeModelCommandOutput,
): TitanResponseBody | undefined {
  // The SDK's own type promises `body` is always present, but that is a
  // compile-time convenience over an external HTTP response, not a runtime
  // guarantee — a malformed or truncated response is exactly the kind of
  // trust-boundary case this repo checks for rather than trusts a type alone.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!output.body) return undefined;
  try {
    return JSON.parse(Buffer.from(output.body).toString("utf8")) as TitanResponseBody;
  } catch {
    return undefined;
  }
}

/** One embedding call, at most once — the caller (a future `retryEmbedText`-style wrapper or `episodes.ts`) decides whether a `transport_failure` is worth retrying. */
export async function embedText(
  client: TitanEmbedClient,
  params: EmbedTextParams,
  fitCheck: ConverseFitCheck,
): Promise<TitanEmbedOutcome> {
  if (!fitsBeforeReserve(fitCheck)) {
    return { kind: "timeout", attempted: false };
  }

  let response: InvokeModelCommandOutput;
  try {
    response = await client.send(
      new InvokeModelCommand({
        modelId: params.modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          inputText: params.inputText,
          dimensions: TITAN_EMBEDDING_DIMENSIONS,
          normalize: true,
        }),
      }),
      { abortSignal: params.abortSignal },
    );
  } catch (error) {
    if (isAbortError(error)) return { kind: "timeout", attempted: true };
    const classification = classifyBedrockError(error);
    return {
      kind: "transport_failure",
      retryable: classification.retryable,
      errorName: classification.errorName,
    };
  }

  const body = parseResponseBody(response);
  if (body === undefined || !Array.isArray(body.embedding)) {
    return { kind: "invalid_response" };
  }

  if (body.embedding.length !== TITAN_EMBEDDING_DIMENSIONS) {
    return { kind: "wrong_dimension", actualLength: body.embedding.length };
  }

  if (
    !body.embedding.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    return { kind: "non_finite_value" };
  }

  return {
    kind: "accepted",
    embedding: body.embedding,
    inputTextTokenCount:
      typeof body.inputTextTokenCount === "number" ? body.inputTextTokenCount : 0,
  };
}

/**
 * At most one retry, and only for a retryable `transport_failure` whose
 * worst case still fits — the same bound `bedrock/retry.ts#converseWithRetry`
 * holds Converse calls to (`D4-S`).
 */
export async function embedTextWithRetry(
  client: TitanEmbedClient,
  params: EmbedTextParams,
  fitCheck: ConverseFitCheck,
): Promise<TitanEmbedOutcome> {
  const first = await embedText(client, params, fitCheck);
  if (first.kind !== "transport_failure" || !first.retryable) return first;
  if (!fitsBeforeReserve(fitCheck)) return first;
  return embedText(client, params, fitCheck);
}
