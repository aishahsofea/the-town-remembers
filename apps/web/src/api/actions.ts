/**
 * The bare action-submission mechanics: `POST`, then poll `pollAfterMs`
 * until a terminal response. `P3-15` wraps this with the local journal,
 * `BroadcastChannel` coordination, and the full recovery state machine —
 * this module stays the one place that actually talks to the wire.
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

import { apiRequest, buildPath } from "./client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollActionStatus(
  townId: string,
  actionId: string,
  pollAfterMs: number,
  signal?: AbortSignal,
): Promise<CompletedActionResponse> {
  await sleep(pollAfterMs);
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");

  const response = await apiRequest(
    buildPath(ROUTE_TEMPLATES.actionStatus, { townId, actionId }),
    signal ? { signal } : {},
  );
  if (response.status === 202) {
    const processing = ProcessingActionResponseSchema.parse(response.body);
    return pollActionStatus(townId, actionId, processing.pollAfterMs, signal);
  }
  return CompletedActionResponseSchema.parse(response.body);
}

export async function submitAction(
  townId: string,
  idempotencyKey: string,
  request: ActionRequest,
  signal?: AbortSignal,
): Promise<CompletedActionResponse> {
  const response = await apiRequest(buildPath(ROUTE_TEMPLATES.actions, { townId }), {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: request,
    ...(signal ? { signal } : {}),
  });

  if (response.status === 202) {
    const processing = ProcessingActionResponseSchema.parse(response.body);
    return pollActionStatus(townId, processing.actionId, processing.pollAfterMs, signal);
  }
  return CompletedActionResponseSchema.parse(response.body);
}
