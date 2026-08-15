import type { InvokeModelCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it } from "vitest";

import {
  createTitanEmbedClient,
  embedText,
  embedTextWithRetry,
  TITAN_EMBEDDING_DIMENSIONS,
  type EmbedTextParams,
  type TitanEmbedClient,
} from "./titan.js";

function bodyOf(payload: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function validEmbedding(length = TITAN_EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length }, (_, index) => (index % 7) / 7 - 0.5);
}

interface FixtureClient {
  readonly client: TitanEmbedClient;
  readonly callCount: () => number;
}

/**
 * The real `InvokeModelCommandOutput.body` type is `Uint8ArrayBlobAdapter`
 * (`@smithy/core`'s `Uint8Array` subtype with a `transformToString` method)
 * — a plain `Buffer` satisfies everything `titan.ts` actually reads from it
 * (`Buffer.from(output.body).toString("utf8")`, never the adapter's own
 * method), so the cast below is a fixture-shape convenience, not a runtime
 * gap.
 */
function fixtureClient(
  responses: readonly ({ readonly body: Uint8Array | undefined } | Error)[],
): FixtureClient {
  let index = 0;
  const client: TitanEmbedClient = {
    send() {
      const response = responses[index] ?? responses[responses.length - 1]!;
      index += 1;
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve({
        $metadata: {},
        body: response.body,
        contentType: "application/json",
      } as InvokeModelCommandOutput);
    },
  };
  return { client, callCount: () => index };
}

function baseParams(overrides: Partial<EmbedTextParams> = {}): EmbedTextParams {
  return {
    modelId: "amazon.titan-embed-text-v2:0",
    inputText: "The bell in the chapel tower has not rung since spring.",
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

const FITS = {
  now: new Date("2026-08-13T12:00:00.000Z"),
  retryNow: () => new Date("2026-08-13T12:00:02.000Z"),
  applicationDeadlineAt: new Date("2026-08-13T12:00:24.000Z"),
  worstCaseMs: 1500,
  reserveMs: 4000,
};

const NEVER_FITS = {
  now: new Date("2026-08-13T12:00:00.000Z"),
  applicationDeadlineAt: new Date("2026-08-13T12:00:00.500Z"),
  worstCaseMs: 1500,
  reserveMs: 4000,
};

describe("createTitanEmbedClient", () => {
  it("returns an object with a callable send method", () => {
    const client = createTitanEmbedClient("us-east-1");
    expect(typeof client.send).toBe("function");
  });
});

describe("embedText: success", () => {
  it("returns accepted with the embedding and token count for a well-formed response", async () => {
    const embedding = validEmbedding();
    const { client } = fixtureClient([
      { body: bodyOf({ embedding, inputTextTokenCount: 14 }) },
    ]);

    const outcome = await embedText(client, baseParams(), FITS);

    expect(outcome).toStrictEqual({
      kind: "accepted",
      embedding,
      inputTextTokenCount: 14,
    });
  });

  it("defaults inputTextTokenCount to 0 when the response omits it", async () => {
    const { client } = fixtureClient([
      { body: bodyOf({ embedding: validEmbedding() }) },
    ]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.inputTextTokenCount).toBe(0);
    }
  });
});

describe("embedText: does not fit before the reserve", () => {
  it("returns timeout with attempted false and never calls the client", async () => {
    const { client, callCount } = fixtureClient([{ body: bodyOf({ embedding: [] }) }]);
    const outcome = await embedText(client, baseParams(), NEVER_FITS);
    expect(outcome).toStrictEqual({ kind: "timeout", attempted: false });
    expect(callCount()).toBe(0);
  });
});

describe("embedText: wrong dimension", () => {
  it("rejects an embedding shorter than 256 without ever reaching the caller as accepted", async () => {
    const { client } = fixtureClient([
      { body: bodyOf({ embedding: validEmbedding(128) }) },
    ]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "wrong_dimension", actualLength: 128 });
  });

  it("rejects an embedding longer than 256", async () => {
    const { client } = fixtureClient([
      { body: bodyOf({ embedding: validEmbedding(300) }) },
    ]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "wrong_dimension", actualLength: 300 });
  });
});

