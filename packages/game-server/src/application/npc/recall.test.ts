import { describe, expect, it } from "vitest";

import { rankRecallCandidates, type RecallCandidateInput } from "./recall.js";

const NOW = new Date("2026-01-08T00:00:00Z");

function candidate(
  episodeId: string,
  overrides: Partial<Omit<RecallCandidateInput, "episodeId">> = {},
): RecallCandidateInput {
  return {
    episodeId,
    occurredAt: NOW,
    storedImportance: 50,
    directnessCategory: "direct_observation_or_item_or_promise_or_consequence",
    isCommitmentOrGrievance: false,
    isInActiveContradiction: false,
    ...overrides,
  };
}

describe("rankRecallCandidates", () => {
  it("matches a hand-computed score at a formula boundary", () => {
    const oneHalfLifeAgo = new Date(NOW.getTime() - 168 * 60 * 60 * 1000);
    const results = rankRecallCandidates(
      [
        candidate("episode-1", {
          distance: 0.2, // similarity = 1 - 0.2 = 0.8
          occurredAt: oneHalfLifeAgo, // recency = 2^(-168/168) = 0.5
          storedImportance: 60, // importance component = 0.6
          directnessCategory: "direct_observation_or_item_or_promise_or_consequence", // 1.0
          isCommitmentOrGrievance: true, // 1.0
          isInActiveContradiction: false, // 0.0
        }),
      ],
      [],
      { embeddingAvailable: true, now: NOW },
    );

    // 0.45*0.8 + 0.15*0.5 + 0.15*0.6 + 0.10*1.0 + 0.10*1.0 + 0.05*0.0 = 0.725
    expect(results).toHaveLength(1);
    expect(results[0]!.similarity).toBeCloseTo(0.8, 10);
    expect(results[0]!.score).toBeCloseTo(0.725, 10);
  });

  it("clamps similarity to [0, 1] outside the unit range", () => {
    const results = rankRecallCandidates(
      [
        candidate("beyond-one", { distance: -0.5 }), // 1 - (-0.5) = 1.5 -> clamp 1
        candidate("beyond-zero", { distance: 1.5 }), // 1 - 1.5 = -0.5 -> clamp 0
      ],
      [],
      { embeddingAvailable: true, now: NOW },
    );

    const byId = new Map(results.map((result) => [result.episodeId, result]));
    expect(byId.get("beyond-one")!.similarity).toBe(1);
    expect(byId.get("beyond-zero")!.similarity).toBe(0);
  });

  it("breaks an exact score tie by occurred_at then episode id, per compareRecallResults", () => {
    const shared = {
      distance: 0.3,
      occurredAt: NOW,
      storedImportance: 70,
      directnessCategory: "hop0_original_testimony" as const,
      isCommitmentOrGrievance: false,
      isInActiveContradiction: false,
    };
    const results = rankRecallCandidates(
      [candidate("episode-b", shared), candidate("episode-a", shared)],
      [],
      { embeddingAvailable: true, now: NOW },
    );

    expect(results[0]!.score).toBe(results[1]!.score);
    expect(results.map((result) => result.episodeId)).toStrictEqual([
      "episode-a",
      "episode-b",
    ]);
  });

  it("uses only anchors, at similarity 0, when embedding is unavailable", () => {
    const results = rankRecallCandidates(
      [candidate("vector-only", { distance: 0 })],
      [candidate("anchor-only", { storedImportance: 90 })],
      { embeddingAvailable: false, now: NOW },
    );

    expect(results.map((result) => result.episodeId)).toStrictEqual(["anchor-only"]);
    expect(results[0]!.similarity).toBe(0);
  });

  it("returns an empty set when there are no anchors and no embedding", () => {
    const results = rankRecallCandidates([], [], {
      embeddingAvailable: false,
      now: NOW,
    });
    expect(results).toStrictEqual([]);
  });

  it("returns an empty set for two empty pools even when embedding is available", () => {
    const results = rankRecallCandidates([], [], {
      embeddingAvailable: true,
      now: NOW,
    });
    expect(results).toStrictEqual([]);
  });

  it("never produces more than 8 results from 30 vector candidates plus 10 anchors", () => {
    const vectorCandidates = Array.from({ length: 30 }, (_, index) =>
      candidate(`vector-${index}`, { distance: index / 100 }),
    );
    const anchors = Array.from({ length: 10 }, (_, index) =>
      candidate(`anchor-${index}`, { storedImportance: 50 + index }),
    );

    const results = rankRecallCandidates(vectorCandidates, anchors, {
      embeddingAvailable: true,
      now: NOW,
    });
    expect(results).toHaveLength(8);
  });

  it("drops a vector candidate beyond the 30-candidate pool cap even when it would otherwise score highest", () => {
    const filler = Array.from({ length: 30 }, (_, index) =>
      candidate(`filler-${index}`, { distance: 0.99 }),
    );
    // Placed 31st: best possible similarity, but vectorCandidatesFor only
    // keeps the pool's first 30 entries (it trusts the caller's own
    // nearest-first ordering rather than re-sorting), so this must be
    // dropped before scoring, regardless of how good its score would be.
    const wouldBeBest = candidate("best-but-31st", { distance: 0 });

    const results = rankRecallCandidates([...filler, wouldBeBest], [], {
      embeddingAvailable: true,
      now: NOW,
    });

    expect(results.map((result) => result.episodeId)).not.toContain("best-but-31st");
  });

  it("drops an anchor beyond the 10-anchor pool cap by ascending importance", () => {
    // compareRecallAnchors ranks by importance descending first, so the
    // lowest of 11 distinct importances is unconditionally rank 11 and
    // dropped by selectStructuredAnchors, independent of anything else.
    const anchors = Array.from({ length: 11 }, (_, index) =>
      candidate(`anchor-${index}`, { storedImportance: 100 - index }),
    );

    const results = rankRecallCandidates([], anchors, {
      embeddingAvailable: true,
      now: NOW,
    });

    expect(results.map((result) => result.episodeId)).not.toContain("anchor-10");
  });

  it("dedupes an episode present in both pools into a single result with combined provenance", () => {
    const results = rankRecallCandidates(
      [candidate("shared", { distance: 0.1, storedImportance: 40 })],
      [candidate("shared", { storedImportance: 90 })],
      { embeddingAvailable: true, now: NOW },
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.provenance).toStrictEqual({
      fromVectorSearch: true,
      fromStructuredAnchor: true,
    });
    // The vector-side input wins when a candidate is present in both pools.
    expect(results[0]!.similarity).toBeCloseTo(0.9, 10);
  });

  it("tags vector-only and anchor-only provenance correctly", () => {
    const results = rankRecallCandidates(
      [candidate("vector-only", { distance: 0.1 })],
      [candidate("anchor-only")],
      { embeddingAvailable: true, now: NOW },
    );
    const byId = new Map(results.map((result) => [result.episodeId, result]));

    expect(byId.get("vector-only")!.provenance).toStrictEqual({
      fromVectorSearch: true,
      fromStructuredAnchor: false,
    });
    expect(byId.get("anchor-only")!.provenance).toStrictEqual({
      fromVectorSearch: false,
      fromStructuredAnchor: true,
    });
  });
});
