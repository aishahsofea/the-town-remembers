import { describe, expect, it } from "vitest";

import {
  classifyInspectDiscovery,
  corinCapabilityGrantEligible,
  custodyFor,
  firstDiscoverer,
  hasChapelAccess,
  isShowAuthorized,
  nessaKeyLoanEligible,
  planGiveCustody,
  planShowStructuredEffect,
  shouldRecordClueDiscovery,
} from "./clues.js";

describe("classifyInspectDiscovery", () => {
  it("returns none when there is no inspectable or no clue", () => {
    expect(
      classifyInspectDiscovery({
        hasInspectable: false,
        hasClue: false,
        clueAlreadyDiscoveredInTown: false,
        clueAlreadyDiscoveredByThisPlayer: false,
      }),
    ).toBe("none");
    expect(
      classifyInspectDiscovery({
        hasInspectable: true,
        hasClue: false,
        clueAlreadyDiscoveredInTown: false,
        clueAlreadyDiscoveredByThisPlayer: false,
      }),
    ).toBe("none");
  });

  it("returns new_to_town for the town's first discovery of a clue", () => {
    expect(
      classifyInspectDiscovery({
        hasInspectable: true,
        hasClue: true,
        clueAlreadyDiscoveredInTown: false,
        clueAlreadyDiscoveredByThisPlayer: false,
      }),
    ).toBe("new_to_town");
  });

  it("returns new_to_player when another player already found it", () => {
    expect(
      classifyInspectDiscovery({
        hasInspectable: true,
        hasClue: true,
        clueAlreadyDiscoveredInTown: true,
        clueAlreadyDiscoveredByThisPlayer: false,
      }),
    ).toBe("new_to_player");
  });

  it("returns already_discovered_by_player on a repeat inspection", () => {
    expect(
      classifyInspectDiscovery({
        hasInspectable: true,
        hasClue: true,
        clueAlreadyDiscoveredInTown: true,
        clueAlreadyDiscoveredByThisPlayer: true,
      }),
    ).toBe("already_discovered_by_player");
  });
});

describe("shouldRecordClueDiscovery", () => {
  it("records only a genuinely new-to-this-player discovery", () => {
    expect(shouldRecordClueDiscovery("new_to_town")).toBe(true);
    expect(shouldRecordClueDiscovery("new_to_player")).toBe(true);
    expect(shouldRecordClueDiscovery("already_discovered_by_player")).toBe(false);
    expect(shouldRecordClueDiscovery("none")).toBe(false);
  });
});

describe("firstDiscoverer", () => {
  it("picks the lowest discovery sequence, regardless of input order", () => {
    const discoveries = [
      { playerId: "p2", discoverySequence: 5 },
      { playerId: "p1", discoverySequence: 2 },
      { playerId: "p3", discoverySequence: 9 },
    ];
    expect(firstDiscoverer(discoveries)?.playerId).toBe("p1");
  });

  it("returns undefined for no discoveries", () => {
    expect(firstDiscoverer([])).toBeUndefined();
  });
});

describe("custodyFor", () => {
  it("reports player_inventory when an actor holds it", () => {
    expect(
      custodyFor({ heldByActorId: "player-1", locationEntityId: null }),
    ).toStrictEqual({
      kind: "player_inventory",
    });
  });

  it("reports location custody when nobody holds it", () => {
    expect(
      custodyFor({ heldByActorId: null, locationEntityId: "old_chapel" }),
    ).toStrictEqual({ kind: "location", locationId: "old_chapel" });
  });
});

describe("isShowAuthorized", () => {
  it("authorizes a clue only when town-discovered", () => {
    expect(
      isShowAuthorized("clue", {
        clueDiscoveredInTown: true,
        itemCurrentlyHeldByPlayer: false,
      }),
    ).toBe(true);
    expect(
      isShowAuthorized("clue", {
        clueDiscoveredInTown: false,
        itemCurrentlyHeldByPlayer: true,
      }),
    ).toBe(false);
  });

  it("authorizes an item only when currently held", () => {
    expect(
      isShowAuthorized("item", {
        clueDiscoveredInTown: true,
        itemCurrentlyHeldByPlayer: false,
      }),
    ).toBe(false);
    expect(
      isShowAuthorized("item", {
        clueDiscoveredInTown: false,
        itemCurrentlyHeldByPlayer: true,
      }),
    ).toBe(true);
  });
});

describe("planShowStructuredEffect", () => {
  it("applies only clues with real clue_claim_effects linkage, sorted and deduplicated", () => {
    const plan = planShowStructuredEffect(
      ["clue-b", "clue-a", "clue-b", "clue-unlinked"],
      [
        { clueId: "clue-a", claimId: "claim-1" },
        { clueId: "clue-b", claimId: "claim-2" },
      ],
    );
    expect(plan).toStrictEqual({
      structuredEffect: "applied",
      appliedClueIds: ["clue-a", "clue-b"],
    });
  });

  it("is none with an empty appliedClueIds array when no clue is linked", () => {
    expect(planShowStructuredEffect(["clue-x"], [])).toStrictEqual({
      structuredEffect: "none",
      appliedClueIds: [],
    });
  });
});

describe("planGiveCustody", () => {
  it("transfers only when held by the player and the NPC accepts it", () => {
    expect(planGiveCustody({ itemHeldByPlayer: true, npcAcceptsItem: true })).toBe(
      "transferred",
    );
    expect(planGiveCustody({ itemHeldByPlayer: true, npcAcceptsItem: false })).toBe(
      "unchanged",
    );
    expect(planGiveCustody({ itemHeldByPlayer: false, npcAcceptsItem: true })).toBe(
      "unchanged",
    );
  });
});

describe("chapel access (Decision 009)", () => {
  it("either the key or the capability suffices", () => {
    expect(hasChapelAccess(true, false)).toBe(true);
    expect(hasChapelAccess(false, true)).toBe(true);
    expect(hasChapelAccess(false, false)).toBe(false);
    expect(hasChapelAccess(true, true)).toBe(true);
  });

  it("Nessa's route requires trust >= 40 and suspicion < 40", () => {
    expect(nessaKeyLoanEligible(40, 39)).toBe(true);
    expect(nessaKeyLoanEligible(39, 0)).toBe(false);
    expect(nessaKeyLoanEligible(40, 40)).toBe(false);
  });

  it("Corin's route requires presenting a required clue and post-action trust >= 40, suspicion < 20", () => {
    expect(corinCapabilityGrantEligible(true, 40, 19)).toBe(true);
    expect(corinCapabilityGrantEligible(false, 100, -100)).toBe(false);
    expect(corinCapabilityGrantEligible(true, 39, 0)).toBe(false);
    expect(corinCapabilityGrantEligible(true, 40, 20)).toBe(false);
  });

  it("the asymmetric suspicion ceiling is intentional: 39 clears Nessa's gate but not Corin's", () => {
    expect(nessaKeyLoanEligible(40, 39)).toBe(true);
    expect(corinCapabilityGrantEligible(true, 40, 39)).toBe(false);
  });

  it("access from a granted capability never depends on live trust (permanent once issued)", () => {
    // hasChapelAccess takes no trust/suspicion parameter at all: nothing in
    // this module can re-lock the door once the capability exists.
    expect(hasChapelAccess(false, true)).toBe(true);
  });
});
