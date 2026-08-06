/**
 * Safe structured logging for the Game API.
 *
 * The exported event types are closed. A raw URL, query string, header,
 * cookie, authorization value, request body, or environment value has no field
 * to travel in, so redaction is a property of the type rather than of a
 * reviewer's attention.
 */

import process from "node:process";

import type {
  RouteTemplate,
  UNMATCHED_ROUTE_TEMPLATE,
} from "@the-town-remembers/http-contracts";

import type { LoggableMethod } from "../http/types.js";

export type LoggableRoute = RouteTemplate | typeof UNMATCHED_ROUTE_TEMPLATE;

export interface HttpRequestLogEvent {
  readonly event: "http_request";
  readonly requestId: string;
  readonly routeTemplate: LoggableRoute;
  readonly method: LoggableMethod;
  readonly status: number;
  readonly durationMs: number;
  readonly build: string;
  readonly environment: string;
}

export interface ServerLifecycleLogEvent {
  readonly event: "server_started" | "server_stopped";
  readonly build: string;
  readonly environment: string;
  readonly port: number;
}

export type GameApiLogEvent = HttpRequestLogEvent | ServerLifecycleLogEvent;

/**
 * Writes exactly one JSON object per line directly to stdout. Bypassing
 * `console` keeps the emitted bytes free of any formatting a runtime or test
 * harness might add, so what a redaction test reads is what production emits.
 */
export function logEvent(event: GameApiLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
