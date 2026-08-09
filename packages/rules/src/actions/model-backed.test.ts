import { describe, expect, it } from "vitest";

import { isExternalSelectionRequired } from "./dispatcher.js";
import {
  planAcceptPromise,
  planAsk,
  planGive,
  planNormalizeClaim,
  planShow,
  planTell,
  type DisclosureBundleInputs,
} from "./model-backed.js";

const EMPTY_BUNDLE: DisclosureBundleInputs = {
  disclosureCandidates: [],
  requiredDisclosureIds: [],
  approvedOutcomes: [],
  requiredOutcomeIds: [],
  approvedEpisodes: [],
};

describe("planAsk", () => {
  it("denies when the NPC is not present", () => {
    const result = planAsk({ npcPresent: false, ...EMPTY_BUNDLE });
    expect(isExternalSelectionRequired(result)).toBe(false);
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("NPC_NOT_PRESENT");
  });

  it("requires external selection once authorized", () => {
    const result = planAsk({ npcPresent: true, ...EMPTY_BUNDLE });
    expect(isExternalSelectionRequired(result)).toBe(true);
  });
});

describe("planNormalizeClaim", () => {
  it("denies when the NPC is not present", () => {
    const result = planNormalizeClaim({ npcPresent: false, ...EMPTY_BUNDLE });
    expect(isExternalSelectionRequired(result)).toBe(false);
  });

  it("requires external selection once authorized", () => {
    const result = planNormalizeClaim({ npcPresent: true, ...EMPTY_BUNDLE });
    expect(isExternalSelectionRequired(result)).toBe(true);
  });
});

describe("planTell", () => {
  it("denies a missing claim draft", () => {
    const result = planTell({
      claimDraftExists: false,
      claimDraftExpired: false,
      claimDraftAlreadyConfirmed: false,
      ...EMPTY_BUNDLE,
    });
    expect(isExternalSelectionRequired(result)).toBe(false);
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("CLAIM_DRAFT_NOT_FOUND");
  });

  it("denies an expired claim draft", () => {
    const result = planTell({
      claimDraftExists: true,
      claimDraftExpired: true,
      claimDraftAlreadyConfirmed: false,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("CLAIM_DRAFT_EXPIRED");
  });

  it("denies an already-confirmed claim draft", () => {
    const result = planTell({
      claimDraftExists: true,
      claimDraftExpired: false,
      claimDraftAlreadyConfirmed: true,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("CLAIM_DRAFT_ALREADY_CONFIRMED");
  });

  it("requires external selection for a valid draft", () => {
    const result = planTell({
      claimDraftExists: true,
      claimDraftExpired: false,
      claimDraftAlreadyConfirmed: false,
      ...EMPTY_BUNDLE,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
    if (isExternalSelectionRequired(result)) {
      expect(result.effects).toStrictEqual([
        { kind: "event_origin", eventType: "claim_transmitted", effectIndex: 0 },
      ]);
    }
  });
});

describe("planShow", () => {
  it("denies an item Show without holding the item", () => {
    const result = planShow({
      evidenceKind: "item",
      clueDiscoveredInTown: false,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      relationshipReasons: [],
      npcId: "npc-1",
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("EVIDENCE_NOT_AUTHORIZED");
  });

  it("appends belief_evidence and updates the affected belief when a clue is linked", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-1"],
      clueClaimEffects: [
        {
          clueId: "clue-1",
          claimId: "claim-1",
          signedWeight: 70,
          npcBeliefScore: 10,
          npcBeliefRevision: 2,
        },
      ],
      relationshipReasons: ["verified_testimony", "evidence_presented"],
      npcId: "npc-1",
      ...EMPTY_BUNDLE,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
    if (isExternalSelectionRequired(result)) {
      expect(result.effects).toHaveLength(4);
      const evidenceInsert = result.effects.find(
        (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
      );
      expect(evidenceInsert).toMatchObject({
        row: {
          npc_id: "npc-1",
          claim_id: "claim-1",
          clue_id: "clue-1",
          evidence_kind: "physical_clue",
          signed_weight: 70,
        },
      });
      const beliefChange = result.effects.find(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "npc_beliefs",
      );
      expect(beliefChange).toMatchObject({
        key: { npc_id: "npc-1", claim_id: "claim-1" },
        expectedRevision: 2,
        change: { score: 80, label: "convinced" },
      });
    }
  });

  it("produces no belief effect when no shown clue is linked", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-unlinked"],
      clueClaimEffects: [],
      relationshipReasons: [],
      npcId: "npc-1",
      ...EMPTY_BUNDLE,
    });
    if (isExternalSelectionRequired(result)) {
      expect(
        result.effects.some(
          (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
        ),
      ).toBe(false);
    }
  });
});

describe("planGive", () => {
  it("denies when the item is not held", () => {
    const result = planGive({
      npcPresent: true,
      itemHeldByPlayer: false,
      npcAcceptsItem: true,
      itemId: "item-1",
      itemRevision: 4,
      recipientActorId: "npc-1",
      relationshipReasons: [],
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("ITEM_NOT_HELD");
  });

  it("requires external selection and transfers custody to the recipient NPC against the item's real revision", () => {
    const result = planGive({
      npcPresent: true,
      itemHeldByPlayer: true,
      npcAcceptsItem: true,
      itemId: "item-1",
      itemRevision: 4,
      recipientActorId: "npc-1",
      relationshipReasons: ["requested_item_given"],
      ...EMPTY_BUNDLE,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
    if (isExternalSelectionRequired(result)) {
      const custodyChange = result.effects.find(
        (effect) => effect.kind === "conditional_state_change",
      );
      expect(custodyChange).toMatchObject({
        table: "items",
        key: { id: "item-1" },
        expectedRevision: 4,
        change: { held_by_actor_id: "npc-1" },
      });
    }
  });

  it("requires external selection with no custody effect when the NPC declines", () => {
    const result = planGive({
      npcPresent: true,
      itemHeldByPlayer: true,
      npcAcceptsItem: false,
      itemId: "item-1",
      itemRevision: 4,
      recipientActorId: "npc-1",
      relationshipReasons: [],
      ...EMPTY_BUNDLE,
    });
    if (isExternalSelectionRequired(result)) {
      expect(
        result.effects.some((effect) => effect.kind === "conditional_state_change"),
      ).toBe(false);
    }
  });
});

describe("planAcceptPromise", () => {
  it("denies an invalid offer", () => {
    const result = planAcceptPromise({
      offerIsValid: false,
      hasActivePromiseAlready: false,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("PROMISE_OFFER_INVALID");
  });

  it("denies reaccepting an already-active promise", () => {
    const result = planAcceptPromise({
      offerIsValid: true,
      hasActivePromiseAlready: true,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("PROMISE_ALREADY_ACTIVE");
  });

  it("requires external selection for a valid new offer", () => {
    const result = planAcceptPromise({
      offerIsValid: true,
      hasActivePromiseAlready: false,
      ...EMPTY_BUNDLE,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
  });
});
