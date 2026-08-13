/**
 * Invite token derivation (`D3-D`).
 *
 * `base64url(HMAC-SHA256(key_v, "invite:v1\n" + creationIdempotencyKey))`, 43
 * characters. The plaintext token is never stored: `towns.invite_token_hash`
 * holds `SHA-256(token)`, and the token itself is reconstructed on demand from
 * the recorded key version plus the creation request's own idempotency key —
 * both of which are durable, so a replay of the same creation request
 * reproduces the identical `inviteUrl` even after key rotation.
 */

import { createHash, createHmac } from "node:crypto";

import type {
  InviteSigningKey,
  SecurityConfig,
} from "@the-town-remembers/runtime-config/security";

import { AppError } from "../http/errors.js";

const INVITE_DOMAIN_PREFIX = "invite:v1\n";

/** The first configured key is always the active one (`D3-C`). */
export function activeSigningKey(config: SecurityConfig): InviteSigningKey {
  const active = config.inviteSigningKeys[0];
  if (!active) {
    throw new AppError({
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal error",
      detail: "No invite signing key is configured.",
    });
  }
  return active;
}

/**
 * Looks up a specific version so a creation record from an older rotation can
 * still be replayed. Never reached in practice unless an operator removes a
 * version a live record still names — an internal misconfiguration, not a
 * client error.
 */
export function signingKeyForVersion(
  config: SecurityConfig,
  version: string,
): InviteSigningKey {
  const found = config.inviteSigningKeys.find((key) => key.version === version);
  if (!found) {
    throw new AppError({
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal error",
      detail: "The recorded invite signing key version is no longer configured.",
    });
  }
  return found;
}

export function deriveInviteToken(
  key: InviteSigningKey,
  creationIdempotencyKey: string,
): string {
  return createHmac("sha256", key.key)
    .update(INVITE_DOMAIN_PREFIX + creationIdempotencyKey, "utf8")
    .digest("base64url");
}

export function inviteTokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function inviteUrl(appOrigin: string, token: string): string {
  return `${appOrigin}/join/${token}`;
}
