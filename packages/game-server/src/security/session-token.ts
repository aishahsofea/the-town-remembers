/**
 * Session tokens: a 256-bit random value, stored only as a peppered hash.
 *
 * The plaintext exists only for the duration of one response — it is placed
 * in `Set-Cookie` and never persisted. `player_sessions.token_hash` holds
 * `SHA-256(pepper + token)`; the pepper means a leaked hash alone (without
 * the deployment's secret) cannot be used to forge a session.
 */

import { createHash, randomBytes } from "node:crypto";

export function mintSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionTokenHash(pepper: string, token: string): Buffer {
  return createHash("sha256").update(pepper, "utf8").update(token, "utf8").digest();
}
