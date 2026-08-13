/**
 * The invite token, held only in page memory (Decision 011 §"Information
 * architecture"): "The token remains only in that current tab until an
 * existing cookie authenticates, first-time join succeeds, or the page
 * closes." Never written to `localStorage`, `sessionStorage`, IndexedDB, or
 * a URL — a plain module-scoped variable is the whole point.
 */

let capturedInviteToken: string | undefined;

export function setCapturedInviteToken(token: string): void {
  capturedInviteToken = token;
}

export function getCapturedInviteToken(): string | undefined {
  return capturedInviteToken;
}

/** Test-only: module state otherwise persists across every test in a file. */
export function clearCapturedInviteTokenForTests(): void {
  capturedInviteToken = undefined;
}
