import { describe, expect, it } from "vitest";

import { meetsDisclosureTier, type DisclosureGateInputs } from "./tiers.js";

const BASE: DisclosureGateInputs = {
  isRelevantToRequest: false,
  trust: 0,
  suspicion: 0,
  verifiedCluePresentedThisAction: false,
  everBrokenPromiseToThisNpc: false,
  isCorinsCoverStoryClaim: false,
  confrontationGateOpen: false,
};

describe("public tier", () => {
  it("gates only on relevance to the request", () => {
    expect(meetsDisclosureTier("public", { ...BASE, isRelevantToRequest: true })).toBe(
      true,
    );
    expect(meetsDisclosureTier("public", { ...BASE, isRelevantToRequest: false })).toBe(
      false,
    );
  });
});

describe("guarded tier", () => {
  it.each([
    [19, 0, false, false],
    [20, 0, false, true],
    [20, 39, false, true],
    [20, 40, false, false],
  ] as const)(
    "trust=%i suspicion=%i clue=%s -> %s",
    (trust, suspicion, clue, expected) => {
      expect(
        meetsDisclosureTier("guarded", {
          ...BASE,
          trust,
          suspicion,
          verifiedCluePresentedThisAction: clue,
        }),
      ).toBe(expected);
    },
  );

  it("a relevant verified clue presented this action passes the gate on its own", () => {
    expect(
      meetsDisclosureTier("guarded", {
        ...BASE,
        trust: -100,
        suspicion: 100,
        verifiedCluePresentedThisAction: true,
      }),
    ).toBe(true);
  });
});

describe("confidential tier", () => {
  it.each([
    [39, 0, false, false],
    [40, 0, false, true],
    [40, 19, false, true],
    [40, 20, false, false],
  ] as const)("trust=%i suspicion=%i -> %s", (trust, suspicion, _unused, expected) => {
    expect(meetsDisclosureTier("confidential", { ...BASE, trust, suspicion })).toBe(
      expected,
    );
  });

  it("is blocked by a broken-promise grievance regardless of trust and suspicion", () => {
    expect(
      meetsDisclosureTier("confidential", {
        ...BASE,
        trust: 100,
        suspicion: -100,
        everBrokenPromiseToThisNpc: true,
      }),
    ).toBe(false);
  });
});

describe("cover_story tier", () => {
  it("requires the authored cover-story claim and a still-closed confrontation gate", () => {
    expect(
      meetsDisclosureTier("cover_story", { ...BASE, isCorinsCoverStoryClaim: true }),
    ).toBe(true);
    expect(
      meetsDisclosureTier("cover_story", { ...BASE, isCorinsCoverStoryClaim: false }),
    ).toBe(false);
    expect(
      meetsDisclosureTier("cover_story", {
        ...BASE,
        isCorinsCoverStoryClaim: true,
        confrontationGateOpen: true,
      }),
    ).toBe(false);
  });
});

describe("final_truth tier", () => {
  it("gates only on the confrontation gate being open", () => {
    expect(
      meetsDisclosureTier("final_truth", { ...BASE, confrontationGateOpen: true }),
    ).toBe(true);
    expect(
      meetsDisclosureTier("final_truth", { ...BASE, confrontationGateOpen: false }),
    ).toBe(false);
  });
});
