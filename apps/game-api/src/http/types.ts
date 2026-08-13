/**
 * The internal request and response shapes both adapters translate to.
 *
 * Re-exported from `@the-town-remembers/game-server`, which owns the
 * canonical transport contract its router dispatches over — this deployment
 * unit cannot itself be imported by that library, so this re-export is the
 * one place the two stay in step rather than two independent declarations
 * that happen to be structurally equal.
 */

export type { HttpRequest, HttpResponse } from "@the-town-remembers/game-server";

export const HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Any other verb is folded into one label so it cannot reach a log field. */
export const UNKNOWN_METHOD = "OTHER" as const;

export type LoggableMethod = HttpMethod | typeof UNKNOWN_METHOD;

export function toLoggableMethod(method: string): LoggableMethod {
  const upper = method.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(upper)
    ? (upper as HttpMethod)
    : UNKNOWN_METHOD;
}
