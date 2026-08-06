/**
 * Route table and dispatch for the Game API.
 *
 * Phase 0 serves exactly one route. Everything else — an unknown path, a known
 * path with the wrong method, or a route a later phase will add — returns the
 * same `404 RESOURCE_NOT_FOUND`. Decision 006's status policy has no `405`,
 * and returning one would both widen the accepted contract and tell a prober
 * which paths exist.
 */

import type { RouteTemplate } from "@the-town-remembers/http-contracts";
import {
  PROBLEM_CODES,
  ROUTE_TEMPLATES,
  UNMATCHED_ROUTE_TEMPLATE,
} from "@the-town-remembers/http-contracts";
import type { GameConfig } from "@the-town-remembers/runtime-config/game";

import { logEvent, type LoggableRoute } from "../observability/log.js";
import { buildHealthResponse } from "../routes/health.js";
import { problemResponse } from "./problem.js";
import { createRequestId } from "./request-id.js";
import { toLoggableMethod, type HttpRequest, type HttpResponse } from "./types.js";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface RouterContext {
  readonly config: GameConfig;
  readonly now: () => Date;
  readonly monotonicMs: () => number;
}

interface Route {
  readonly method: "GET";
  readonly template: RouteTemplate;
  readonly handle: (context: RouterContext) => HttpResponse;
}

/**
 * Headers applied to every response. Caching is disabled for the whole `/api`
 * surface, and the referrer policy keeps a capability URL out of a third
 * party's logs.
 */
function baseHeaders(requestId: string): Record<string, string> {
  return {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  };
}

const ROUTES: readonly Route[] = [
  {
    method: "GET",
    template: ROUTE_TEMPLATES.health,
    handle: (context) => ({
      status: 200,
      headers: { "content-type": JSON_CONTENT_TYPE },
      body: JSON.stringify(
        buildHealthResponse({ buildId: context.config.buildId, now: context.now }),
      ),
    }),
  },
];

/** Trailing slashes are normalized so `/health/` cannot become a second route. */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export interface HandledRequest {
  readonly response: HttpResponse;
  readonly requestId: string;
}

export function handleRequest(
  request: HttpRequest,
  context: RouterContext,
): HandledRequest {
  const requestId = createRequestId();
  const startedAtMs = context.monotonicMs();
  const headers = baseHeaders(requestId);
  const path = normalizePath(request.path);

  const route = ROUTES.find(
    (candidate) => candidate.template === path && candidate.method === request.method,
  );

  const routed = route?.handle(context);
  const response: HttpResponse = routed
    ? { ...routed, headers: { ...headers, ...routed.headers } }
    : problemResponse(
        {
          status: 404,
          code: PROBLEM_CODES.resourceNotFound,
          title: "Not found",
          detail: "No resource is available at this address.",
          requestId,
        },
        headers,
      );

  const routeTemplate: LoggableRoute = route?.template ?? UNMATCHED_ROUTE_TEMPLATE;
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

/** Route templates this phase actually serves, for documentation and tests. */
export const IMPLEMENTED_ROUTE_TEMPLATES: readonly RouteTemplate[] = ROUTES.map(
  (route) => route.template,
);
