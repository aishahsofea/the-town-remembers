/**
 * Relationship changes, stance, and grievances — Decision 008's six-reason
 * delta table, stance precedence, stacking, exclusivity, and repeat-key
 * scoping, implemented exactly.
 */

import type { RelationshipReasonKind } from "@the-town-remembers/database/domains";

import { RULES_REGISTRY } from "../kernel/version.js";

export interface RelationshipDelta {
  readonly trust: number;
  readonly suspicion: number;
}

export function relationshipDeltaFor(
  reasonKind: RelationshipReasonKind,
): RelationshipDelta {
  return RULES_REGISTRY.relationshipDeltas[reasonKind];
}

const ZERO_DELTA: RelationshipDelta = { trust: 0, suspicion: 0 };

/** Sums the deltas for every reason a single action produced (stacking). */
export function sumRelationshipDeltas(
  reasonKinds: readonly RelationshipReasonKind[],
): RelationshipDelta {
  return reasonKinds.reduce((total, reasonKind) => {
    const delta = relationshipDeltaFor(reasonKind);
    return {
      trust: total.trust + delta.trust,
      suspicion: total.suspicion + delta.suspicion,
    };
  }, ZERO_DELTA);
}

export type RelationshipStance = "suspicious" | "trusting" | "wary" | "neutral";

/**
 * Suspicion is checked unconditionally first: a highly trusted NPC who has
 * just become highly suspicious of the player is `suspicious`, not
 * `trusting`.
 */
export function stanceFor(trust: number, suspicion: number): RelationshipStance {
  const { suspicionSuspicious, trustTrusting, trustWary } =
    RULES_REGISTRY.stanceThresholds;
  if (suspicion >= suspicionSuspicious) return "suspicious";
  if (trust >= trustTrusting) return "trusting";
  if (trust <= trustWary) return "wary";
  return "neutral";
}

export interface ShowRelationshipInputs {
  readonly verifiesEarlierTestimony: boolean;
  readonly presentsRelevantClue: boolean;
  readonly establishesLie: boolean;
}

/**
 * A `Show` that both verifies earlier testimony and presents a relevant clue
 * stacks both positive rows. A clue that establishes a lie in that same
 * `Show` applies only `lie_established` — the two positive reasons are
 * mutually exclusive with it, never additionally applied.
 */
export function applicableReasonKindsForShow(
  input: ShowRelationshipInputs,
): readonly RelationshipReasonKind[] {
  if (input.establishesLie) return ["lie_established"];

  const reasons: RelationshipReasonKind[] = [];
  if (input.verifiesEarlierTestimony) reasons.push("verified_testimony");
  if (input.presentsRelevantClue) reasons.push("evidence_presented");
  return reasons;
}

// --- Repeat-key scoping --------------------------------------------------------

export interface RelationshipContributionKey {
  readonly reasonKind: RelationshipReasonKind;
  readonly npcId: string;
  readonly playerId: string;
  readonly claimId?: string | null;
  readonly clueId?: string | null;
  readonly requestItemKey?: string | null;
  readonly promiseId?: string | null;
}

function repeatIdentity(key: RelationshipContributionKey): string | undefined {
  switch (key.reasonKind) {
    case "verified_testimony":
    case "lie_established":
      return key.claimId
        ? `${key.reasonKind}:${key.npcId}:${key.playerId}:${key.claimId}`
        : undefined;
    case "evidence_presented":
      return key.clueId
        ? `${key.reasonKind}:${key.npcId}:${key.playerId}:${key.clueId}`
        : undefined;
    case "requested_item_given":
      return key.requestItemKey
        ? `${key.reasonKind}:${key.npcId}:${key.playerId}:${key.requestItemKey}`
        : undefined;
    case "promise_fulfilled":
    case "promise_broken":
      // A promise's terminal state is itself the guard: once fulfilled or
      // broken it never resolves a second time, so the promise ID alone
      // scopes the repeat key.
      return key.promiseId ? `${key.reasonKind}:${key.promiseId}` : undefined;
    default:
      return undefined;
  }
}

export function isRepeatRelationshipContribution(
  existingActive: readonly RelationshipContributionKey[],
  candidate: RelationshipContributionKey,
): boolean {
  const identity = repeatIdentity(candidate);
  if (identity === undefined) return false;
  return existingActive.some((existing) => repeatIdentity(existing) === identity);
}

// --- Grievances ------------------------------------------------------------------

export type GrievanceKind = "promise_broken" | "lie_established";

export function isGrievanceReason(
  reasonKind: RelationshipReasonKind,
): reasonKind is GrievanceKind {
  return reasonKind === "promise_broken" || reasonKind === "lie_established";
}

export interface GrievanceRecord {
  readonly npcId: string;
  readonly playerId: string;
  readonly kind: GrievanceKind;
}

/**
 * Grievances never expire: there is no time or trust-recovery parameter
 * here by design, because a later trust recovery must not silently clear
 * one. Callers that need "ever broken a promise to this NPC" simply keep
 * every grievance row forever and ask this function whether one exists.
 */
export function hasGrievance(
  grievances: readonly GrievanceRecord[],
  npcId: string,
  playerId: string,
  kind?: GrievanceKind,
): boolean {
  return grievances.some(
    (grievance) =>
      grievance.npcId === npcId &&
      grievance.playerId === playerId &&
      (kind === undefined || grievance.kind === kind),
  );
}
