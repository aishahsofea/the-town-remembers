import { describe, expect, it } from "vitest";

import { isRepeatContribution } from "../beliefs/evidence.js";
import { clampScore, sumEventContributions } from "../kernel/numeric.js";
import { compareRecallResults } from "../kernel/ordering.js";
import { computeAmbientEligible } from "../world/visits.js";

/**
 * Consolidates the four property categories the phase plan names for
 * `P2-20`, gathering one explicit, clearly-labeled proof of each here even
 * where an individual module's own test suite already exercises the
 * underlying property incidentally.
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

describe("property: idempotent repeat protection", () => {
  it("attempting the same contribution any number of times is always rejected the same way", () => {
    const candidate = {
      npcId: "npc-1",
      claimId: "claim-1",
      evidenceKind: "physical_clue" as const,
      clueId: "clue-1",
    };
    const active = [candidate];
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(isRepeatContribution(active, candidate)).toBe(true);
    }
  });
});

describe("property: bounded scores, actions, and hops", () => {
  it("clampScore never produces a value outside [-100, 100] for any input", () => {
    for (const value of [-1_000_000, -101, -100, 0, 100, 101, 1_000_000]) {
      const clamped = clampScore(value);
      expect(clamped).toBeGreaterThanOrEqual(-100);
      expect(clamped).toBeLessThanOrEqual(100);
    }
  });

  it("computeAmbientEligible never throws for any EVENT_TYPES value regardless of options", () => {
    const eventTypes = [
      "authored_observation",
      "visit_started",
      "travelled",
      "inspected",
      "clue_discovered",
      "npc_interaction",
      "claim_transmitted",
      "evidence_shown",
      "item_transferred",
      "item_relocated",
      "promise_accepted",
      "promise_fulfilled",
      "promise_broken",
      "capability_changed",
      "note_added",
      "visit_ended",
      "relationship_changed",
      "source_discredited",
      "case_attempted",
      "case_resolved",
    ] as const;
    for (const eventType of eventTypes) {
      expect(() => computeAmbientEligible(eventType)).not.toThrow();
      expect(() =>
        computeAmbientEligible(eventType, {
          hasStructuredEffect: true,
          isEvidentiary: true,
        }),
      ).not.toThrow();
    }
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
