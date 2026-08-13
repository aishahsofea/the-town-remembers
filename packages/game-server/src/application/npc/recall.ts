/**
 * Deterministic reranking half of `P4-08` (docs/008 "Episodic recall").
 *
 * This module never touches a `Pool`. Every field on `RecallCandidateInput`
 * is something the caller already has in hand — the two candidate pools from
 * `persistence/recall.ts`, enriched with whatever promise/belief context a
 * future NPC context builder (`P4-09`) loads to classify each episode's
 * `directnessCategory` and its `isCommitmentOrGrievance`/
 * `isInActiveContradiction` booleans. Staying pure is what makes "ranked
 * output matches a hand-computed expectation at each formula boundary" (P4-08
 * acceptance #2) a plain unit test rather than a fixture-heavy integration
 * one, and it keeps this module usable before P4-09's promise/belief reads
 * exist.
 */

import {
  computeRecallScore,
  directnessFor,
  effectiveImportanceFor,
  rankRecallResults,
  selectStructuredAnchors,
  similarityFor,
  vectorCandidatesFor,
  type DirectnessCategory,
  type RecallResult,
} from "@the-town-remembers/rules";

export interface RecallCandidateInput {
  readonly episodeId: string;
  readonly occurredAt: Date;
  /** Raw stored `episodes.importance`; the active-contradiction floor is applied here, never at the source. */
  readonly storedImportance: number;
  readonly directnessCategory: DirectnessCategory;
  readonly isCommitmentOrGrievance: boolean;
  readonly isInActiveContradiction: boolean;
  /** L2 distance from the vector query. Omitted for a structured-anchor-only candidate. */
  readonly distance?: number;
}

export interface RecallProvenance {
  readonly fromVectorSearch: boolean;
  readonly fromStructuredAnchor: boolean;
}

export interface RankedRecallEpisode {
  readonly episodeId: string;
  readonly score: number;
  /** `clamp(1 - distance, 0, 1)`; `0` for an anchor-only candidate or when embedding is unavailable. */
  readonly similarity: number;
  readonly occurredAt: Date;
  readonly provenance: RecallProvenance;
}

export interface RankRecallCandidatesOptions {
  readonly embeddingAvailable: boolean;
  readonly now: Date;
}

function ageHoursFor(occurredAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - occurredAt.getTime()) / (1000 * 60 * 60));
}

interface MergedCandidate {
  readonly input: RecallCandidateInput;
  readonly provenance: RecallProvenance;
}

/**
 * Dedupes the vector and structured-anchor pools by episode id, computes
 * docs/008's six recall-score components for each surviving candidate, and
 * returns the top eight (`RULES_REGISTRY.recall.maximumResults`) ranked by
 * `compareRecallResults` — score descending, then occurrence time
 * descending, then episode id ascending, so exact ties are still a total
 * order.
 *
 * Both pools are capped to their own maximums (`vectorCandidatesFor`,
 * `selectStructuredAnchors`) before merging, matching docs/008's "unions at
 * most 30 vector candidates... at most 10 structured anchors" — a caller
 * that over-fetches never smuggles a larger pool through.
 */
export function rankRecallCandidates(
  vectorCandidates: readonly RecallCandidateInput[],
  structuredAnchors: readonly RecallCandidateInput[],
  options: RankRecallCandidatesOptions,
): readonly RankedRecallEpisode[] {
  const cappedVector = vectorCandidatesFor(
    vectorCandidates,
    options.embeddingAvailable,
  );
  const cappedAnchorIds = new Set(
    selectStructuredAnchors(
      structuredAnchors.map((anchor) => ({
        episodeId: anchor.episodeId,
        occurredAt: anchor.occurredAt,
        importance: anchor.storedImportance,
      })),
    ).map((anchor) => anchor.episodeId),
  );

  const byEpisodeId = new Map<string, MergedCandidate>();
  for (const candidate of cappedVector) {
    byEpisodeId.set(candidate.episodeId, {
      input: candidate,
      provenance: { fromVectorSearch: true, fromStructuredAnchor: false },
    });
  }
  for (const candidate of structuredAnchors) {
    if (!cappedAnchorIds.has(candidate.episodeId)) continue;
    const existing = byEpisodeId.get(candidate.episodeId);
    byEpisodeId.set(candidate.episodeId, {
      input: existing?.input ?? candidate,
      provenance: {
        fromVectorSearch: existing?.provenance.fromVectorSearch ?? false,
        fromStructuredAnchor: true,
      },
    });
  }

  const detailByEpisodeId = new Map<
    string,
    { readonly similarity: number; readonly provenance: RecallProvenance }
  >();
  const results: RecallResult[] = [];
  for (const { input, provenance } of byEpisodeId.values()) {
    const rawCosineSimilarity = input.distance === undefined ? 0 : 1 - input.distance;
    const effectiveImportance = effectiveImportanceFor(
      input.storedImportance,
      input.isInActiveContradiction,
    );
    const score = computeRecallScore({
      cosineSimilarity: rawCosineSimilarity,
      ageHours: ageHoursFor(input.occurredAt, options.now),
      effectiveImportance,
      directness: directnessFor(input.directnessCategory),
      commitmentOrGrievance: input.isCommitmentOrGrievance,
      activeContradiction: input.isInActiveContradiction,
    });
    results.push({ episodeId: input.episodeId, score, occurredAt: input.occurredAt });
    detailByEpisodeId.set(input.episodeId, {
      similarity: similarityFor(rawCosineSimilarity),
      provenance,
    });
  }

  return rankRecallResults(results).map((result) => {
    const detail = detailByEpisodeId.get(result.episodeId)!;
    return {
      episodeId: result.episodeId,
      score: result.score,
      occurredAt: result.occurredAt,
      similarity: detail.similarity,
      provenance: detail.provenance,
    };
  });
}
