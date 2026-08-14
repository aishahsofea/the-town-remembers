import { describe, expect, it } from "vitest";

import { RULES_REGISTRY } from "../kernel/version.js";
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
      claimDraftWrongNpc: false,
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
      claimDraftWrongNpc: false,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("CLAIM_DRAFT_EXPIRED");
  });

  it("denies a claim draft no longer bound to the player's current visit/NPC", () => {
    const result = planTell({
      claimDraftExists: true,
      claimDraftExpired: false,
      claimDraftAlreadyConfirmed: false,
      claimDraftWrongNpc: true,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("CLAIM_DRAFT_WRONG_NPC");
  });

  it("denies an already-confirmed claim draft", () => {
    const result = planTell({
      claimDraftExists: true,
      claimDraftExpired: false,
      claimDraftAlreadyConfirmed: true,
      claimDraftWrongNpc: false,
      ...EMPTY_BUNDLE,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("CLAIM_DRAFT_ALREADY_CONFIRMED");
  });

  it("requires external selection for a valid draft, planning no effects of its own", () => {
    const result = planTell({
      claimDraftExists: true,
      claimDraftExpired: false,
      claimDraftAlreadyConfirmed: false,
      claimDraftWrongNpc: false,
      ...EMPTY_BUNDLE,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
    if (isExternalSelectionRequired(result)) {
      expect(result.effects).toStrictEqual([]);
    }
  });
});

describe("planShow", () => {
  const baseShowInputs = {
    npcPresent: true,
    npcId: "npc-1",
    playerId: "player-1",
    alreadyRecordedEvidence: [],
    relationship: { trustScore: 0, suspicionScore: 0, revision: 3 },
    ...EMPTY_BUNDLE,
  };

  it("denies a Show when the NPC is not co-located", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
      npcPresent: false,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("NPC_NOT_PRESENT");
  });

  it("denies an item Show without holding the item", () => {
    const result = planShow({
      evidenceKind: "item",
      clueDiscoveredInTown: false,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
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
      clueClaimEffects: [{ clueId: "clue-1", claimId: "claim-1", signedWeight: 70 }],
      claimBeliefs: [{ claimId: "claim-1", exists: true, score: 10, revision: 2 }],
      relationshipReasons: [
        {
          reasonKind: "verified_testimony",
          claimId: "claim-1",
          clueId: "clue-1",
          sourceRootTransmissionId: "transmission-1",
        },
        { reasonKind: "evidence_presented", clueId: "clue-1" },
      ],
      ...baseShowInputs,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
    if (isExternalSelectionRequired(result)) {
      expect(result.effects).toHaveLength(6);
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
          rule_version: RULES_REGISTRY.rulesVersion,
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
      const relationshipInserts = result.effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "relationship_changes",
      );
      expect(relationshipInserts).toHaveLength(2);
      expect(relationshipInserts[0]).toMatchObject({
        row: {
          npc_id: "npc-1",
          player_id: "player-1",
          reason_kind: "verified_testimony",
          rule_version: RULES_REGISTRY.rulesVersion,
          claim_id: "claim-1",
          clue_id: "clue-1",
          source_root_transmission_id: "transmission-1",
        },
      });
      expect(relationshipInserts[1]).toMatchObject({
        row: {
          reason_kind: "evidence_presented",
          claim_id: null,
          clue_id: "clue-1",
        },
      });
      // ck_relationship_changes__shape leaves item_id/promise_id NULL for
      // both of these reasons, so the row must not carry them at all.
      expect(relationshipInserts[1]).not.toMatchObject({
        row: { item_id: expect.anything() },
      });
    }
  });

  it("advances the current relationship row by the summed, clamped deltas", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [
        {
          reasonKind: "verified_testimony",
          claimId: "claim-1",
          clueId: "clue-1",
          sourceRootTransmissionId: "transmission-1",
        },
        { reasonKind: "evidence_presented", clueId: "clue-1" },
      ],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      const relationshipChange = result.effects.find(
        (effect) =>
          effect.kind === "conditional_state_change" &&
          effect.table === "npc_player_relationships",
      );
      // trust 0 + 10 + 5, suspicion 0 - 5 - 5, against the row's own revision.
      expect(relationshipChange).toMatchObject({
        key: { npc_id: "npc-1", player_id: "player-1" },
        expectedRevision: 3,
        change: {
          trust_score: 15,
          suspicion_score: -10,
          updated_event_id: { $planRef: "evidence-shown" },
        },
      });
    }
  });

  it("clamps the relationship aggregate once rather than per reason", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [
        {
          reasonKind: "verified_testimony",
          claimId: "claim-1",
          clueId: "clue-1",
          sourceRootTransmissionId: "transmission-1",
        },
        { reasonKind: "evidence_presented", clueId: "clue-1" },
      ],
      ...baseShowInputs,
      relationship: { trustScore: 95, suspicionScore: -98, revision: 3 },
    });
    if (isExternalSelectionRequired(result)) {
      const relationshipChange = result.effects.find(
        (effect) =>
          effect.kind === "conditional_state_change" &&
          effect.table === "npc_player_relationships",
      );
      expect(relationshipChange).toMatchObject({
        change: { trust_score: 100, suspicion_score: -100 },
      });
    }
  });

  it("cites the claim and root transmission on a lie_established row, and no clue", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [
        {
          reasonKind: "lie_established",
          claimId: "claim-1",
          sourceRootTransmissionId: "transmission-1",
        },
      ],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      const relationshipInsert = result.effects.find(
        (effect) => effect.kind === "insert" && effect.table === "relationship_changes",
      );
      expect(relationshipInsert).toMatchObject({
        row: {
          reason_kind: "lie_established",
          claim_id: "claim-1",
          clue_id: null,
          source_root_transmission_id: "transmission-1",
          trust_delta: -30,
          suspicion_delta: 40,
        },
      });
    }
  });

  it("emits no relationship state change when the plan produced no reason", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      expect(
        result.effects.some(
          (effect) =>
            effect.kind === "conditional_state_change" &&
            effect.table === "npc_player_relationships",
        ),
      ).toBe(false);
    }
  });

  it("produces no belief effect when no shown clue is linked", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-unlinked"],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      expect(
        result.effects.some(
          (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
        ),
      ).toBe(false);
    }
  });

  it("inserts a first-ever npc_beliefs row instead of a guarded update when none exists yet", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-1"],
      clueClaimEffects: [{ clueId: "clue-1", claimId: "claim-1", signedWeight: 70 }],
      claimBeliefs: [{ claimId: "claim-1", exists: false, score: 0, revision: 0 }],
      relationshipReasons: [],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      const beliefEffect = result.effects.find(
        (effect) => "table" in effect && effect.table === "npc_beliefs",
      );
      expect(beliefEffect).toMatchObject({
        kind: "insert",
        row: { npc_id: "npc-1", claim_id: "claim-1", score: 70, label: "convinced" },
      });
    }
  });

  it("applies every link for a clue that affects multiple claims (guard_cart_ruts-style)", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-multi"],
      clueClaimEffects: [
        { clueId: "clue-multi", claimId: "claim-a", signedWeight: 70 },
        { clueId: "clue-multi", claimId: "claim-b", signedWeight: 70 },
        { clueId: "clue-multi", claimId: "claim-c", signedWeight: 70 },
      ],
      claimBeliefs: [
        { claimId: "claim-a", exists: true, score: 0, revision: 0 },
        { claimId: "claim-b", exists: true, score: 0, revision: 0 },
        { claimId: "claim-c", exists: true, score: 0, revision: 0 },
      ],
      relationshipReasons: [],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      const evidenceInserts = result.effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
      );
      expect(evidenceInserts).toHaveLength(3);
      const beliefChanges = result.effects.filter(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "npc_beliefs",
      );
      expect(beliefChanges).toHaveLength(3);
    }
  });

  it("classifies a negative-weight link as contradiction, not physical_clue", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-1"],
      clueClaimEffects: [{ clueId: "clue-1", claimId: "claim-1", signedWeight: -70 }],
      claimBeliefs: [{ claimId: "claim-1", exists: true, score: 0, revision: 0 }],
      relationshipReasons: [],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      const evidenceInsert = result.effects.find(
        (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
      );
      expect(evidenceInsert).toMatchObject({ row: { evidence_kind: "contradiction" } });
    }
  });

  it("skips already-recorded evidence instead of double-counting it", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-1"],
      clueClaimEffects: [{ clueId: "clue-1", claimId: "claim-1", signedWeight: 70 }],
      claimBeliefs: [{ claimId: "claim-1", exists: true, score: 10, revision: 2 }],
      relationshipReasons: [],
      ...baseShowInputs,
      alreadyRecordedEvidence: [{ claimId: "claim-1", clueId: "clue-1" }],
    });
    if (isExternalSelectionRequired(result)) {
      expect(
        result.effects.some(
          (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
        ),
      ).toBe(false);
      expect(
        result.effects.some(
          (effect) =>
            effect.kind === "conditional_state_change" &&
            effect.table === "npc_beliefs",
        ),
      ).toBe(false);
    }
  });

  it("clamps the summed score to 100 instead of letting it overflow the database constraint", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-1", "clue-2"],
      clueClaimEffects: [
        { clueId: "clue-1", claimId: "claim-1", signedWeight: 70 },
        { clueId: "clue-2", claimId: "claim-1", signedWeight: 70 },
      ],
      claimBeliefs: [{ claimId: "claim-1", exists: true, score: 80, revision: 2 }],
      relationshipReasons: [],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      const beliefChange = result.effects.find(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "npc_beliefs",
      );
      expect(beliefChange).toMatchObject({ change: { score: 100 } });
    }
  });

  it("reverses the discredited player's active contribution and folds a corroboration delta into the same belief recompute", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: ["clue-1"],
      clueClaimEffects: [{ clueId: "clue-1", claimId: "claim-1", signedWeight: -70 }],
      claimBeliefs: [{ claimId: "claim-1", exists: true, score: 40, revision: 5 }],
      relationshipReasons: [
        {
          reasonKind: "lie_established",
          claimId: "claim-1",
          sourceRootTransmissionId: "transmission-1",
        },
      ],
      sourceReversals: [
        {
          claimId: "claim-1",
          activeContributions: [{ evidenceId: "evidence-1", signedWeight: 35 }],
          priorIndependentSourceCount: 2,
          newIndependentSourceCount: 1,
        },
      ],
      ...baseShowInputs,
    });
    expect(isExternalSelectionRequired(result)).toBe(true);
    if (isExternalSelectionRequired(result)) {
      const reversalInsert = result.effects.find(
        (effect) =>
          effect.kind === "insert" &&
          effect.table === "belief_evidence" &&
          (effect.row as Record<string, unknown>)["evidence_kind"] === "source_reversal",
      );
      expect(reversalInsert).toMatchObject({
        row: {
          npc_id: "npc-1",
          claim_id: "claim-1",
          evidence_kind: "source_reversal",
          signed_weight: -35,
          reverses_evidence_id: "evidence-1",
        },
      });
      const corroborationInsert = result.effects.find(
        (effect) =>
          effect.kind === "insert" &&
          effect.table === "belief_evidence" &&
          (effect.row as Record<string, unknown>)["evidence_kind"] === "corroboration",
      );
      // 2 sources -> +15, 1 source -> +0: the delta is -15.
      expect(corroborationInsert).toMatchObject({
        row: { claim_id: "claim-1", evidence_kind: "corroboration", signed_weight: -15 },
      });
      const beliefChange = result.effects.find(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "npc_beliefs",
      );
      // 40 (contradicting link, -70) + (-35 reversal) + (-15 corroboration) clamped.
      expect(beliefChange).toMatchObject({
        key: { npc_id: "npc-1", claim_id: "claim-1" },
        expectedRevision: 5,
        change: { score: -80 },
      });
    }
  });

  it("skips the corroboration row when the reversal does not cross a threshold", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [{ claimId: "claim-1", exists: true, score: 0, revision: 0 }],
      relationshipReasons: [],
      sourceReversals: [
        {
          claimId: "claim-1",
          activeContributions: [{ evidenceId: "evidence-1", signedWeight: 35 }],
          priorIndependentSourceCount: 1,
          newIndependentSourceCount: 0,
        },
      ],
      ...baseShowInputs,
    });
    if (isExternalSelectionRequired(result)) {
      expect(
        result.effects.some(
          (effect) =>
            effect.kind === "insert" &&
            effect.table === "belief_evidence" &&
            (effect.row as Record<string, unknown>)["evidence_kind"] === "corroboration",
        ),
      ).toBe(false);
    }
  });

  it("grants Corin's capability when eligible and not already granted", () => {
    const result = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
      relationship: { trustScore: 40, suspicionScore: 10, revision: 1 },
      capabilityGrant: {
        capabilityKey: "enter_old_chapel",
        alreadyGranted: false,
        presentedRequiredClueThisAction: true,
      },
    });
    if (isExternalSelectionRequired(result)) {
      const grantInsert = result.effects.find(
        (effect) => effect.kind === "insert" && effect.table === "player_capabilities",
      );
      expect(grantInsert).toMatchObject({
        row: {
          player_id: "player-1",
          capability_key: "enter_old_chapel",
          status: "granted",
        },
      });
    }
  });

  it("does not grant a capability that is already granted, or when the gate is not met", () => {
    const alreadyGranted = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
      relationship: { trustScore: 40, suspicionScore: 10, revision: 1 },
      capabilityGrant: {
        capabilityKey: "enter_old_chapel",
        alreadyGranted: true,
        presentedRequiredClueThisAction: true,
      },
    });
    const gateNotMet = planShow({
      evidenceKind: "clue",
      clueDiscoveredInTown: true,
      itemCurrentlyHeldByPlayer: false,
      shownClueIds: [],
      clueClaimEffects: [],
      claimBeliefs: [],
      relationshipReasons: [],
      ...baseShowInputs,
      relationship: { trustScore: 10, suspicionScore: 10, revision: 1 },
      capabilityGrant: {
        capabilityKey: "enter_old_chapel",
        alreadyGranted: false,
        presentedRequiredClueThisAction: true,
      },
    });
    for (const result of [alreadyGranted, gateNotMet]) {
      if (isExternalSelectionRequired(result)) {
        expect(
          result.effects.some(
            (effect) => effect.kind === "insert" && effect.table === "player_capabilities",
          ),
        ).toBe(false);
      }
    }
  });
});

