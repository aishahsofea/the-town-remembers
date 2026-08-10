/**
 * Closed structured-event union for `packages/game-server`.
 *
 * This is a diagnostic channel distinct from `apps/game-api`'s per-request
 * `http_request` summary: it exists for events raised from inside the
 * package's own dispatch and application logic, at the point a decision is
 * made rather than after the fact. Every field stays enumerated or ID-shaped,
 * the same discipline `apps/game-api/src/observability/log.ts` already holds
 * its own closed union to.
 */

import process from "node:process";

import type {
  RouteTemplate,
  UNMATCHED_ROUTE_TEMPLATE,
} from "@the-town-remembers/http-contracts";

export type LoggableRouteTemplate = RouteTemplate | typeof UNMATCHED_ROUTE_TEMPLATE;

/**
 * Raised when the uniform failure boundary catches something other than an
 * `AppError` — the one place an unexpected internal failure becomes visible
 * without carrying the value that caused it.
 */
export interface UnexpectedErrorLogEvent {
  readonly event: "unexpected_error";
  readonly requestId: string;
  readonly routeTemplate: LoggableRouteTemplate;
}

export type GameServerLogEvent = UnexpectedErrorLogEvent;

/**
 * Writes exactly one JSON object per line directly to stdout, matching
 * `apps/game-api/src/observability/log.ts#logEvent`'s bypass of `console`.
 */
export function logEvent(event: GameServerLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
