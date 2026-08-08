/**
 * The frozen `claim-key:v1` encoder.
 *
 * A claim's identity is the proposition it states, not the words a player used
 * or the UUID a town happened to generate. Two players who say "Corin moved the
 * bell" in different sentences must reach one row, and the seeded version of
 * that proposition must be the same row again.
 *
 * The key is therefore built from frozen authored entity keys and the accepted
 * tuple order — never from display copy, and never from a generated ID. Because
 * `claims(town_id, normalized_key)` is unique and the town supplies tenant
 * identity, the key itself carries neither `town_id` nor `content_version`.
 *
 * Decision 005 defines `claim-key:v1` as the representation itself, not its
 * hash, which is why this returns the pre-image rather than a digest.
 *
 * Changing this encoding requires a new claim-key version and an explicit
 * compatibility path. Existing towns never reinterpret stored keys.
 */

import { domainSeparatedPreimage } from "@the-town-remembers/serialization";

export const CLAIM_KEY_DOMAIN = "claim-key:v1";

export interface ClaimTuple {
  readonly subjectEntityType: string;
  readonly subjectEntityKey: string;
  readonly predicate: string;
  readonly objectEntityType: string;
  readonly objectEntityKey: string;
  readonly polarity: string;
  readonly contextKey: string;
}

export function claimKeyV1(tuple: ClaimTuple): string {
  return domainSeparatedPreimage(CLAIM_KEY_DOMAIN, [
    tuple.subjectEntityType,
    tuple.subjectEntityKey,
    tuple.predicate,
    tuple.objectEntityType,
    tuple.objectEntityKey,
    tuple.polarity,
    tuple.contextKey,
  ]);
}
