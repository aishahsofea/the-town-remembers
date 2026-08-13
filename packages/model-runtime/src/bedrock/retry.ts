/**
 * The single retry policy. Decision 007 allows exactly one transport retry,
 * and only when the retried call still fits before the four-second reserve
 * — `converseWithRetry` is the one place that loop exists; nothing else in
 * this package retries a Bedrock call. Error classification itself lives in
 * `error-classification.ts`, shared with `converse.ts`.
 */

import { fitsBeforeReserve, type ConverseFitCheck } from "./deadline.js";
import type { BedrockConverseClient, ConverseParams } from "./converse.js";
import { converse } from "./converse.js";
import type { DependencyOutcome } from "./outcomes.js";

export {
  classifyBedrockError,
  type ErrorClassification,
} from "./error-classification.js";

export interface RetryFitCheck extends ConverseFitCheck {
  /** Recomputed at retry time — the clock has moved since the first attempt. */
  readonly retryNow: Date;
}

/**
 * One attempt, then — only for a retryable `transport_failure`, and only
 * when the retried call's own worst case still fits before the reserve —
 * exactly one more. A retry that no longer fits returns `timeout` with
 * `attempted: false` rather than being silently skipped in favor of the
 * first failure, so a caller can always tell "never tried" from "tried and
 * failed."
 */
export async function converseWithRetry<TOutput>(
  client: BedrockConverseClient,
  params: ConverseParams<TOutput>,
  fitCheck: RetryFitCheck,
): Promise<DependencyOutcome<TOutput>> {
  const first = await converse(client, params, fitCheck);
  if (first.kind !== "transport_failure" || !first.retryable) return first;

  const retryFitCheck: ConverseFitCheck = { ...fitCheck, now: fitCheck.retryNow };
  if (!fitsBeforeReserve(retryFitCheck)) {
    return { kind: "timeout", attempted: false };
  }

  return converse(client, params, retryFitCheck);
}
