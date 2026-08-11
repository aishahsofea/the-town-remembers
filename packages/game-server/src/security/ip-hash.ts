/**
 * Rotating source-IP hashing (`D3-G`).
 *
 * `HMAC-SHA256(HKDF(TTR_IP_HASH_SECRET, "ip-window:v1\n" + floor(epochMs /
 * 86_400_000)), ip)`, the full 32 bytes. The daily window means an old bucket
 * cannot be correlated to a new one after rotation, and it lines up with the
 * 15-minute rate-limit periods without a bucket ever spanning two windows in
 * a way that matters. The raw address is only ever a parameter here — it has
 * no field in any log event and is never itself persisted.
 */

import { createHmac, hkdfSync } from "node:crypto";

const DAY_MS = 86_400_000;
const DERIVED_KEY_BYTES = 32;

function dailyKey(secret: string, windowIndex: number): Buffer {
  const derived = hkdfSync(
    "sha256",
    Buffer.from(secret, "base64url"),
    Buffer.alloc(0),
    `ip-window:v1\n${windowIndex}`,
    DERIVED_KEY_BYTES,
  );
  return Buffer.from(derived);
}

/** `secret` is `SecurityConfig#ipHashSecret` (256 bits of base64url). */
export function hashIp(secret: string, ip: string, now: Date): Buffer {
  const windowIndex = Math.floor(now.getTime() / DAY_MS);
  const key = dailyKey(secret, windowIndex);
  return createHmac("sha256", key).update(ip, "utf8").digest();
}
