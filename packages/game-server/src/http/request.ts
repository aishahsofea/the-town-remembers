/**
 * The header allowlist and cookie parsing every adapter and route shares.
 *
 * An unlisted header has no field to carry it past the adapter boundary: the
 * widened `HttpRequest#headers` map is built by filtering the transport's raw
 * headers through {@link HEADER_ALLOWLIST} before a route ever sees them, the
 * same technique `observability/log.ts`'s closed event union already uses for
 * log fields.
 */

/** The only headers a Phase 3 route may read. Lowercased, transport-agnostic. */
export const HEADER_ALLOWLIST = Object.freeze([
  "authorization",
  "content-type",
  "origin",
  "cookie",
  "idempotency-key",
  "join-attempt-secret",
  "if-none-match",
  "accept",
] as const);

export type AllowlistedHeaderName = (typeof HEADER_ALLOWLIST)[number];

const ALLOWLIST_SET: ReadonlySet<string> = new Set(HEADER_ALLOWLIST);

/**
 * Builds the widened request's header map from a transport's raw header
 * entries. Names are lowercased before the allowlist check, so an adapter
 * never has to know which transport already lowercases for it. A repeated
 * name keeps its first value, matching {@link parseCookies}'s duplicate rule.
 */
export function filterAllowlistedHeaders(
  raw: Iterable<readonly [string, string | undefined]>,
): ReadonlyMap<string, string> {
  const headers = new Map<string, string>();
  for (const [rawName, value] of raw) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (!ALLOWLIST_SET.has(name) || headers.has(name)) continue;
    headers.set(name, value);
  }
  return headers;
}

export function readHeader(
  headers: ReadonlyMap<string, string>,
  name: AllowlistedHeaderName,
): string | undefined {
  return headers.get(name);
}

/**
 * RFC 6265 `Cookie` header parsing: pairs split on `; `, first `=` separates
 * name from value, no decoding of the value. A duplicate name keeps its first
 * occurrence, matching the header's own left-to-right precedence.
 */
export function parseCookies(
  cookieHeader: string | undefined,
): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (cookieHeader === undefined) return cookies;

  for (const pair of cookieHeader.split(";")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1);
    if (name === "" || cookies.has(name)) continue;

    cookies.set(name, value);
  }
  return cookies;
}
