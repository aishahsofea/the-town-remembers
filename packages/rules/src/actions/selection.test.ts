import { describe, expect, it } from "vitest";

import type { ApprovedDisclosure } from "../disclosure/bundle.js";
import { encodePromiseOffer } from "../world/promises.js";
import {
  applyAskSelection,
  applyTellSelection,
  buildAskPromiseOffers,
  type ApplyTellSelectionInputs,
  type TellClaimIdentity,
} from "./selection.js";

const direct: ApprovedDisclosure = {
  claimId: "claim-direct",
  stance: "believed",
  sourceEpisodeId: "source-episode",
  parentTransmissionId: null,
  tier: "public",
  permittedEntityIds: [],
};

const hearsay: ApprovedDisclosure = {
  claimId: "claim-hearsay",
  stance: "hearsay",
  sourceEpisodeId: "heard-episode",
  parentTransmissionId: "parent-transmission",
  tier: "guarded",
  permittedEntityIds: [],
};

function plan(disclosures: readonly ApprovedDisclosure[]) {
  return applyAskSelection({
    actionId: "action",
    visitId: "visit",
    playerId: "player",
    npcId: "npc",
    npcCharacterEntityId: "npc-character",
    locationEntityId: "location",
    question: "What happened?",
    occurredAt: new Date("2026-01-02T03:04:05.000Z"),
    selection: {
      npcId: "npc",
      text: "I can tell you what I observed.",
      responseMode: "selected",
      expressedDisclosures: disclosures,
    },
    parentTransmissionById: new Map([
      ["parent-transmission", { rootTransmissionId: "root-transmission", hopCount: 2 }],
    ]),
  });
}

describe("applyAskSelection", () => {
  it("creates no transmission or board card when no disclosure was expressed", () => {
    const effects = plan([]);
    expect(
      effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "claim_transmissions",
      ),
    ).toHaveLength(0);
    expect(
      effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
      ),
    ).toHaveLength(0);
    expect(
      effects.some(
        (effect) => effect.kind === "insert" && effect.table === "npc_interactions",
      ),
    ).toBe(true);
    expect(
      effects.some((effect) => effect.kind === "insert" && effect.table === "episodes"),
    ).toBe(true);
  });

  it("projects direct testimony and repeated hearsay in rendering order", () => {
    const effects = plan([direct, hearsay]);
    const transmissions = effects.filter(
      (effect) => effect.kind === "insert" && effect.table === "claim_transmissions",
    );
    expect(transmissions).toHaveLength(2);
    expect(transmissions[0]).toMatchObject({
      ref: "ask-transmission-0",
      row: {
        claim_id: "claim-direct",
        source_kind: "direct_observation",
        source_episode_id: "source-episode",
        parent_transmission_id: null,
        root_transmission_id: { $planRef: "ask-transmission-0" },
        hop_count: 0,
        ordinal: 0,
      },
    });
    expect(transmissions[1]).toMatchObject({
      ref: "ask-transmission-1",
      row: {
        claim_id: "claim-hearsay",
        source_kind: "repeated_testimony",
        source_episode_id: null,
        parent_transmission_id: "parent-transmission",
        root_transmission_id: "root-transmission",
        hop_count: 3,
        ordinal: 1,
      },
    });

    const cards = effects.filter(
      (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
    );
    expect(cards).toMatchObject([
      {
        row: {
          entry_kind: "testimony",
          verification_status: "attributed_testimony",
          transmission_id: { $planRef: "ask-transmission-0" },
        },
      },
      {
        row: {
          entry_kind: "hearsay",
          verification_status: "attributed_hearsay",
          transmission_id: { $planRef: "ask-transmission-1" },
        },
      },
    ]);
  });

  it("does not create a public board card for a confidential disclosure", () => {
    const effects = plan([{ ...direct, tier: "confidential" }]);
    expect(
      effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "claim_transmissions",
      ),
    ).toHaveLength(1);
    expect(
      effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
      ),
    ).toHaveLength(0);
  });

  it("fails closed on an unsourced disclosure instead of inventing provenance", () => {
    const effects = plan([
      { ...direct, sourceEpisodeId: null, parentTransmissionId: null },
    ]);
    expect(
      effects.filter(
        (effect) => effect.kind === "insert" && effect.table === "claim_transmissions",
      ),
    ).toHaveLength(0);
  });
});

