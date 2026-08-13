/**
 * Town-scoped session cookies (`D3-E`).
 *
 * Named from the opaque town ID rather than a derived digest: the town ID is
 * already in the cookie's own `Path` and in every request line, so hiding it
 * in the name would add a hash computation without hiding anything.
 */

const MAX_AGE_SECONDS = 31_536_000;

export function sessionCookieName(townId: string): string {
  return `ttr_town_${townId}`;
}

export function buildSessionCookie(townId: string, token: string): string {
  return [
    `${sessionCookieName(townId)}=${token}`,
    `Path=/api/v1/towns/${townId}`,
    `Max-Age=${MAX_AGE_SECONDS}`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}
