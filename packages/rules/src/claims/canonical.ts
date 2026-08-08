/**
 * Canonical claim identity: a thin wrapper over `content/claim-key.ts`'s
 * frozen `claim-key:v1` encoder, never a second encoder.
 *
 * "Fail closed on an unknown key version" means: a claim row whose stored
 * `normalized_key` does not equal a fresh recomputation is corrupt data —
 * denied, never silently trusted. Because `claimKeyV1` already routes
 * through `domainSeparatedPreimage`, which asserts the domain string's
 * format, a malformed domain already throws there; this module's own job is
 * the recomputation-equality check.
 */

import { claimKeyV1, type ClaimTuple } from "@the-town-remembers/content";

export function canonicalizeClaim(tuple: ClaimTuple): string {
  return claimKeyV1(tuple);
}

export class CorruptClaimKeyError extends Error {
  readonly reasonCode = "CORRUPT_CLAIM_KEY" as const;
  readonly expectedKey: string;
  readonly storedKey: string;

  constructor(expectedKey: string, storedKey: string) {
    super(
      `Stored normalized_key "${storedKey}" does not match the recomputed ` +
        `claim-key:v1 value "${expectedKey}".`,
    );
    this.name = "CorruptClaimKeyError";
    this.expectedKey = expectedKey;
    this.storedKey = storedKey;
  }
}

/**
 * Recomputes a claim's canonical key from its stored tuple and compares it
 * against the key the row was stored under. A mismatch means the row was
 * corrupted (by a bug, a manual edit, or a future encoding change applied
 * without a version bump) and must be denied rather than trusted.
 */
export function assertStoredClaimKeyIsValid(
  tuple: ClaimTuple,
  storedNormalizedKey: string,
): void {
  const expected = canonicalizeClaim(tuple);
  if (expected !== storedNormalizedKey) {
    throw new CorruptClaimKeyError(expected, storedNormalizedKey);
  }
}
