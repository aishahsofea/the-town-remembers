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
import {
  recordHttpLatency,
  routeRequest,
  type RouterConfig,
} from "@the-town-remembers/game-server";
import type { GameConfig } from "@the-town-remembers/runtime-config/game";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import type { Pool } from "pg";

import { logEvent } from "../observability/log.js";
import { createRequestId } from "./request-id.js";
import { toLoggableMethod, type HttpRequest, type HttpResponse } from "./types.js";

export interface RouterContext {
  readonly config: GameConfig;
  readonly securityConfig: SecurityConfig;
  readonly pool: Pool;
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
    pool: context.pool,
    securityConfig: context.securityConfig,
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

  const loggableMethod = toLoggableMethod(request.method);
  const durationMs = Math.max(0, Math.round(context.monotonicMs() - startedAtMs));

  logEvent({
    event: "http_request",
    requestId,
    routeTemplate,
    method: loggableMethod,
    status: response.status,
    durationMs,
    build: context.config.buildId,
    environment: context.config.environment,
  });

  // Only the two methods this slice's routes actually serve become a metric
  // point — an unmatched verb already gets its own `404` from game-server's
  // router, and is not worth a dashboard dimension of its own.
  if (loggableMethod === "GET" || loggableMethod === "POST") {
    recordHttpLatency({
      routeTemplate,
      method: loggableMethod,
      status: response.status,
      latencyMs: durationMs,
    });
  }

  return { response, requestId };
}

/** Route templates this deployment actually serves, for documentation and tests. */
export const IMPLEMENTED_ROUTE_TEMPLATES: readonly RouteTemplate[] =
  Object.values(ROUTE_TEMPLATES);