describe("planGive", () => {
  const baseGiveInputs = {
    itemId: "item-1",
    itemRevision: 4,
    recipientActorId: "npc-1",
    playerId: "player-1",
    itemTransferredEventId: "event-give-1",
    relationship: { trustScore: 20, suspicionScore: 10, revision: 6 },
    ...EMPTY_BUNDLE,
  };

  it("denies when the item is not held", () => {
    const result = planGive({
      npcPresent: true,
      itemHeldByPlayer: false,
      npcAcceptsItem: true,
      relationshipReasons: [],
      ...baseGiveInputs,
    });
    if (!isExternalSelectionRequired(result))
      expect(result.reasonCode).toBe("ITEM_NOT_HELD");
  });

  it("requires external selection and transfers custody to the recipient NPC against the item's real revision", () => {
    const result = planGive({
      npcPresent: true,
      itemHeldByPlayer: true,
      npcAcceptsItem: true,
      relationshipReasons: ["requested_item_given"],
      ...baseGiveInputs,
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
      const relationshipInsert = result.effects.find(
        (effect) => effect.kind === "insert" && effect.table === "relationship_changes",
      );
      expect(relationshipInsert).toMatchObject({
        row: {
          npc_id: "npc-1",
          player_id: "player-1",
          reason_kind: "requested_item_given",
          item_id: "item-1",
        },
      });
      const relationshipChange = result.effects.find(
        (effect) =>
          effect.kind === "conditional_state_change" &&
          effect.table === "npc_player_relationships",
      );
      expect(relationshipChange).toMatchObject({
        key: { npc_id: "npc-1", player_id: "player-1" },
        expectedRevision: 6,
        change: {
          trust_score: 35,
          suspicion_score: 5,
          updated_event_id: "event-give-1",
        },
      });
    }
  });

  it("requires external selection with no custody effect when the NPC declines", () => {
    const result = planGive({
      npcPresent: true,
      itemHeldByPlayer: true,
      npcAcceptsItem: false,
      relationshipReasons: [],
      ...baseGiveInputs,
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
