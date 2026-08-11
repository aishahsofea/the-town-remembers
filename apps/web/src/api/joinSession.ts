/**
 * The join idempotency key and join-attempt secret, held only in this tab's
 * `sessionStorage` for the lifetime of one join attempt (Decision 011
 * §"Invite and join"). Reused across a retry after a lost-transport response
 * so the identical `POST` and key are always what get resent; cleared once
 * the attempt reaches a terminal, authenticated result.
 */

const STORAGE_KEY = "ttr.join-session";

export interface JoinSession {
  readonly inviteToken: string;
  readonly idempotencyKey: string;
  readonly joinAttemptSecret: string;
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isJoinSession(value: unknown): value is JoinSession {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<JoinSession>;
  return (
    typeof candidate.inviteToken === "string" &&
    typeof candidate.idempotencyKey === "string" &&
    typeof candidate.joinAttemptSecret === "string"
  );
}

/** Returns the in-flight session for this exact invite token, creating one if none exists. */
export function loadOrCreateJoinSession(inviteToken: string): JoinSession {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isJoinSession(parsed) && parsed.inviteToken === inviteToken) return parsed;
    } catch {
      // Falls through to minting a fresh session below.
    }
  }

  const fresh: JoinSession = {
    inviteToken,
    idempotencyKey: crypto.randomUUID(),
    joinAttemptSecret: randomBase64Url(32),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

export function clearJoinSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
