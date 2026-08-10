/**
 * The adapter's own share of routing: a request ID, base headers, and a log
 * line around whatever `@the-town-remembers/game-server`'s router decides.
 *
 * The route table, path-template matching, and the uniform failure boundary
 * all live in `game-server`'s router now — this file never builds a response
 * body itself.
 */

import type { RouteTemplate } from "@the-town-remembers/http-contracts";
import { ROUTE_TEMPLATES } from "@the-town-remembers/http-contracts";
import { routeRequest, type RouterConfig } from "@the-town-remembers/game-server";
import type { GameConfig } from "@the-town-remembers/runtime-config/game";

import { logEvent } from "../observability/log.js";
import { createRequestId } from "./request-id.js";
import { toLoggableMethod, type HttpRequest, type HttpResponse } from "./types.js";

export interface RouterContext {
  readonly config: GameConfig;
  readonly now: () => Date;
  readonly monotonicMs: () => number;
}

/**
 * Headers applied to every response regardless of route. Caching is decided
 * per route by `game-server`'s router; these three are invariant.
 */
function baseHeaders(requestId: string): Record<string, string> {
  return {
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  };
}

export interface HandledRequest {
  readonly response: HttpResponse;
  readonly requestId: string;
}

export async function handleRequest(
  request: HttpRequest,
  context: RouterContext,
): Promise<HandledRequest> {
  const requestId = createRequestId();
  const startedAtMs = context.monotonicMs();

  const config: RouterConfig = {
    buildId: context.config.buildId,
    appOrigin: context.config.appOrigin,
    now: context.now,
  };
  const { response: routed, routeTemplate } = await routeRequest(
    request,
    requestId,
    config,
  );

  const response: HttpResponse = {
    ...routed,
    headers: { ...baseHeaders(requestId), ...routed.headers },
  };

  logEvent({
    event: "http_request",
    requestId,
    routeTemplate,
    method: toLoggableMethod(request.method),
    status: response.status,
    durationMs: Math.max(0, Math.round(context.monotonicMs() - startedAtMs)),
    build: context.config.buildId,
    environment: context.config.environment,
  });

  return { response, requestId };
}

/** Route templates this deployment actually serves, for documentation and tests. */
export const IMPLEMENTED_ROUTE_TEMPLATES: readonly RouteTemplate[] =
  Object.values(ROUTE_TEMPLATES);
