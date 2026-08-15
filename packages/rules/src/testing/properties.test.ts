import { describe, expect, it } from "vitest";

import { sumEventContributions } from "../kernel/numeric.js";
import { compareRecallResults } from "../kernel/ordering.js";

/**
 * Consolidates the property categories the phase plan names for `P2-20`
 * that no owning module's own test suite already proves (`VPR-10`):
 * permutation independence and no-input-mutation. The other two
 * categories, repeat protection and bounded scores/ambient eligibility,
 * used to live here too, but `beliefs/evidence.test.ts`, `kernel/
 * numeric.test.ts`'s own `clampScore` cases, and `world/visits.test.ts`'s
 * exhaustive `computeAmbientEligible` case already prove the same
 * invariants more strongly (exact expected values across every
 * `EVENT_TYPES` value, not just "does not throw"), so keeping a second,
 * weaker copy here added no coverage.
 */

describe("property: permutation independence", () => {
  it("sumEventContributions is order-independent — summing a permutation gives the same totals", () => {
    const contributions = [
      { target: "a", delta: 10 },
      { target: "b", delta: -5 },
      { target: "a", delta: 20 },
      { target: "b", delta: 15 },
      { target: "a", delta: -3 },
    ];
    const forward = sumEventContributions(
      contributions,
      (c) => c.target,
      (c) => c.delta,
    );
    const shuffled = sumEventContributions(
      [...contributions].toReversed(),
      (c) => c.target,
      (c) => c.delta,
    );
    expect([...shuffled.entries()].toSorted()).toStrictEqual(
      [...forward.entries()].toSorted(),
    );
  });

  it("a stable comparator sorts a pre-shuffled array to the same order regardless of starting order", () => {
    const results = [
      { score: 0.9, occurredAt: new Date("2026-01-01T00:00:00.000Z"), episodeId: "a" },
      { score: 0.1, occurredAt: new Date("2026-01-01T00:00:00.000Z"), episodeId: "b" },
      { score: 0.5, occurredAt: new Date("2026-01-01T00:00:00.000Z"), episodeId: "c" },
    ];
    const sortedForward = [...results].toSorted(compareRecallResults);
    const sortedFromReversed = [...results].toReversed().toSorted(compareRecallResults);
    expect(sortedFromReversed).toStrictEqual(sortedForward);
  });
});

describe("property: no input mutation", () => {
  it("sumEventContributions never mutates its input array", () => {
    const contributions = Object.freeze([
      { target: "a", delta: 10 },
      { target: "b", delta: -5 },
    ]);
    const before = JSON.stringify(contributions);
    sumEventContributions(
      contributions,
      (c) => c.target,
      (c) => c.delta,
    );
    expect(JSON.stringify(contributions)).toBe(before);
  });
});
