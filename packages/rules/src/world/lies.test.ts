import { describe, expect, it } from "vitest";

import {
  planSourceDiscreditedReversal,
  type ActiveContribution,
} from "../beliefs/evidence.js";
import {
  establishesKnowingLie,
  scopedSourceDiscreditedTarget,
  type KnowingLieInputs,
} from "./lies.js";

const ALL_TRUE: KnowingLieInputs = {
  playerConfirmedClaimToThisNpc: true,
  contradictingClueVerifiedAndVisibleAtConfirmation: true,
  npcLaterPresentedClueOrHadDirectKnowledge: true,
  priorLieEstablishedForThisPlayerNpcClaim: false,
};

describe("establishesKnowingLie: the positive case", () => {
  it("establishes a lie when all four parts hold", () => {
    expect(establishesKnowingLie(ALL_TRUE)).toBe(true);
  });
});

describe("establishesKnowingLie: required negative fixtures", () => {
  it("mere contradiction alone never establishes a lie (no player confirmation)", () => {
    expect(
      establishesKnowingLie({ ...ALL_TRUE, playerConfirmedClaimToThisNpc: false }),
    ).toBe(false);
  });

  it("mutually inconsistent claims without prior physical NPC knowledge never establish one", () => {
    expect(
      establishesKnowingLie({
        ...ALL_TRUE,
        npcLaterPresentedClueOrHadDirectKnowledge: false,
      }),
    ).toBe(false);
  });

  it("another NPC's independent knowledge does not establish a lie for a different NPC who never confirmed anything", () => {
    // Modeled as: this (different) NPC never received a player confirmation,
    // even though the contradicting clue and knowledge conditions hold —
    // those belong to the OTHER NPC's own evaluation, not this one's.
    expect(
      establishesKnowingLie({
        playerConfirmedClaimToThisNpc: false,
        contradictingClueVerifiedAndVisibleAtConfirmation: true,
        npcLaterPresentedClueOrHadDirectKnowledge: true,
        priorLieEstablishedForThisPlayerNpcClaim: false,
      }),
    ).toBe(false);
  });

  it("no unverified clue satisfies part 2 on its own", () => {
    expect(
      establishesKnowingLie({
        ...ALL_TRUE,
        contradictingClueVerifiedAndVisibleAtConfirmation: false,
      }),
    ).toBe(false);
  });

  it("a prior lie_established for this exact triple blocks re-establishing it", () => {
    expect(
      establishesKnowingLie({
        ...ALL_TRUE,
        priorLieEstablishedForThisPlayerNpcClaim: true,
      }),
    ).toBe(false);
  });
});

describe("scopedSourceDiscreditedTarget", () => {
  it("scopes the reversal to exactly this listening NPC, source, and claim", () => {
    const target = scopedSourceDiscreditedTarget(
      "nessa_reed",
      "corin_hale",
      "corin_moved_bell",
    );
    expect(target).toStrictEqual({
      listeningNpcId: "nessa_reed",
      sourceActorId: "corin_hale",
      claimId: "corin_moved_bell",
    });
  });

  it("never propagates to another NPC: the caller passes only this NPC's own contributions", () => {
    const target = scopedSourceDiscreditedTarget(
      "nessa_reed",
      "corin_hale",
      "corin_moved_bell",
    );
    const allActiveContributions: readonly ActiveContribution[] = [
      {
        evidenceId: "ev-nessa",
        npcId: "nessa_reed",
        claimId: "corin_moved_bell",
        signedWeight: 32,
        independentSourceActorId: "corin_hale",
      },
      {
        evidenceId: "ev-mara",
        npcId: "mara_venn",
        claimId: "corin_moved_bell",
        signedWeight: 44,
        independentSourceActorId: "corin_hale",
      },
    ];
    const onlyListeningNpcContributions = allActiveContributions.filter(
      (contribution) => contribution.npcId === target.listeningNpcId,
    );

    const plan = planSourceDiscreditedReversal(
      onlyListeningNpcContributions,
      target.sourceActorId,
      new Set(),
      "event-1",
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]!.npcId).toBe("nessa_reed");
  });
});
