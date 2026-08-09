import { describe, expect, it } from "vitest";

import {
  computeRecallScore,
  directnessFor,
  effectiveImportanceFor,
  importanceComponentFor,
  importanceMinimumFor,
  isActiveContradiction,
  rankRecallResults,
  recencyFor,
  selectStructuredAnchors,
  similarityFor,
  vectorCandidatesFor,
} from "./scoring.js";

describe("similarityFor", () => {
  it("clamps to [0, 1]", () => {
    expect(similarityFor(-0.5)).toBe(0);
    expect(similarityFor(0.5)).toBe(0.5);
    expect(similarityFor(1.5)).toBe(1);
  });
});

describe("recencyFor", () => {
  it("is 1 at age zero", () => {
    expect(recencyFor(0)).toBe(1);
  });

  it("halves every 168 hours", () => {
    expect(recencyFor(168)).toBeCloseTo(0.5, 10);
    expect(recencyFor(336)).toBeCloseTo(0.25, 10);
  });
});

describe("importanceComponentFor", () => {
  it("divides by 100", () => {
    expect(importanceComponentFor(100)).toBe(1);
    expect(importanceComponentFor(0)).toBe(0);
    expect(importanceComponentFor(50)).toBe(0.5);
  });
});

describe("computeRecallScore", () => {
  it("computes the exact weighted sum for a worked input", () => {
    const score = computeRecallScore({
      cosineSimilarity: 1,
      ageHours: 0,
      effectiveImportance: 100,
      directness: 1,
      commitmentOrGrievance: true,
      activeContradiction: true,
    });
    // 0.45*1 + 0.15*1 + 0.15*1 + 0.10*1 + 0.10*1 + 0.05*1 = 1
    expect(score).toBeCloseTo(1, 10);
  });

  it("computes zero for a maximally uninteresting episode", () => {
    const score = computeRecallScore({
      cosineSimilarity: 0,
      ageHours: Number.POSITIVE_INFINITY,
      effectiveImportance: 0,
      directness: 0,
      commitmentOrGrievance: false,
      activeContradiction: false,
    });
    expect(score).toBe(0);
  });
});

describe("importanceMinimumFor: the nine-row table", () => {
  it.each([
    ["direct_observation", 90],
    ["hop0_heard_testimony", 60],
    ["hop1_heard_testimony", 50],
    ["hop2_or_3_heard_testimony", 40],
    ["ordinary_interaction", 40],
    ["fulfilled_promise", 85],
    ["unique_item_transfer", 85],
    ["broken_promise", 100],
    ["established_lie", 100],
  ] as const)("%s minimum importance is %i", (category, expected) => {
    expect(importanceMinimumFor(category)).toBe(expected);
  });
});

describe("effectiveImportanceFor", () => {
  it("leaves importance unchanged outside an active contradiction", () => {
    expect(effectiveImportanceFor(50, false)).toBe(50);
  });

  it("floors importance to 80 inside an active contradiction", () => {
    expect(effectiveImportanceFor(50, true)).toBe(80);
  });

  it("never lowers an already-higher stored importance", () => {
    expect(effectiveImportanceFor(90, true)).toBe(90);
  });

  it("is not persisted back — this is purely a scoring-time computation", () => {
    const stored = 50;
    const effective = effectiveImportanceFor(stored, true);
    expect(stored).toBe(50);
    expect(effective).toBe(80);
  });
});

describe("directnessFor: the four categories", () => {
  it.each([
    ["direct_observation_or_item_or_promise_or_consequence", 1],
    ["hop0_original_testimony", 0.6],
    ["hop1_plus_hearsay", 0.3],
    ["ordinary_interaction_without_claim", 0.5],
  ] as const)("%s is %f", (category, expected) => {
    expect(directnessFor(category)).toBe(expected);
  });
});

describe("isActiveContradiction", () => {
  it("requires both scores to independently clear the 20 floor", () => {
    expect(isActiveContradiction(20, 20)).toBe(true);
    expect(isActiveContradiction(19, 20)).toBe(false);
    expect(isActiveContradiction(20, 19)).toBe(false);
  });

  it("a lopsided lead alone is not enough without both clearing the floor", () => {
    expect(isActiveContradiction(90, 5)).toBe(false);
  });
});

describe("vectorCandidatesFor: embedding-failure fallback", () => {
  it("returns an empty list when embedding is unavailable, never a permissive default", () => {
    expect(vectorCandidatesFor(["a", "b", "c"], false)).toStrictEqual([]);
  });

  it("caps at 30 when embedding is available", () => {
    const candidates = Array.from({ length: 40 }, (_, index) => index);
    expect(vectorCandidatesFor(candidates, true)).toHaveLength(30);
  });
});

describe("selectStructuredAnchors", () => {
  it("orders by compareRecallAnchors and caps at 10", () => {
    const anchors = Array.from({ length: 12 }, (_, index) => ({
      importance: index,
      occurredAt: new Date(2026, 0, 1),
      episodeId: `ep-${index}`,
    }));
    const selected = selectStructuredAnchors(anchors);
    expect(selected).toHaveLength(10);
    // Highest importance first (descending).
    expect(selected[0]!.importance).toBe(11);
    expect(selected[9]!.importance).toBe(2);
  });
});

describe("rankRecallResults", () => {
  it("orders by score desc and caps at 8", () => {
    const results = Array.from({ length: 10 }, (_, index) => ({
      score: index,
      occurredAt: new Date(2026, 0, 1),
      episodeId: `ep-${index}`,
    }));
    const ranked = rankRecallResults(results);
    expect(ranked).toHaveLength(8);
    expect(ranked[0]!.episodeId).toBe("ep-9");
    expect(ranked[7]!.episodeId).toBe("ep-2");
  });
});
