/**
 * `ApprovedDisclosureBundle`: the exact `trusted_context` fields Decision 010
 * names for `npc_dialogue_v1`. It receives no database client and no general
 * objective-state row — only the narrow deterministic inputs each field
 * needs, already resolved by the caller.
 */

import { isSelectedBelief } from "../beliefs/labels.js";
import {
  meetsDisclosureTier,
  type DisclosureGateInputs,
  type DisclosureTier,
} from "./tiers.js";

export class DisclosureBundleLimitError extends Error {
  constructor(field: string, limit: number, actual: number) {
    super(`${field} may name at most ${limit} IDs, got ${actual}.`);
    this.name = "DisclosureBundleLimitError";
  }
}

const MAXIMUM_REQUIRED_DISCLOSURES = 4;
const MAXIMUM_REQUIRED_OUTCOMES = 3;

export type ClaimStance = "believed" | "hearsay";

export interface DisclosureCandidateInput {
  readonly claimId: string;
  /**
   * Direct observations and reported speech may be recounted as such even
   * when not currently believed, once the tier passes — only an ordinary
   * asserted claim needs the belief/contestation gate.
   */
  readonly requiresBeliefGate: boolean;
  readonly stance: ClaimStance;
  readonly sourceEpisodeId: string | null;
  readonly parentTransmissionId: string | null;
  readonly tier: DisclosureTier;
  readonly gateInputs: DisclosureGateInputs;
  readonly beliefScore: number;
  readonly contradictingClaimScores: readonly number[];
  readonly permittedEntityIds: readonly string[];
}

export interface ApprovedDisclosure {
  readonly claimId: string;
  readonly stance: ClaimStance;
  readonly sourceEpisodeId: string | null;
  readonly parentTransmissionId: string | null;
  readonly tier: DisclosureTier;
  readonly permittedEntityIds: readonly string[];
}

export interface ApprovedOutcome {
  readonly outcomeId: string;
}

export interface ApprovedEpisodeSummary {
  readonly episodeId: string;
  /** Spoiler-safe only: never the raw episode summary an NPC's own memory holds. */
  readonly spoilerSafeSummary: string;
}

export interface ApprovedDisclosureBundle {
  readonly approvedDisclosures: readonly ApprovedDisclosure[];
  readonly requiredDisclosureIds: readonly string[];
  readonly approvedOutcomes: readonly ApprovedOutcome[];
  readonly requiredOutcomeIds: readonly string[];
  readonly approvedEpisodes: readonly ApprovedEpisodeSummary[];
}

function passesDisclosureGates(candidate: DisclosureCandidateInput): boolean {
  if (!meetsDisclosureTier(candidate.tier, candidate.gateInputs)) return false;
  if (!candidate.requiresBeliefGate) return true;
  return isSelectedBelief(candidate.beliefScore, candidate.contradictingClaimScores);
}

export function buildApprovedDisclosureBundle(
  candidates: readonly DisclosureCandidateInput[],
  requiredDisclosureIds: readonly string[],
  approvedOutcomes: readonly ApprovedOutcome[],
  requiredOutcomeIds: readonly string[],
  approvedEpisodes: readonly ApprovedEpisodeSummary[],
): ApprovedDisclosureBundle {
  if (requiredDisclosureIds.length > MAXIMUM_REQUIRED_DISCLOSURES) {
    throw new DisclosureBundleLimitError(
      "requiredDisclosureIds",
      MAXIMUM_REQUIRED_DISCLOSURES,
      requiredDisclosureIds.length,
    );
  }
  if (requiredOutcomeIds.length > MAXIMUM_REQUIRED_OUTCOMES) {
    throw new DisclosureBundleLimitError(
      "requiredOutcomeIds",
      MAXIMUM_REQUIRED_OUTCOMES,
      requiredOutcomeIds.length,
    );
  }

  const approvedDisclosures = candidates
    .filter(passesDisclosureGates)
    .map((candidate) => ({
      claimId: candidate.claimId,
      stance: candidate.stance,
      sourceEpisodeId: candidate.sourceEpisodeId,
      parentTransmissionId: candidate.parentTransmissionId,
      tier: candidate.tier,
      permittedEntityIds: candidate.permittedEntityIds,
    }));

  return {
    approvedDisclosures,
    requiredDisclosureIds,
    approvedOutcomes,
    requiredOutcomeIds,
    approvedEpisodes,
  };
}