describe("embedText: non-finite value", () => {
  it("rejects an embedding containing NaN", async () => {
    const embedding = validEmbedding();
    embedding[10] = Number.NaN;
    const { client } = fixtureClient([{ body: bodyOf({ embedding }) }]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "non_finite_value" });
  });

  it("rejects an embedding containing Infinity", async () => {
    const embedding = validEmbedding();
    embedding[0] = Number.POSITIVE_INFINITY;
    const { client } = fixtureClient([{ body: bodyOf({ embedding }) }]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "non_finite_value" });
  });

  it("rejects an embedding containing a non-number element", async () => {
    const { client } = fixtureClient([
      { body: bodyOf({ embedding: [...validEmbedding(255), "not-a-number"] }) },
    ]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "non_finite_value" });
  });
});

describe("embedText: invalid response", () => {
  it("rejects a body with no embedding field", async () => {
    const { client } = fixtureClient([{ body: bodyOf({ inputTextTokenCount: 5 }) }]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "invalid_response" });
  });

  it("rejects a body that is not valid JSON", async () => {
    const { client } = fixtureClient([{ body: Buffer.from("not json", "utf8") }]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "invalid_response" });
  });

  it("rejects a response with no body at all", async () => {
    const { client } = fixtureClient([{ body: undefined }]);
    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "invalid_response" });
  });
});

describe("embedText: transport failure and timeout", () => {
  it("classifies a throttling error as a retryable transport_failure", async () => {
    const error = new Error("rate limited");
    error.name = "ThrottlingException";
    const { client } = fixtureClient([error]);

    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: true,
      errorName: "ThrottlingException",
    });
  });

  it("classifies a validation error as a non-retryable transport_failure", async () => {
    const error = new Error("bad input");
    error.name = "ValidationException";
    const { client } = fixtureClient([error]);

    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: false,
      errorName: "ValidationException",
    });
  });

  it("returns timeout with attempted true when the abort signal fires mid-call", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const { client } = fixtureClient([abortError]);

    const outcome = await embedText(client, baseParams(), FITS);
    expect(outcome).toStrictEqual({ kind: "timeout", attempted: true });
  });
});

describe("embedTextWithRetry", () => {
  it("retries exactly once after a retryable transport_failure, then succeeds", async () => {
    const throttled = new Error("rate limited");
    throttled.name = "ThrottlingException";
    const embedding = validEmbedding();
    const { client, callCount } = fixtureClient([
      throttled,
      { body: bodyOf({ embedding, inputTextTokenCount: 9 }) },
    ]);

    const outcome = await embedTextWithRetry(client, baseParams(), FITS);

    expect(callCount()).toBe(2);
    expect(outcome).toStrictEqual({
      kind: "accepted",
      embedding,
      inputTextTokenCount: 9,
    });
  });

  it("does not retry a non-retryable transport_failure", async () => {
    const validationError = new Error("bad input");
    validationError.name = "ValidationException";
    const { client, callCount } = fixtureClient([validationError]);

    const outcome = await embedTextWithRetry(client, baseParams(), FITS);

    expect(callCount()).toBe(1);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: false,
      errorName: "ValidationException",
    });
  });

  it("rechecks the clock and skips a retry that no longer fits", async () => {
    const throttled = new Error("rate limited");
    throttled.name = "ThrottlingException";
    const { client, callCount } = fixtureClient([throttled]);

    const outcome = await embedTextWithRetry(client, baseParams(), {
      ...FITS,
      retryNow: () => new Date("2026-08-13T12:00:23.000Z"),
    });

    expect(callCount()).toBe(1);
    expect(outcome).toStrictEqual({ kind: "timeout", attempted: false });
  });

  it("does not retry a wrong_dimension or non_finite_value outcome", async () => {
    const { client, callCount } = fixtureClient([
      { body: bodyOf({ embedding: validEmbedding(10) }) },
    ]);

    const outcome = await embedTextWithRetry(client, baseParams(), FITS);

    expect(callCount()).toBe(1);
    expect(outcome).toStrictEqual({ kind: "wrong_dimension", actualLength: 10 });
  });

  it("never retries past a single attempt even when the retry would also fail", async () => {
    const throttled = new Error("rate limited");
    throttled.name = "ThrottlingException";
    const { client, callCount } = fixtureClient([throttled, throttled, throttled]);

    const outcome = await embedTextWithRetry(client, baseParams(), FITS);

    expect(callCount()).toBe(2);
    expect(outcome).toStrictEqual({
      kind: "transport_failure",
      retryable: true,
      errorName: "ThrottlingException",
    });
  });
});
