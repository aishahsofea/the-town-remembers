/**
 * The internal request and response shapes both adapters translate to.
 *
 * `headers` carries only `HEADER_ALLOWLIST`'s eight names, lowercased, filtered
 * by each adapter before construction — an unlisted header has no field to
 * reach a route or a log line. `HttpResponse#cookies` is a separate array
 * rather than folded into `headers`, because the header map is single-valued
 * and a session response can carry more than one `Set-Cookie`.
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
  /** Lowercased names, already filtered to `HEADER_ALLOWLIST` by the adapter. */
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string | undefined;
  readonly sourceIp: string | undefined;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Never flattened into `headers`: one entry per `Set-Cookie` line. */
  readonly cookies: readonly string[];
}
