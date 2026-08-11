/**
 * The raw per-attempt HTTP outcomes the recovery machine reacts to — one
 * `POST` or one status poll, never a loop. `journal/useRecoveringAction.ts`
 * is the only caller; it owns retries and timing, this module only
 * classifies one response at a time.
 */

import type {
  ActionRequest,
  CompletedActionResponse,
} from "@the-town-remembers/http-contracts";
import {
  CompletedActionResponseSchema,
  ProcessingActionResponseSchema,
  ROUTE_TEMPLATES,
} from "@the-town-remembers/http-contracts";

import { apiRequest, ApiError, buildPath, NetworkError } from "./client.js";

export type ActionAttemptOutcome =
  | { readonly kind: "completed"; readonly result: CompletedActionResponse }
  | { readonly kind: "processing"; readonly actionId: string; readonly pollAfterMs: number }
  | { readonly kind: "conflict" }
  | { readonly kind: "actionInProgress"; readonly blockingActionId: string | undefined }
  | { readonly kind: "rateLimited"; readonly retryAfterSeconds: number }
  | { readonly kind: "requiresNewAction"; readonly reason: string }
  | { readonly kind: "offline" };

const REQUIRES_NEW_ACTION_CODES = new Set([
  "IDEMPOTENCY_KEY_REUSED",
  "MODEL_UNAVAILABLE_RETRY_ACTION",
  "ACTION_PROCESSING_EXHAUSTED",
]);

function classifyError(error: unknown): ActionAttemptOutcome {
  if (error instanceof NetworkError) return { kind: "offline" };
  if (error instanceof ApiError) {
    const { code, status } = error.problem;
    if (code === "ACTION_CONFLICT") return { kind: "conflict" };
    if (code === "ACTION_IN_PROGRESS") {
      const location = error.headers.get("location");
      const blockingActionId = location?.split("/").pop();
      return { kind: "actionInProgress", blockingActionId };
    }
    if (status === 429) {
      const retryAfter = error.headers.get("retry-after");
      return { kind: "rateLimited", retryAfterSeconds: retryAfter ? Number(retryAfter) : 1 };
    }
    if (REQUIRES_NEW_ACTION_CODES.has(code) || status === 401 || status === 410) {
      return { kind: "requiresNewAction", reason: code };
    }
    return { kind: "requiresNewAction", reason: code };
  }
  return { kind: "offline" };
}

export async function postAction(
  townId: string,
  idempotencyKey: string,
  request: ActionRequest,
  signal?: AbortSignal,
): Promise<ActionAttemptOutcome> {
  try {
    const response = await apiRequest(buildPath(ROUTE_TEMPLATES.actions, { townId }), {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: request,
      ...(signal ? { signal } : {}),
    });
    if (response.status === 202) {
      const processing = ProcessingActionResponseSchema.parse(response.body);
      return {
        kind: "processing",
        actionId: processing.actionId,
        pollAfterMs: processing.pollAfterMs,
      };
    }
    return { kind: "completed", result: CompletedActionResponseSchema.parse(response.body) };
  } catch (error) {
    return classifyError(error);
  }
}

export async function pollAction(
  townId: string,
  actionId: string,
  signal?: AbortSignal,
): Promise<ActionAttemptOutcome> {
  try {
    const response = await apiRequest(
      buildPath(ROUTE_TEMPLATES.actionStatus, { townId, actionId }),
      signal ? { signal } : {},
    );
    if (response.status === 202) {
      const processing = ProcessingActionResponseSchema.parse(response.body);
      return {
        kind: "processing",
        actionId: processing.actionId,
        pollAfterMs: processing.pollAfterMs,
      };
    }
    return { kind: "completed", result: CompletedActionResponseSchema.parse(response.body) };
  } catch (error) {
    return classifyError(error);
  }
}
