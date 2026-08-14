import { describe, expect, it } from "vitest";

import type { ApprovedDisclosure } from "../disclosure/bundle.js";
import { encodePromiseOffer } from "../world/promises.js";
import { applyAskSelection, buildAskPromiseOffers } from "./selection.js";

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
