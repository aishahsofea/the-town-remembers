/**
 * The five information-boundary tiers Decision 008 fixes, from least to most
 * restricted context:
 *
 * | Tier | Gate |
 * |---|---|
 * | `public` | relevant to the request |
 * | `guarded` | (`trust >= 20 AND suspicion < 40`) OR a relevant verified clue presented this action |
 * | `confidential` | `trust >= 40 AND suspicion < 20` AND no broken promise to this NPC ever |
 * | `cover_story` | Corin's authored cover story AND the confrontation gate is still closed |
 * | `final_truth` | confrontation gate open |
 *
 * Passing a tier only permits *bundle membership*. An ordinary claim still
 * needs `beliefs/labels.ts#isSelectedBelief` independently — both checks
 * must pass, and neither substitutes for the other.
 */

import { RULES_REGISTRY } from "../kernel/version.js";

export type DisclosureTier =
  "public" | "guarded" | "confidential" | "cover_story" | "final_truth";

export interface DisclosureGateInputs {
  readonly isRelevantToRequest: boolean;
  readonly trust: number;
  readonly suspicion: number;
  readonly verifiedCluePresentedThisAction: boolean;
  readonly everBrokenPromiseToThisNpc: boolean;
  readonly isCorinsCoverStoryClaim: boolean;
  readonly confrontationGateOpen: boolean;
}

export function meetsDisclosureTier(
  tier: DisclosureTier,
  inputs: DisclosureGateInputs,
): boolean {
  const { guarded, confidential } = RULES_REGISTRY.disclosureThresholds;
  switch (tier) {
    case "public":
      return inputs.isRelevantToRequest;
    case "guarded":
      return (
        (inputs.trust >= guarded.minimumTrust &&
          inputs.suspicion < guarded.maximumSuspicionExclusive) ||
        inputs.verifiedCluePresentedThisAction
      );
    case "confidential":
      return (
        inputs.trust >= confidential.minimumTrust &&
        inputs.suspicion < confidential.maximumSuspicionExclusive &&
        !inputs.everBrokenPromiseToThisNpc
      );
    case "cover_story":
      return inputs.isCorinsCoverStoryClaim && !inputs.confrontationGateOpen;
    case "final_truth":
      return inputs.confrontationGateOpen;
  }
}
