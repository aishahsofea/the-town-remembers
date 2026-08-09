/**
 * Ambient candidate eligibility, priority, and shortlist generation.
 *
 * Uses `content#CONTACT_EDGES` directly for the directed gossip graph (four
 * edges: Mara↔Nessa at 30, Mara↔Corin at 40, Nessa→Mara at 20, Corin→Mara at
 * 20 — no Nessa↔Corin edge, so Mara is a required intermediary).
 */

import type { DisclosureTier } from "../disclosure/tiers.js";
import { compareAmbientCandidates } from "../kernel/ordering.js";
import { RULES_REGISTRY } from "../kernel/version.js";

export const AMBIENT_DO_NOTHING_CHOICE_ID = "do_nothing";

export interface AmbientEligibilityInputs {
  readonly townActive: boolean;
  readonly jobActive: boolean;
  readonly claimDirectlyReferencedInRange: boolean;
  readonly claimSharesCanonicalEntityWithEligibleEventViaTopRecall: boolean;
  readonly speakerBeliefScore: number;
  readonly speakerHasEnabledCoverStory: boolean;
  /** A repeat names its parent transmission; observed/presented claims name a source episode and no parent. */
  readonly hasExactProvenanceSource: boolean;
  readonly directedContactEdgeExists: boolean;
  readonly disclosureTier: DisclosureTier;
  readonly listenerTrustInSpeaker: number;
  readonly proposedHopCount: number;
  readonly isProvenanceChainRevisit: boolean;
  readonly isDuplicateSourceRepeatDelivery: boolean;
}

function isEligibleAmbientDisclosureTier(
  tier: DisclosureTier,
  listenerTrustInSpeaker: number,
  speakerHasEnabledCoverStory: boolean,
): boolean {
  if (tier === "confidential" || tier === "final_truth") return false;
  if (tier === "public") return true;
  if (tier === "cover_story") return speakerHasEnabledCoverStory;
  // guarded — dynamic player-originated claims default here.
  return (
    listenerTrustInSpeaker >= RULES_REGISTRY.disclosureThresholds.guarded.minimumTrust
  );
}

/** The full eligibility checklist Decision 008/010 fix for an ambient candidate. */
export function isAmbientCandidateEligible(inputs: AmbientEligibilityInputs): boolean {
  if (!inputs.townActive || !inputs.jobActive) return false;

  if (
    !inputs.claimDirectlyReferencedInRange &&
    !inputs.claimSharesCanonicalEntityWithEligibleEventViaTopRecall
  ) {
    return false;
  }

  const speakerBelievesEnough =
    inputs.speakerBeliefScore >= RULES_REGISTRY.ambient.speakerBeliefFloor;
  if (!speakerBelievesEnough && !inputs.speakerHasEnabledCoverStory) return false;

  if (!inputs.hasExactProvenanceSource) return false;
  if (!inputs.directedContactEdgeExists) return false;

  if (
    !isEligibleAmbientDisclosureTier(
      inputs.disclosureTier,
      inputs.listenerTrustInSpeaker,
      inputs.speakerHasEnabledCoverStory,
    )
  ) {
    return false;
  }

  if (inputs.proposedHopCount > RULES_REGISTRY.maximumNpcRecipientHop) return false;
  if (inputs.isProvenanceChainRevisit) return false;
  if (inputs.isDuplicateSourceRepeatDelivery) return false;

  return true;
}

// --- Priority ---------------------------------------------------------------------

export interface AmbientPriorityInputs {
  /** `1` only for a direct claim reference, never for the canonical-entity-overlap path. */
  readonly triggeringEventMatch: boolean;
  readonly speakerBeliefScore: number;
  readonly recipientHoldsContradictoryBelief: boolean;
  readonly listenerTrustInSpeaker: number;
  readonly proposedHopCount: number;
}

/**
 * ```text
 * priority = 50*triggeringEventMatch + Math.max(0, speakerBeliefScore)
 *          + 20*recipientHoldsContradictoryBelief
 *          + Math.floor((listenerTrustInSpeaker + 100) / 10)
 *          - 10*proposedHopCount
 * ```
 */
export function computeAmbientPriority(inputs: AmbientPriorityInputs): number {
  const { priorityWeights } = RULES_REGISTRY.ambient;
  return (
    priorityWeights.triggeringEventMatch * (inputs.triggeringEventMatch ? 1 : 0) +
    Math.max(0, inputs.speakerBeliefScore) +
    priorityWeights.recipientHoldsContradictoryBelief *
      (inputs.recipientHoldsContradictoryBelief ? 1 : 0) +
    Math.floor((inputs.listenerTrustInSpeaker + 100) / priorityWeights.trustDivisor) -
    priorityWeights.hopPenaltyPerHop * inputs.proposedHopCount
  );
}

// --- Shortlist ----------------------------------------------------------------------

export interface AmbientShortlistCandidate {
  readonly choiceId: string;
  readonly priority: number;
  readonly normalizedClaimKey: string;
  readonly speakerActorId: string;
  readonly recipientActorId: string;
}

/** Top `AMBIENT_CANDIDATE_SHORTLIST_SIZE` by `compareAmbientCandidates`; `do_nothing` is added separately. */
export function buildAmbientShortlist(
  eligibleCandidates: readonly AmbientShortlistCandidate[],
): readonly AmbientShortlistCandidate[] {
  return eligibleCandidates
    .toSorted(compareAmbientCandidates)
    .slice(0, RULES_REGISTRY.ambientShortlistSize);
}
