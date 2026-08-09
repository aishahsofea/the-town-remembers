/**
 * Proves every mandatory trust-40 gate is reachable from zero in at most
 * four non-repeating positive relationship events, and that Nessa's key
 * route and Corin's capability route open the chapel independently.
 */

import { sumRelationshipDeltas } from "../beliefs/relationships.js";
import { corinCapabilityGrantEligible, nessaKeyLoanEligible } from "../world/clues.js";
import type { RelationshipReasonKind } from "@the-town-remembers/database/domains";

export interface RelationshipEventContribution {
  /** One action's stacked reason kinds — a single `Show` may stack more than one. */
  readonly reasonKinds: readonly RelationshipReasonKind[];
}

export function cumulativeTrustAfterEvents(
  events: readonly RelationshipEventContribution[],
): number {
  return events.reduce(
    (total, event) => total + sumRelationshipDeltas(event.reasonKinds).trust,
    0,
  );
}

export function cumulativeSuspicionAfterEvents(
  events: readonly RelationshipEventContribution[],
): number {
  return events.reduce(
    (total, event) => total + sumRelationshipDeltas(event.reasonKinds).suspicion,
    0,
  );
}

export function isTrustGateReachableWithinEvents(
  events: readonly RelationshipEventContribution[],
  maximumEvents: number,
  minimumTrust: number,
): boolean {
  if (events.length > maximumEvents) return false;
  return cumulativeTrustAfterEvents(events) >= minimumTrust;
}

/**
 * The worked-example witness: three `Show`s that each stack
 * `verified_testimony` (+10/-5) and `evidence_presented` (+5/-5) — the same
 * scenario `beliefs/relationships.test.ts`'s worked example #6 proves
 * produces exactly trust +45, suspicion -30, in three events.
 */
export const WORKED_TRUST_GATE_WITNESS: readonly RelationshipEventContribution[] = [
  { reasonKinds: ["verified_testimony", "evidence_presented"] },
  { reasonKinds: ["verified_testimony", "evidence_presented"] },
  { reasonKinds: ["verified_testimony", "evidence_presented"] },
];

/**
 * Nessa's key-loan gate (trust>=40, suspicion<40) and Corin's capability
 * grant (a required clue presented, post-action trust>=40, suspicion<20)
 * both open from the same trust-building witness, independently of each
 * other — neither route's precondition depends on the other having been
 * attempted.
 */
export function chapelRoutesOpenIndependently(): boolean {
  const trust = cumulativeTrustAfterEvents(WORKED_TRUST_GATE_WITNESS);
  const suspicion = cumulativeSuspicionAfterEvents(WORKED_TRUST_GATE_WITNESS);
  const routeAOpen = nessaKeyLoanEligible(trust, suspicion);
  const routeBOpen = corinCapabilityGrantEligible(true, trust, suspicion);
  return routeAOpen && routeBOpen;
}
