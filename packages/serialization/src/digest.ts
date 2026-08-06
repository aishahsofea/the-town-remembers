/**
 * Hashing primitives for request fingerprints, claim keys, and player-view
 * versions.
 *
 * Every accepted hash in Decision 005 and Decision 006 is domain separated,
 * for example `player-view:v1` or `claim-key:v1`. This module never chooses a
 * separator: the caller supplies it, so a new hashed concept cannot silently
 * reuse another concept's pre-image space.
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json.js";

export class DomainSeparatorError extends Error {
  constructor(detail: string) {
    super(`Invalid domain separator: ${detail}`);
    this.name = "DomainSeparatorError";
  }
}

/**
 * Separators are the literal prefixes written in the accepted contracts, such
 * as `player-view:v1`. A separator containing the newline delimiter would make
 * two different pre-images collide, so it is rejected.
 */
const DOMAIN_SEPARATOR_PATTERN = /^[a-z][a-z0-9-]*:v[0-9]+$/;

function assertDomainSeparator(domain: string): void {
  if (!DOMAIN_SEPARATOR_PATTERN.test(domain)) {
    throw new DomainSeparatorError(
      "expected a versioned lowercase name such as player-view:v1",
    );
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** SHA-256 of UTF-8 text or raw bytes, encoded as unpadded base64url. */
export function sha256Base64Url(input: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(typeof input === "string" ? Buffer.from(input, "utf8") : input);
  return hash.digest("base64url");
}

/**
 * Builds the exact pre-image the accepted contracts hash:
 * `domain + "\n" + canonicalJson(payload)`.
 *
 * Exported separately from {@link domainSeparatedDigest} because Decision 005
 * defines `claim-key:v1` as the representation itself, not only its hash.
 */
export function domainSeparatedPreimage(domain: string, payload: unknown): string {
  assertDomainSeparator(domain);
  return `${domain}\n${canonicalJson(payload)}`;
}

/** `base64url(SHA-256(domain + "\n" + canonicalJson(payload)))`. */
export function domainSeparatedDigest(domain: string, payload: unknown): string {
  return sha256Base64Url(domainSeparatedPreimage(domain, payload));
}

/**
 * base64url of UTF-8 text, used by opaque encodings that are decoded rather
 * than compared, such as the `promise-offer:v1` offer identifier.
 */
export function base64UrlUtf8(text: string): string {
  return toBase64Url(Buffer.from(text, "utf8"));
}