describe("buildAskPromiseOffers", () => {
  const selection = {
    npcId: "npc",
    text: "I can tell you what I observed.",
    responseMode: "selected" as const,
    expressedDisclosures: [] as readonly ApprovedDisclosure[],
  };

  it("emits Nessa's stable key offer only while every current gate passes", () => {
    const eligibleState = {
      npcKey: "nessa_reed",
      trust: 40,
      suspicion: 39,
      bellRevealed: false,
      activePromises: [],
      oldChapelKey: {
        itemId: "key",
        displayName: "Old Chapel Key",
        heldByActorId: "npc",
      },
      larkDamageClaim: undefined,
    };
    expect(buildAskPromiseOffers("action", "npc", eligibleState, selection)).toEqual([
      {
        offerId: encodePromiseOffer("action", 0),
        sourceActionId: "action",
        ordinal: 0,
        npcId: "npc",
        kind: "return_item",
        termsVersion: "return-chapel-key-v1",
        summary:
          "I will lend you the Old Chapel key if you promise to return it to me.",
        subject: {
          kind: "item",
          itemId: "key",
          displayName: "Old Chapel Key",
        },
      },
    ]);
    expect(
      buildAskPromiseOffers(
        "action",
        "npc",
        {
          ...eligibleState,
          activePromises: [
            { npcId: "npc", kind: "return_item", protectedItemId: "key" },
          ],
        },
        selection,
      ),
    ).toEqual([]);
    expect(
      buildAskPromiseOffers(
        "action",
        "npc",
        { ...eligibleState, bellRevealed: true },
        selection,
      ),
    ).toEqual([]);
  });

  it("attaches Mara's secrecy offer only to the first selected confidential disclosure", () => {
    const confidential: ApprovedDisclosure = {
      ...direct,
      claimId: "lark-claim",
      tier: "confidential",
    };
    const state = {
      npcKey: "mara_venn",
      trust: 40,
      suspicion: 0,
      bellRevealed: false,
      activePromises: [],
      oldChapelKey: undefined,
      larkDamageClaim: {
        claimId: "lark-claim",
        text: "Lark Venn damaged the Festival Bell.",
        previouslyDisclosedToPlayer: false,
      },
    };
    const selected = { ...selection, expressedDisclosures: [confidential] };
    expect(buildAskPromiseOffers("action", "npc", state, selected)).toMatchObject([
      {
        offerId: encodePromiseOffer("action", 0),
        sourceActionId: "action",
        ordinal: 0,
        npcId: "npc",
        kind: "keep_secret",
        termsVersion: "keep-lark-accident-secret-v1",
        subject: { kind: "claim", claimId: "lark-claim" },
      },
    ]);
    expect(
      buildAskPromiseOffers(
        "action",
        "npc",
        {
          ...state,
          larkDamageClaim: {
            ...state.larkDamageClaim,
            previouslyDisclosedToPlayer: true,
          },
        },
        selected,
      ),
    ).toEqual([]);
    expect(buildAskPromiseOffers("action", "npc", state, selection)).toEqual([]);
  });
});

