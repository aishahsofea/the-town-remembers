/**
 * Transport-error classification, shared by `converse.ts` (which needs it
 * to populate `TransportFailureOutcome.retryable`) and `retry.ts` (which
 * decides whether to spend the one allowed retry on it) — split into its
 * own module specifically so neither of those two needs to import the
 * other.
 */

const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ThrottlingException",
  "InternalServerException",
  "ServiceUnavailableException",
  "ModelNotReadyException",
]);

export interface ErrorClassification {
  readonly retryable: boolean;
  readonly errorName: string;
}

function httpStatusCodeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata = (
    error as { readonly $metadata?: { readonly httpStatusCode?: unknown } }
  ).$metadata;
  const code = metadata?.httpStatusCode;
  return typeof code === "number" ? code : undefined;
}

/** Throttling and 5xx are retryable; everything else — auth, validation, 4xx, an unrecognized error — is terminal. */
export function classifyBedrockError(error: unknown): ErrorClassification {
  const errorName =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { readonly name: unknown }).name)
      : "UnknownError";

  if (RETRYABLE_ERROR_NAMES.has(errorName)) return { retryable: true, errorName };

  const statusCode = httpStatusCodeOf(error);
  if (statusCode !== undefined && statusCode >= 500) {
    return { retryable: true, errorName };
  }

  return { retryable: false, errorName };
}
