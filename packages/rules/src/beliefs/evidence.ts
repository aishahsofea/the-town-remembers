/**
 * Belief evidence weights, testimony formulas, repeat protection,
 * corroboration, mirrors, and source-discredited reversal — Decision 008's
 * "Evidence weights" and "Source independence and repeat protection"
 * sections, implemented exactly.
 *
 * ```text
 * direct observation                         +80
 * physical clue supports / contradicts       +70 / -70   (constant magnitude)
 * player_base  = clamp(35 + ruleFloor(playerTrust / 10), 25, 45)
 * npc_base     = clamp(40 + ruleFloor(listenerTrustInSpeaker / 10), 30, 50)
 * testimony    = Math.max(10, base - 10 * hopCount)
 * corroboration = 15 * Math.min(2, Math.max(0, independentSourceCount - 1))
 * ```
 *
 * The root-speaker identity (not the transmission ID) is the independent
 * source key: one testimony contribution per `(npc, claim,
 * independentSourceActorId)`, matching `belief_evidence`'s real column set.
 */

import type { EvidenceKind } from "@the-town-remembers/database/domains";

import { mirrorWeightFor, type ClaimRelationKind } from "../claims/relations.js";
import { clampToRange, ruleFloor } from "../kernel/numeric.js";
import { RULES_REGISTRY } from "../kernel/version.js";

// --- Weight formulas ---------------------------------------------------------

export function playerTestimonyBase(playerTrust: number): number {
  const { base, trustDivisor, minimum, maximum } =
    RULES_REGISTRY.testimonyFormula.playerBase;
  return clampToRange(base + ruleFloor(playerTrust / trustDivisor), minimum, maximum);
}

export function npcTestimonyBase(listenerTrustInSpeaker: number): number {
  const { base, trustDivisor, minimum, maximum } =
    RULES_REGISTRY.testimonyFormula.npcBase;
  return clampToRange(
    base + ruleFloor(listenerTrustInSpeaker / trustDivisor),
    minimum,
    maximum,
  );
}

/** `Math.max(10, base - 10 * hopCount)`. */
export function testimonyWeight(base: number, hopCount: number): number {
  const { hopPenaltyPerHop, minimumTestimonyWeight } = RULES_REGISTRY.testimonyFormula;
  return Math.max(minimumTestimonyWeight, base - hopPenaltyPerHop * hopCount);
}

/** `15 * Math.min(2, Math.max(0, independentSourceCount - 1))`. */
export function corroborationWeight(independentSourceCount: number): number {
  const { perSourceWeight, maximumAdditionalSources } = RULES_REGISTRY.corroboration;
  return (
    perSourceWeight *
    Math.min(maximumAdditionalSources, Math.max(0, independentSourceCount - 1))
  );
}

export const PHYSICAL_CLUE_MAGNITUDE = RULES_REGISTRY.physicalClueMagnitude;
export const DIRECT_OBSERVATION_WEIGHT = RULES_REGISTRY.directObservationWeight;

// --- Repeat protection --------------------------------------------------------

/**
 * The identity a candidate contribution repeats against, matching
 * `belief_evidence`'s real uniqueness scope per `evidence_kind`:
 * testimony repeats by root speaker, a physical clue repeats by the clue
 * itself, and a direct observation repeats by its source episode.
 */
export interface EvidenceRepeatKey {
  readonly npcId: string;
  readonly claimId: string;
  readonly evidenceKind: EvidenceKind;
  readonly independentSourceActorId?: string | null;
  readonly clueId?: string | null;
  readonly episodeId?: string | null;
  readonly mirrorsEvidenceId?: string | null;
}

function repeatIdentity(key: EvidenceRepeatKey): string | undefined {
  switch (key.evidenceKind) {
    case "player_testimony":
    case "npc_testimony":
      return key.independentSourceActorId
        ? `testimony:${key.npcId}:${key.claimId}:${key.independentSourceActorId}`
        : undefined;
    case "physical_clue":
      return key.clueId ? `clue:${key.npcId}:${key.claimId}:${key.clueId}` : undefined;
    case "direct_observation":
      return key.episodeId
        ? `observation:${key.npcId}:${key.claimId}:${key.episodeId}`
        : undefined;
    case "contradiction":
    case "corroboration":
    case "source_reversal":
      return key.mirrorsEvidenceId
        ? `mirror:${key.npcId}:${key.claimId}:${key.mirrorsEvidenceId}`
        : undefined;
    default:
      return undefined;
  }
}

/**
 * True when `candidate` repeats an existing active contribution: the same
 * source testifying again, a descendant transmission of the same root, a
 * repeated `Show` of the same clue, or a replayed API call — all identified
 * by the same repeat identity rather than by request shape.
 */