describe("applyTellSelection", () => {
  const existingClaim: TellClaimIdentity = {
    exists: true,
    claimId: "claim-existing",
    subjectEntityId: "subject-entity",
    subjectEntityType: "character",
    predicate: "was_at",
    objectEntityId: "object-entity",
    objectEntityType: "location",
    polarity: "positive",
    contextKey: "festival_night",
    normalizedKey: "normalized-key-existing",
  };

  const newClaim: TellClaimIdentity = {
    ...existingClaim,
    exists: false,
    claimId: undefined,
    normalizedKey: "normalized-key-new",
  };

  function baseInputs(
    overrides: Partial<ApplyTellSelectionInputs> = {},
  ): ApplyTellSelectionInputs {
    return {
      actionId: "action",
      visitId: "visit",
      playerId: "player",
      npcId: "npc",
      npcCharacterEntityId: "npc-character",
      locationEntityId: "location",
      occurredAt: new Date("2026-01-02T03:04:05.000Z"),
      selection: { npcId: "npc", text: "I heard you.", responseMode: "fallback" },
      draftId: "draft",
      claim: existingClaim,
      canonicalText: "Corin Hale was at The Lantern Inn (on festival night).",
      allegedSourceActorId: null,
      playerTrust: 0,
      isRepeatContribution: false,
      priorIndependentSourceCount: 0,
      newIndependentSourceCount: 1,
      relatedClaims: [],
      newRelations: [],
      backfillEvidence: [],
      beliefStates: [],
      brokenPromises: [],
      ...overrides,
    };
  }

  function insertsFor(effects: ReturnType<typeof applyTellSelection>, table: string) {
    return effects.filter(
      (effect) => effect.kind === "insert" && effect.table === table,
    );
  }

  it("always creates the interaction, transmission, episode, and draft confirmation", () => {
    const effects = applyTellSelection(baseInputs());
    expect(effects[0]).toMatchObject({
      kind: "event_origin",
      eventType: "claim_transmitted",
    });
    expect(insertsFor(effects, "npc_interactions")).toHaveLength(1);
    expect(insertsFor(effects, "claim_transmissions")).toMatchObject([
      {
        ref: "tell-transmission",
        row: {
          claim_id: "claim-existing",
          speaker_actor_id: "player",
          recipient_actor_id: "npc",
          recipient_actor_type: "npc",
          parent_transmission_id: null,
          root_transmission_id: { $planRef: "tell-transmission" },
          alleged_source_actor_id: null,
          source_kind: "original_assertion",
          hop_count: 0,
          interaction_id: { $planRef: "tell-interaction" },
        },
      },
    ]);
    expect(insertsFor(effects, "episodes")).toMatchObject([
      { row: { episode_kind: "heard_claim", npc_id: "npc" } },
    ]);
    const draftUpdate = effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "claim_drafts",
    );
    expect(draftUpdate).toMatchObject({
      key: { id: "draft", status: "pending" },
      change: { status: "confirmed", confirmed_by_action_id: "action" },
    });
  });

  it("never inserts a `claims` row when the draft's claim already exists", () => {
    const effects = applyTellSelection(baseInputs());
    expect(insertsFor(effects, "claims")).toHaveLength(0);
  });

  it("cannot mutate objective truth or custody when a claim is asserted", () => {
    const effects = applyTellSelection(baseInputs());
    const forbiddenTables = new Set(["items", "world_facts", "case_solutions"]);
    expect(
      effects.filter(
        (effect) =>
          (effect.kind === "insert" || effect.kind === "conditional_state_change") &&
          forbiddenTables.has(effect.table),
      ),
    ).toStrictEqual([]);
  });

  it("inserts a new `claims` row, referenced by every dependent effect, for a never-before-told claim", () => {
    const effects = applyTellSelection(baseInputs({ claim: newClaim }));
    expect(insertsFor(effects, "claims")).toMatchObject([
      { ref: "tell-claim", row: { normalized_key: "normalized-key-new" } },
    ]);
    expect(insertsFor(effects, "claim_transmissions")).toMatchObject([
      { row: { claim_id: { $planRef: "tell-claim" } } },
    ]);
    const beliefInsert = effects.find(
      (effect) => effect.kind === "insert" && effect.table === "npc_beliefs",
    );
    expect(beliefInsert).toMatchObject({
      row: { claim_id: { $planRef: "tell-claim" }, npc_id: "npc" },
    });
  });

  it("marks alleged hearsay with hop_count 1 and the named source", () => {
    const effects = applyTellSelection(
      baseInputs({ allegedSourceActorId: "npc-corin" }),
    );
    expect(insertsFor(effects, "claim_transmissions")).toMatchObject([
      {
        row: {
          source_kind: "alleged_hearsay",
          alleged_source_actor_id: "npc-corin",
          hop_count: 1,
        },
      },
    ]);
  });

  it("adds no evidence or belief effect for a repeat contribution from the same player", () => {
    const effects = applyTellSelection(
      baseInputs({
        isRepeatContribution: true,
        beliefStates: [
          { claimId: "claim-existing", exists: true, score: 40, revision: 2 },
        ],
      }),
    );
    expect(insertsFor(effects, "belief_evidence")).toHaveLength(0);
    expect(
      effects.filter(
        (effect) =>
          (effect.kind === "insert" || effect.kind === "conditional_state_change") &&
          effect.table === "npc_beliefs",
      ),
    ).toHaveLength(0);
    // The communication itself is unaffected by repeat protection.
    expect(insertsFor(effects, "claim_transmissions")).toHaveLength(1);
    expect(insertsFor(effects, "npc_interactions")).toHaveLength(1);
  });

  it("inserts the primary testimony evidence and updates an existing belief row", () => {
    const effects = applyTellSelection(
      baseInputs({
        playerTrust: 50,
        beliefStates: [
          { claimId: "claim-existing", exists: true, score: 10, revision: 3 },
        ],
      }),
    );
    const primary = effects.find(
      (effect) => effect.kind === "insert" && effect.table === "belief_evidence",
    );
    expect(primary).toMatchObject({
      ref: "tell-primary-evidence",
      row: {
        npc_id: "npc",
        claim_id: "claim-existing",
        independent_source_actor_id: "player",
        evidence_kind: "player_testimony",
        trust_snapshot: 50,
        hop_count: 0,
      },
    });
    const beliefUpdate = effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "npc_beliefs",
    );
    expect(beliefUpdate).toMatchObject({
      key: { npc_id: "npc", claim_id: "claim-existing" },
      expectedRevision: 3,
    });
  });

  it("inserts the first-ever belief row for a claim with no prior npc_beliefs row", () => {
    const effects = applyTellSelection(
      baseInputs({ playerTrust: 20, beliefStates: [] }),
    );
    const beliefInsert = effects.find(
      (effect) => effect.kind === "insert" && effect.table === "npc_beliefs",
    );
    expect(beliefInsert).toMatchObject({
      row: { npc_id: "npc", claim_id: "claim-existing" },
    });
  });

  it("mirrors a contradiction onto the related claim with the opposite weight, and updates its belief", () => {
    const effects = applyTellSelection(
      baseInputs({
        playerTrust: 100,
        relatedClaims: [{ claimId: "claim-contradicts", relationKind: "contradicts" }],
        beliefStates: [
          { claimId: "claim-existing", exists: true, score: 0, revision: 0 },
          { claimId: "claim-contradicts", exists: true, score: 0, revision: 0 },
        ],
      }),
    );
    const primaryEvidence = effects.find(
      (effect) =>
        effect.kind === "insert" &&
        effect.table === "belief_evidence" &&
        effect.ref === "tell-primary-evidence",
    );
    expect(primaryEvidence).toBeDefined();
    const primaryWeight = (
      primaryEvidence as unknown as { readonly row: { readonly signed_weight: number } }
    ).row.signed_weight;

    const mirror = effects.find(
      (effect) =>
        effect.kind === "insert" &&
        effect.table === "belief_evidence" &&
        effect.ref === undefined &&
        (effect as unknown as { readonly row: { readonly claim_id: string } }).row
          .claim_id === "claim-contradicts",
    );
    expect(mirror).toMatchObject({
      row: {
        evidence_kind: "contradiction",
        signed_weight: -primaryWeight,
        mirrors_evidence_id: { $planRef: "tell-primary-evidence" },
      },
    });

    const mirrorBeliefUpdate = effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" &&
        effect.table === "npc_beliefs" &&
        (effect as unknown as { readonly key: { readonly claim_id: string } }).key
          .claim_id === "claim-contradicts",
    );
    expect(mirrorBeliefUpdate).toMatchObject({
      change: { score: -primaryWeight },
    });
  });

  it("adds a corroboration row only when the independent-source count crosses a threshold", () => {
    const noCorroboration = applyTellSelection(
      baseInputs({ priorIndependentSourceCount: 0, newIndependentSourceCount: 1 }),
    );
    expect(
      noCorroboration.filter(
        (effect) =>
          effect.kind === "insert" &&
          effect.table === "belief_evidence" &&
          (effect as unknown as { readonly row: { readonly evidence_kind: string } })
            .row.evidence_kind === "corroboration",
      ),
    ).toHaveLength(0);

    const withCorroboration = applyTellSelection(
      baseInputs({ priorIndependentSourceCount: 1, newIndependentSourceCount: 2 }),
    );
    const corroboration = withCorroboration.find(
      (effect) =>
        effect.kind === "insert" &&
        effect.table === "belief_evidence" &&
        (effect as unknown as { readonly row: { readonly evidence_kind: string } }).row
          .evidence_kind === "corroboration",
    );
    expect(corroboration).toMatchObject({
      row: { corroboration_threshold: 2, independent_source_actor_id: "player" },
    });
  });

  it("creates both deterministic relation directions and backfills older support for a new claim", () => {
    const effects = applyTellSelection(
      baseInputs({
        claim: newClaim,
        relatedClaims: [{ claimId: "claim-chapel", relationKind: "contradicts" }],
        newRelations: [{ claimId: "claim-chapel", relationKind: "contradicts" }],
        backfillEvidence: [
          {
            evidenceId: "evidence-chapel",
            npcId: "npc",
            sourceClaimId: "claim-chapel",
            signedWeight: 70,
          },
        ],
      }),
    );

    expect(insertsFor(effects, "claim_relations")).toMatchObject([
      {
        row: {
          claim_a_id: { $planRef: "tell-claim" },
          claim_b_id: "claim-chapel",
          relation_kind: "contradicts",
        },
      },
      {
        row: {
          claim_a_id: "claim-chapel",
          claim_b_id: { $planRef: "tell-claim" },
          relation_kind: "contradicts",
        },
      },
    ]);
    expect(insertsFor(effects, "belief_evidence")).toContainEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          claim_id: { $planRef: "tell-claim" },
          signed_weight: -70,
          mirrors_evidence_id: "evidence-chapel",
        }),
      }),
    );
    expect(insertsFor(effects, "npc_beliefs")).toContainEqual(
      expect.objectContaining({
        row: expect.objectContaining({
          npc_id: "npc",
          claim_id: { $planRef: "tell-claim" },
          score: -35,
          label: "doubtful",
        }),
      }),
    );
  });

  it("breaks a matching secrecy promise and applies its grievance relationship delta", () => {
    const effects = applyTellSelection(
      baseInputs({
        brokenPromises: [
          {
            promiseId: "promise-secret",
            npcId: "npc-mara",
            relationship: {
              npcId: "npc-mara",
              playerId: "player",
              trustScore: 10,
              suspicionScore: 5,
              revision: 2,
            },
          },
        ],
      }),
    );

    expect(effects).toContainEqual(
      expect.objectContaining({
        kind: "event_origin",
        eventType: "promise_broken",
        metadata: expect.objectContaining({ promiseId: "promise-secret" }),
      }),
    );
    expect(effects).toContainEqual(
      expect.objectContaining({
        kind: "conditional_state_change",
        table: "promises",
        key: { id: "promise-secret", status: "active" },
        change: expect.objectContaining({
          status: "broken",
          resolved_event_id: { $planRef: "tell-promise-broken-0" },
        }),
      }),
    );
    expect(effects).toContainEqual(
      expect.objectContaining({
        kind: "conditional_state_change",
        table: "npc_player_relationships",
        expectedRevision: 2,
        change: expect.objectContaining({ trust_score: -30, suspicion_score: 40 }),
      }),
    );
  });
});
