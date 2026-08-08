/**
 * Deterministic episodic recall ranking, exactly per Decision 008:
 *
 * ```text
 * similarity = clamp(cosineSimilarity, 0, 1)
 * recency    = 2 ** (-ageHours / 168)
 * importance = effectiveImportance / 100
 * score = 0.45*similarity + 0.15*recency + 0.15*importance
 *       + 0.10*directness + 0.10*commitmentOrGrievance + 0.05*activeContradiction
 * ```
 */

import { compareRecallAnchors, compareRecallResults } from "../kernel/ordering.js";
import type { RecallAnchorCandidate } from "../kernel/ordering.js";
import { clampToRange } from "../kernel/numeric.js";
import { RULES_REGISTRY } from "../kernel/version.js";

export function similarityFor(cosineSimilarity: number): number {
  return clampToRange(cosineSimilarity, 0, 1);
}

export function recencyFor(ageHours: number): number {
  return 2 ** (-ageHours / RULES_REGISTRY.recall.recencyHalfLifeHours);
}

export function importanceComponentFor(effectiveImportanceValue: number): number {
  return effectiveImportanceValue / 100;
}

export interface RecallScoreInputs {
  readonly cosineSimilarity: number;
  readonly ageHours: number;
  readonly effectiveImportance: number;
  readonly directness: number;
  readonly commitmentOrGrievance: boolean;
  readonly activeContradiction: boolean;
}

export function computeRecallScore(inputs: RecallScoreInputs): number {
  const { weights } = RULES_REGISTRY.recall;
  return (
    weights.similarity * similarityFor(inputs.cosineSimilarity) +
    weights.recency * recencyFor(inputs.ageHours) +
    weights.importance * importanceComponentFor(inputs.effectiveImportance) +
    weights.directness * inputs.directness +
    weights.commitmentOrGrievance * (inputs.commitmentOrGrievance ? 1 : 0) +
    weights.activeContradiction * (inputs.activeContradiction ? 1 : 0)
  );
}

// --- Importance-minimum table (nine rows) --------------------------------------

export type EpisodeImportanceCategory =
  | "direct_observation"
  | "hop0_heard_testimony"
  | "hop1_heard_testimony"
  | "hop2_or_3_heard_testimony"
  | "ordinary_interaction"
  | "fulfilled_promise"
  | "unique_item_transfer"
  | "broken_promise"
  | "established_lie";

export function importanceMinimumFor(category: EpisodeImportanceCategory): number {
  const minimums = RULES_REGISTRY.recall.importanceMinimums;
  switch (category) {
    case "direct_observation":
      return minimums.directObservation;
    case "hop0_heard_testimony":
      return minimums.hop0HeardTestimony;
    case "hop1_heard_testimony":
      return minimums.hop1;
    case "hop2_or_3_heard_testimony":
    case "ordinary_interaction":
      return minimums.hop2Or3OrOrdinaryInteraction;
    case "fulfilled_promise":
    case "unique_item_transfer":
      return minimums.fulfilledPromiseOrUniqueItemTransfer;
    case "broken_promise":
    case "established_lie":
      return minimums.brokenPromiseOrEstablishedLie;
  }
}

/**
 * A non-persisted floor of `80` applies while an episode's claim is in an
 * active contradiction — it never lowers a naturally higher stored
 * importance, and it is never written back to the row.
 */
export function effectiveImportanceFor(
  storedImportance: number,
  isInActiveContradiction: boolean,
): number {
  if (!isInActiveContradiction) return storedImportance;
  return Math.max(
    storedImportance,
    RULES_REGISTRY.recall.activeContradictionEffectiveImportanceFloor,
  );
}

// --- Directness -----------------------------------------------------------------

export type DirectnessCategory =
  | "direct_observation_or_item_or_promise_or_consequence"
  | "hop0_original_testimony"
  | "hop1_plus_hearsay"
  | "ordinary_interaction_without_claim";

export function directnessFor(category: DirectnessCategory): number {
  const weights = RULES_REGISTRY.recall.directnessWeights;
  switch (category) {
    case "direct_observation_or_item_or_promise_or_consequence":
      return weights.directObservationOrItemOrPromiseOrConsequence;
    case "hop0_original_testimony":
      return weights.hop0OriginalTestimony;
    case "hop1_plus_hearsay":
      return weights.hop1PlusHearsay;
    case "ordinary_interaction_without_claim":
      return weights.ordinaryInteractionWithoutClaim;
  }
}

// --- Active contradiction (reuses beliefs/labels.ts's contestation floor) -------

/**
 * An episode's claim is "in an active contradiction" only when *both* it and
 * the best contradicting claim independently clear the same `20` floor
 * `beliefs/labels.ts#isSelectedBelief` uses — not merely that one outscores
 * the other.
 */
export function isActiveContradiction(
  claimScore: number,
  bestContradictingScore: number,
): boolean {
  const { minimumScore } = RULES_REGISTRY.selectedBelief;
  return claimScore >= minimumScore && bestContradictingScore >= minimumScore;
}

// --- Candidate pool and embedding-failure fallback ------------------------------

/**
 * When embedding is unavailable, similarity is `0` and only structured
 * anchors are used — retrieval failure must never widen authorization by
 * substituting a permissive default.
 */
export function vectorCandidatesFor<T>(
  vectorCandidates: readonly T[],
  embeddingAvailable: boolean,
): readonly T[] {
  if (!embeddingAvailable) return [];
  return vectorCandidates.slice(
    0,
    RULES_REGISTRY.recall.candidatePool.maximumVectorCandidates,
  );
}

export function selectStructuredAnchors(
  anchors: readonly RecallAnchorCandidate[],
): readonly RecallAnchorCandidate[] {
  return anchors
    .toSorted(compareRecallAnchors)
    .slice(0, RULES_REGISTRY.recall.candidatePool.maximumStructuredAnchors);
}

// --- Final ranking ----------------------------------------------------------------

export interface RecallResult {
  readonly score: number;
  readonly occurredAt: Date;
  readonly episodeId: string;
}

export function rankRecallResults(
  results: readonly RecallResult[],
): readonly RecallResult[] {
  return results
    .toSorted(compareRecallResults)
    .slice(0, RULES_REGISTRY.recall.maximumResults);
}
