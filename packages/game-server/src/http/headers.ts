/**
 * Response header builders shared by every route.
 *
 * Each function returns exactly the headers it names; a route composes the
 * ones it needs rather than reaching for a mutable shared object, so two
 * routes can never fight over the same key by accident.
 */

/** Mutation and action-status responses: never cached, never revalidated. */
export function noStoreHeaders(): Record<string, string> {
  return { "cache-control": "no-store" };
}

/** Authenticated read responses: cacheable only by the browser, per cookie. */
export function privateNoCacheHeaders(): Record<string, string> {
  return { "cache-control": "private, no-cache", vary: "Cookie" };
}

/** Quoted per RFC 9110 so a downstream cache treats it as an opaque token. */
export function etagHeader(viewVersion: string): Record<string, string> {
  return { etag: `"${viewVersion}"` };
}

export function retryAfter(seconds: number): Record<string, string> {
  return { "retry-after": String(seconds) };
}

export function locationHeader(url: string): Record<string, string> {
  return { location: url };
}

/**
 * Route-invariant security headers. `x-request-id` is server-generated only
 * (`request-id.ts#createRequestId`) — never read back from the request.
 */
export function securityHeaders(requestId: string): Record<string, string> {
  return {
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  };
}
