import { describe, expect, it } from "vitest";

import type { AmbientChoiceV1 } from "@the-town-remembers/model-contracts";

import { planAmbientSelections, type AmbientShortlistEntry } from "./selection.js";

const SHORTLIST: readonly AmbientShortlistEntry[] = [
  {
    choiceId: "c1",
    claimId: "claim-a",
    speakerActorId: "mara_venn",
    isResolvable: true,
    isStillEligible: true,
  },
  {
    choiceId: "c2",
    claimId: "claim-b",
    speakerActorId: "nessa_reed",
    isResolvable: true,
    isStillEligible: true,
  },
  {
    choiceId: "c3",
    claimId: "claim-a",
    speakerActorId: "corin_hale",
    isResolvable: true,
    isStillEligible: true,
  },
  {
    choiceId: "c4",
    claimId: "claim-c",
    speakerActorId: "mara_venn",
    isResolvable: false,
    isStillEligible: true,
  },
  {
    choiceId: "c5",
    claimId: "claim-d",
    speakerActorId: "nessa_reed",
    isResolvable: true,
    isStillEligible: false,
  },
];

function choice(overrides: Partial<AmbientChoiceV1> = {}): AmbientChoiceV1 {
  return {
    decision: "select_choices",
    primary_choice_id: null,
    secondary_choice_id: null,
    selection_reason: "share_salient_claim",
    ...overrides,
  };
}

describe("do_nothing", () => {
  it("applies zero transmissions", () => {
    const plan = planAmbientSelections(
      choice({ decision: "do_nothing", selection_reason: "nothing_safe_or_relevant" }),
      SHORTLIST,
    );
    expect(plan.transmissionCount).toBe(0);
    expect(plan.primary).toBeUndefined();
    expect(plan.secondary).toBeUndefined();
  });
});

describe("a valid single selection", () => {
  it("applies exactly one transmission", () => {
    const plan = planAmbientSelections(choice({ primary_choice_id: "c1" }), SHORTLIST);
    expect(plan.transmissionCount).toBe(1);
    expect(plan.primary).toStrictEqual({
      choiceId: "c1",
      applied: true,
      entry: SHORTLIST[0],
    });
    expect(plan.secondary).toBeUndefined();
  });
});

describe("two valid selections with distinct claim and speaker", () => {
  it("applies both transmissions", () => {
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "c1", secondary_choice_id: "c2" }),
      SHORTLIST,
    );
    expect(plan.transmissionCount).toBe(2);
    expect(plan.primary?.applied).toBe(true);
    expect(plan.secondary?.applied).toBe(true);
  });
});

describe("the six failure modes each degrade only their own selection", () => {
  it("missing_candidate: an unresolvable candidate", () => {
    const plan = planAmbientSelections(choice({ primary_choice_id: "c4" }), SHORTLIST);
    expect(plan.primary).toStrictEqual({
      choiceId: "c4",
      applied: false,
      failureReason: "missing_candidate",
      entry: SHORTLIST[3],
    });
    expect(plan.transmissionCount).toBe(0);
  });

  it("out_of_list_id: an ID never on the shortlist", () => {
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "hallucinated" }),
      SHORTLIST,
    );
    expect(plan.primary).toStrictEqual({
      choiceId: "hallucinated",
      applied: false,
      failureReason: "out_of_list_id",
    });
  });

  it("duplicate_choice: secondary equals primary", () => {
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "c1", secondary_choice_id: "c1" }),
      SHORTLIST,
    );
    expect(plan.primary?.applied).toBe(true);
    expect(plan.secondary).toStrictEqual({
      choiceId: "c1",
      applied: false,
      failureReason: "duplicate_choice",
    });
    expect(plan.transmissionCount).toBe(1);
  });

  it("repeated_claim: primary and secondary reference the same claim through different choices", () => {
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "c1", secondary_choice_id: "c3" }),
      SHORTLIST,
    );
    expect(plan.primary?.applied).toBe(true);
    expect(plan.secondary).toStrictEqual({
      choiceId: "c3",
      applied: false,
      failureReason: "repeated_claim",
      entry: SHORTLIST[2],
    });
    expect(plan.transmissionCount).toBe(1);
  });

  it("repeated_speaker: primary and secondary share the same source NPC", () => {
    const withSameSpeaker: AmbientShortlistEntry = {
      choiceId: "c6",
      claimId: "claim-e",
      speakerActorId: "mara_venn",
      isResolvable: true,
      isStillEligible: true,
    };
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "c1", secondary_choice_id: "c6" }),
      [...SHORTLIST, withSameSpeaker],
    );
    expect(plan.primary?.applied).toBe(true);
    expect(plan.secondary).toStrictEqual({
      choiceId: "c6",
      applied: false,
      failureReason: "repeated_speaker",
      entry: withSameSpeaker,
    });
  });

  it("newly_invalid: an eligibility check that passed at shortlist time no longer passes", () => {
    const plan = planAmbientSelections(choice({ primary_choice_id: "c5" }), SHORTLIST);
    expect(plan.primary).toStrictEqual({
      choiceId: "c5",
      applied: false,
      failureReason: "newly_invalid",
      entry: SHORTLIST[4],
    });
  });
});

describe("same-batch chaining, not cross-call", () => {
  it("secondary is validated against the snapshot plus the primary's committed effect", () => {
    // c1 and c3 share claim-a. Once c1 (primary) commits within this same
    // call, c3 (secondary) is rejected — the rejection could not happen if
    // secondary were validated against the pre-tick snapshot alone.
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "c1", secondary_choice_id: "c3" }),
      SHORTLIST,
    );
    expect(plan.secondary?.failureReason).toBe("repeated_claim");
  });

  it("never caps below the primary's own independent validation", () => {
    // If the primary itself fails, the secondary is still evaluated against
    // the pre-tick snapshot only (nothing was committed).
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "hallucinated", secondary_choice_id: "c2" }),
      SHORTLIST,
    );
    expect(plan.primary?.applied).toBe(false);
    expect(plan.secondary?.applied).toBe(true);
    expect(plan.transmissionCount).toBe(1);
  });
});

describe("never more than two transmissions", () => {
  it("the plan shape structurally admits at most a primary and a secondary slot", () => {
    const plan = planAmbientSelections(
      choice({ primary_choice_id: "c1", secondary_choice_id: "c2" }),
      SHORTLIST,
    );
    expect(plan.transmissionCount).toBeLessThanOrEqual(2);
  });
});