export function isRepeatContribution(
  existingActive: readonly EvidenceRepeatKey[],
  candidate: EvidenceRepeatKey,
): boolean {
  const candidateIdentity = repeatIdentity(candidate);
  if (candidateIdentity === undefined) return false;
  return existingActive.some(
    (existing) => repeatIdentity(existing) === candidateIdentity,
  );
}

// --- Corroboration -------------------------------------------------------------

export interface CorroborationAdjustmentPlanEntry {
  readonly npcId: string;
  readonly claimId: string;
  readonly evidenceKind: "corroboration";
  readonly signedWeight: number;
  readonly causalEventId: string;
}

/**
 * Corroboration weight tracks the *current* independent source count. Since
 * `belief_evidence` is append-only, a change in that count — an addition, a
 * reversal, or recrossing a threshold after both — is represented as one
 * incremental row carrying only the delta, never a full recompute.
 */
export function planCorroborationAdjustment(
  npcId: string,
  claimId: string,
  priorIndependentSourceCount: number,
  newIndependentSourceCount: number,
  causalEventId: string,
): CorroborationAdjustmentPlanEntry | undefined {
  const delta =
    corroborationWeight(newIndependentSourceCount) -
    corroborationWeight(priorIndependentSourceCount);
  if (delta === 0) return undefined;
  return {
    npcId,
    claimId,
    evidenceKind: "corroboration",
    signedWeight: delta,
    causalEventId,
  };
}

// --- Source-discredited reversal -----------------------------------------------

export interface ActiveContribution {
  readonly evidenceId: string;
  readonly npcId: string;
  readonly claimId: string;
  readonly signedWeight: number;
  readonly independentSourceActorId: string | null;
}

export interface ReversalPlanEntry {
  readonly npcId: string;
  readonly claimId: string;
  readonly evidenceKind: "source_reversal";
  readonly signedWeight: number;
  readonly reversesEvidenceId: string;
  readonly causalEventId: string;
}

/**
 * `source_discredited` appends one exact opposite row per active
 * contribution from the discredited source — scoped to the one listening NPC
 * and the one claim the lie was caught on; knowledge does not teleport to
 * other NPCs, and an unrelated claim from the same source is untouched.
 * Original rows are append-only and a row is reversed at most once, so the
 * caller passes the set of evidence IDs already reversed and this function
 * skips them rather than reversing twice.
 */
export function planSourceDiscreditedReversal(
  activeContributions: readonly ActiveContribution[],
  discreditedSourceActorId: string,
  discreditedNpcId: string,
  discreditedClaimId: string,
  alreadyReversedEvidenceIds: ReadonlySet<string>,
  causalEventId: string,
): readonly ReversalPlanEntry[] {
  return activeContributions
    .filter(
      (contribution) =>
        contribution.independentSourceActorId === discreditedSourceActorId &&
        contribution.npcId === discreditedNpcId &&
        contribution.claimId === discreditedClaimId &&
        !alreadyReversedEvidenceIds.has(contribution.evidenceId),
    )
    .map((contribution) => ({
      npcId: contribution.npcId,
      claimId: contribution.claimId,
      evidenceKind: "source_reversal" as const,
      signedWeight: -contribution.signedWeight,
      reversesEvidenceId: contribution.evidenceId,
      causalEventId,
    }))
    .toSorted((left, right) =>
      left.reversesEvidenceId.localeCompare(right.reversesEvidenceId),
    );
}

// --- Mirrors --------------------------------------------------------------------

export interface RelatedClaim {
  readonly claimId: string;
  readonly relationKind: ClaimRelationKind;
}

export interface MirrorPlanEntry {
  readonly npcId: string;
  readonly claimId: string;
  readonly evidenceKind: "contradiction";
  readonly signedWeight: number;
  readonly mirrorsEvidenceId: string;
  readonly causalEventId: string;
}

/**
 * When a primary contribution lands on a claim that has a relation to one or
 * more other claims, each related claim receives exactly one mirror row —
 * never mirrored again from the mirror itself (one level deep). Physical-clue
 * mirrors coalesce at `(npc, clue, claim)`: calling this once per primary
 * contribution and letting the caller's own repeat protection
 * (`isRepeatContribution`'s `mirrorsEvidenceId` scope) reject a second call
 * for the same primary is what keeps that coalescing true.
 */
export function planImmediateContradictionMirrors(
  npcId: string,
  primaryEvidenceId: string,
  primarySignedWeight: number,
  relatedClaims: readonly RelatedClaim[],
  causalEventId: string,
): readonly MirrorPlanEntry[] {
  return relatedClaims
    .map((related) => ({
      npcId,
      claimId: related.claimId,
      evidenceKind: "contradiction" as const,
      signedWeight: mirrorWeightFor(related.relationKind, primarySignedWeight),
      mirrorsEvidenceId: primaryEvidenceId,
      causalEventId,
    }))
    .toSorted((left, right) => left.claimId.localeCompare(right.claimId));
}
