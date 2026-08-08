import { describe, expect, it } from "vitest";

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";

import {
  buildApprovedDisclosureBundle,
  DisclosureBundleLimitError,
  type DisclosureCandidateInput,
} from "./bundle.js";
import type { DisclosureGateInputs } from "./tiers.js";

const OPEN_GATE: DisclosureGateInputs = {
  isRelevantToRequest: true,
  trust: 100,
  suspicion: -100,
  verifiedCluePresentedThisAction: false,
  everBrokenPromiseToThisNpc: false,
  isCorinsCoverStoryClaim: false,
  confrontationGateOpen: false,
};

function scoreFor(npcKey: string, claimKey: string): number {
  return (
    BELL_MYSTERY_V1.seedBeliefs.find(
      (belief) => belief.npcKey === npcKey && belief.claimKey === claimKey,
    )?.score ?? 0
  );
}

function believedClaimCandidate(
  npcKey: string,
  claimKey: string,
  overrides: Partial<DisclosureCandidateInput> = {},
): DisclosureCandidateInput {
  return {
    claimId: claimKey,
    requiresBeliefGate: true,
    stance: "believed",
    sourceEpisodeId: null,
    parentTransmissionId: null,
    tier: "confidential",
    gateInputs: OPEN_GATE,
    beliefScore: scoreFor(npcKey, claimKey),
    contradictingClaimScores: [],
    permittedEntityIds: [],
    ...overrides,
  };
}

describe("buildApprovedDisclosureBundle limits", () => {
  it("rejects more than four required disclosure IDs", () => {
    expect(() =>
      buildApprovedDisclosureBundle([], ["a", "b", "c", "d", "e"], [], [], []),
    ).toThrow(DisclosureBundleLimitError);
  });

  it("rejects more than three required outcome IDs", () => {
    expect(() =>
      buildApprovedDisclosureBundle([], [], [], ["a", "b", "c", "d"], []),
    ).toThrow(DisclosureBundleLimitError);
  });

  it("accepts exactly the limit", () => {
    expect(() =>
      buildApprovedDisclosureBundle([], ["a", "b", "c", "d"], [], ["a", "b", "c"], []),
    ).not.toThrow();
  });
});

describe("buildApprovedDisclosureBundle gating", () => {
  it("excludes a candidate that fails the tier gate even if it is believed", () => {
    const candidate = believedClaimCandidate("corin_hale", "corin_moved_bell", {
      gateInputs: { ...OPEN_GATE, trust: 0, suspicion: 0 },
    });
    const bundle = buildApprovedDisclosureBundle([candidate], [], [], [], []);
    expect(bundle.approvedDisclosures).toStrictEqual([]);
  });

  it("excludes an ordinary claim that passes the tier but is not a selected belief", () => {
    const candidate = believedClaimCandidate("mara_venn", "bell_at_chapel");
    expect(candidate.beliefScore).toBe(0);
    const bundle = buildApprovedDisclosureBundle([candidate], [], [], [], []);
    expect(bundle.approvedDisclosures).toStrictEqual([]);
  });

  it("includes a direct observation even when it bypasses the belief gate", () => {
    const candidate = believedClaimCandidate("mara_venn", "some_unbelieved_claim", {
      requiresBeliefGate: false,
      beliefScore: 0,
    });
    const bundle = buildApprovedDisclosureBundle([candidate], [], [], [], []);
    expect(bundle.approvedDisclosures).toHaveLength(1);
  });

  it("carries requiredDisclosureIds/requiredOutcomeIds/approvedEpisodes through unchanged", () => {
    const bundle = buildApprovedDisclosureBundle(
      [],
      ["claim-1"],
      [{ outcomeId: "outcome-1" }],
      ["outcome-1"],
      [{ episodeId: "ep-1", spoilerSafeSummary: "Something happened." }],
    );
    expect(bundle.requiredDisclosureIds).toStrictEqual(["claim-1"]);
    expect(bundle.approvedOutcomes).toStrictEqual([{ outcomeId: "outcome-1" }]);
    expect(bundle.requiredOutcomeIds).toStrictEqual(["outcome-1"]);
    expect(bundle.approvedEpisodes).toStrictEqual([
      { episodeId: "ep-1", spoilerSafeSummary: "Something happened." },
    ]);
  });
});

/**
 * Reuses the exact scenarios `content/validate.ts` already statically
 * checks (Mara's seed context excludes chapel truth, Nessa's cart
 * observation excludes the bell, Corin starts with the full truth) — run
 * through the *live* bundle builder this time, to prove the engine agrees
 * with the content author's own checks rather than just the static registry.
 */
describe("negative fixtures matching content/validate.ts's starting-knowledge boundaries", () => {
  it("never approves the chapel location for Mara, even with every gate wide open", () => {
    const bundle = buildApprovedDisclosureBundle(
      [believedClaimCandidate("mara_venn", "bell_at_chapel")],
      [],
      [],
      [],
      [],
    );
    expect(bundle.approvedDisclosures).toStrictEqual([]);
  });

  it("never approves the bell's location for Nessa from her cart observation", () => {
    for (const claimKey of [
      "bell_at_chapel",
      "bell_at_chapel_current",
      "lark_damaged_bell",
    ]) {
      const bundle = buildApprovedDisclosureBundle(
        [believedClaimCandidate("nessa_reed", claimKey)],
        [],
        [],
        [],
        [],
      );
      expect(bundle.approvedDisclosures).toStrictEqual([]);
    }
  });

  it("approves Corin's full starting truth once the tier gate is open", () => {
    for (const claimKey of [
      "lark_damaged_bell",
      "corin_moved_bell",
      "bell_at_chapel",
      "corin_protected_lark",
    ]) {
      const bundle = buildApprovedDisclosureBundle(
        [believedClaimCandidate("corin_hale", claimKey)],
        [],
        [],
        [],
        [],
      );
      expect(bundle.approvedDisclosures).toHaveLength(1);
      expect(bundle.approvedDisclosures[0]!.claimId).toBe(claimKey);
    }
  });
});
