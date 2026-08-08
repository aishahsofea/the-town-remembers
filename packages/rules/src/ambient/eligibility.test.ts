import { describe, expect, it } from "vitest";

import { CONTACT_EDGES } from "@the-town-remembers/content";

import { npcTestimonyBase, testimonyWeight } from "../beliefs/evidence.js";
import {
  buildAmbientShortlist,
  computeAmbientPriority,
  isAmbientCandidateEligible,
  type AmbientEligibilityInputs,
  type AmbientShortlistCandidate,
} from "./eligibility.js";

const BASE: AmbientEligibilityInputs = {
  townActive: true,
  jobActive: true,
  claimDirectlyReferencedInRange: true,
  claimSharesCanonicalEntityWithEligibleEventViaTopRecall: false,
  speakerBeliefScore: 40,
  speakerHasEnabledCoverStory: false,
  hasExactProvenanceSource: true,
  directedContactEdgeExists: true,
  disclosureTier: "public",
  listenerTrustInSpeaker: 0,
  proposedHopCount: 1,
  isProvenanceChainRevisit: false,
  isDuplicateSourceRepeatDelivery: false,
};

describe("isAmbientCandidateEligible: full checklist", () => {
  it("accepts a candidate meeting every condition", () => {
    expect(isAmbientCandidateEligible(BASE)).toBe(true);
  });

  it("requires the town and job both active", () => {
    expect(isAmbientCandidateEligible({ ...BASE, townActive: false })).toBe(false);
    expect(isAmbientCandidateEligible({ ...BASE, jobActive: false })).toBe(false);
  });

  it("requires either a direct claim reference or top-recall canonical-entity overlap", () => {
    expect(
      isAmbientCandidateEligible({
        ...BASE,
        claimDirectlyReferencedInRange: false,
        claimSharesCanonicalEntityWithEligibleEventViaTopRecall: false,
      }),
    ).toBe(false);
    expect(
      isAmbientCandidateEligible({
        ...BASE,
        claimDirectlyReferencedInRange: false,
        claimSharesCanonicalEntityWithEligibleEventViaTopRecall: true,
      }),
    ).toBe(true);
  });

  it("uses the raw score>=20 floor only, never a lead requirement", () => {
    expect(isAmbientCandidateEligible({ ...BASE, speakerBeliefScore: 20 })).toBe(true);
    expect(isAmbientCandidateEligible({ ...BASE, speakerBeliefScore: 19 })).toBe(false);
  });

  it("Corin's enabled cover story substitutes for the belief floor", () => {
    expect(
      isAmbientCandidateEligible({
        ...BASE,
        speakerBeliefScore: 0,
        speakerHasEnabledCoverStory: true,
        disclosureTier: "cover_story",
      }),
    ).toBe(true);
  });

  it("requires an exact provenance source", () => {
    expect(
      isAmbientCandidateEligible({ ...BASE, hasExactProvenanceSource: false }),
    ).toBe(false);
  });

  it("requires the directed contact edge to exist", () => {
    expect(
      isAmbientCandidateEligible({ ...BASE, directedContactEdgeExists: false }),
    ).toBe(false);
  });

  it.each(["confidential", "final_truth"] as const)(
    "the %s tier is never a candidate",
    (tier) => {
      expect(isAmbientCandidateEligible({ ...BASE, disclosureTier: tier })).toBe(false);
    },
  );

  it("guarded requires listener trust >= 20", () => {
    expect(
      isAmbientCandidateEligible({
        ...BASE,
        disclosureTier: "guarded",
        listenerTrustInSpeaker: 20,
      }),
    ).toBe(true);
    expect(
      isAmbientCandidateEligible({
        ...BASE,
        disclosureTier: "guarded",
        listenerTrustInSpeaker: 19,
      }),
    ).toBe(false);
  });

  it("cover_story requires the enabled flag even at the tier level", () => {
    expect(
      isAmbientCandidateEligible({
        ...BASE,
        disclosureTier: "cover_story",
        speakerHasEnabledCoverStory: false,
      }),
    ).toBe(false);
  });

  it("caps proposed hop count at 3 — hop 4 is reserved for the terminal player disclosure only", () => {
    expect(isAmbientCandidateEligible({ ...BASE, proposedHopCount: 3 })).toBe(true);
    expect(isAmbientCandidateEligible({ ...BASE, proposedHopCount: 4 })).toBe(false);
  });

  it("rejects a provenance-chain revisit", () => {
    expect(
      isAmbientCandidateEligible({ ...BASE, isProvenanceChainRevisit: true }),
    ).toBe(false);
  });

  it("rejects a duplicate-source repeat delivery", () => {
    expect(
      isAmbientCandidateEligible({ ...BASE, isDuplicateSourceRepeatDelivery: true }),
    ).toBe(false);
  });
});

describe("computeAmbientPriority", () => {
  it("computes the exact formula for a worked input", () => {
    // 50*1 + max(0,40) + 20*1 + floor((20+100)/10) - 10*1
    // = 50 + 40 + 20 + 12 - 10 = 112
    expect(
      computeAmbientPriority({
        triggeringEventMatch: true,
        speakerBeliefScore: 40,
        recipientHoldsContradictoryBelief: true,
        listenerTrustInSpeaker: 20,
        proposedHopCount: 1,
      }),
    ).toBe(112);
  });

  it("floors a negative speaker belief score at zero rather than subtracting it", () => {
    expect(
      computeAmbientPriority({
        triggeringEventMatch: false,
        speakerBeliefScore: -50,
        recipientHoldsContradictoryBelief: false,
        listenerTrustInSpeaker: -100,
        proposedHopCount: 0,
      }),
    ).toBe(0);
  });
});

describe("buildAmbientShortlist", () => {
  it("orders by compareAmbientCandidates and caps at 12", () => {
    const candidates: AmbientShortlistCandidate[] = Array.from(
      { length: 15 },
      (_, index) => ({
        choiceId: `c-${index}`,
        priority: index,
        normalizedClaimKey: "claim",
        speakerActorId: "s",
        recipientActorId: "r",
      }),
    );
    const shortlist = buildAmbientShortlist(candidates);
    expect(shortlist).toHaveLength(12);
    expect(shortlist[0]!.priority).toBe(14);
    expect(shortlist[11]!.priority).toBe(3);
  });
});

describe("worked fixture: Mara-to-Nessa/Corin hop-1 testimony is exactly +32", () => {
  it("uses the Nessa->Mara and Corin->Mara trust-20 edges from content#CONTACT_EDGES", () => {
    const nessaToMara = CONTACT_EDGES.find(
      (edge) => edge.fromNpcKey === "nessa_reed" && edge.toNpcKey === "mara_venn",
    );
    const corinToMara = CONTACT_EDGES.find(
      (edge) => edge.fromNpcKey === "corin_hale" && edge.toNpcKey === "mara_venn",
    );
    expect(nessaToMara?.trustScore).toBe(20);
    expect(corinToMara?.trustScore).toBe(20);

    for (const edge of [nessaToMara!, corinToMara!]) {
      const base = npcTestimonyBase(edge.trustScore);
      expect(base).toBe(42);
      expect(testimonyWeight(base, 1)).toBe(32);
    }
  });

  it("there is no direct Nessa<->Corin edge, so Mara is a required intermediary", () => {
    const direct = CONTACT_EDGES.some(
      (edge) =>
        (edge.fromNpcKey === "nessa_reed" && edge.toNpcKey === "corin_hale") ||
        (edge.fromNpcKey === "corin_hale" && edge.toNpcKey === "nessa_reed"),
    );
    expect(direct).toBe(false);
  });
});
