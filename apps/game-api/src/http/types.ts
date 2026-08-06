/**
 * The internal request and response shapes both adapters translate to.
 *
 * The request type carries only what a Phase 0 route may act on. Headers,
 * query strings, and bodies are deliberately absent: the health route needs
 * none of them, and their absence makes an accidental log or echo impossible.
 * Phase 3 widens this type when authenticated routes arrive.
 */

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

export interface HttpRequest {
  readonly method: string;
  /** Path only. A caller must strip the query string before constructing this. */
  readonly path: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}
