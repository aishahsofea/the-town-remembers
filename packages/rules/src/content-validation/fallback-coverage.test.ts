import { describe, expect, it } from "vitest";

import {
  computeFallbackCoverage,
  isFullyCovered,
  type AuthoredFallbackLine,
  type FallbackCoverageRequirement,
} from "./fallback-coverage.js";

const REQUIREMENTS: readonly FallbackCoverageRequirement[] = [
  {
    npcKey: "corin_hale",
    actionKind: "ask",
    responseKind: "refuse",
    gateResult: "guarded",
    requiredOutcomeIds: ["outcome-1"],
  },
  {
    npcKey: "mara_venn",
    actionKind: "tell",
    responseKind: "answer",
    gateResult: "public",
    requiredOutcomeIds: [],
  },
];

describe("computeFallbackCoverage", () => {
  it("reports every requirement as missing when nothing is authored", () => {
    const result = computeFallbackCoverage(REQUIREMENTS, []);
    expect(result.covered).toStrictEqual([]);
    expect(result.missing).toStrictEqual(REQUIREMENTS);
    expect(isFullyCovered(result)).toBe(false);
  });

  it("covers a requirement whose authored line satisfies every required outcome", () => {
    const authored: readonly AuthoredFallbackLine[] = [
      {
        npcKey: "corin_hale",
        actionKind: "ask",
        responseKind: "refuse",
        gateResult: "guarded",
        outcomeIds: ["outcome-1", "outcome-2"],
      },
      {
        npcKey: "mara_venn",
        actionKind: "tell",
        responseKind: "answer",
        gateResult: "public",
        outcomeIds: [],
      },
    ];
    const result = computeFallbackCoverage(REQUIREMENTS, authored);
    expect(result.missing).toStrictEqual([]);
    expect(isFullyCovered(result)).toBe(true);
  });

  it("does not count a line matching the key but missing a required outcome as covered", () => {
    const authored: readonly AuthoredFallbackLine[] = [
      {
        npcKey: "corin_hale",
        actionKind: "ask",
        responseKind: "refuse",
        gateResult: "guarded",
        outcomeIds: ["some-other-outcome"],
      },
    ];
    const result = computeFallbackCoverage([REQUIREMENTS[0]!], authored);
    expect(result.missing).toStrictEqual([REQUIREMENTS[0]]);
  });

  it("does not match a line with a different gate_result even if everything else agrees", () => {
    const authored: readonly AuthoredFallbackLine[] = [
      {
        npcKey: "corin_hale",
        actionKind: "ask",
        responseKind: "refuse",
        gateResult: "confidential",
        outcomeIds: ["outcome-1"],
      },
    ];
    const result = computeFallbackCoverage([REQUIREMENTS[0]!], authored);
    expect(result.missing).toStrictEqual([REQUIREMENTS[0]]);
  });
});
