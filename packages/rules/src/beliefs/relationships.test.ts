import { describe, expect, it } from "vitest";

import {
  applicableReasonKindsForShow,
  hasGrievance,
  isGrievanceReason,
  isRepeatRelationshipContribution,
  relationshipDeltaFor,
  stanceFor,
  sumRelationshipDeltas,
  type GrievanceRecord,
} from "./relationships.js";

describe("relationshipDeltaFor", () => {
  it.each([
    ["verified_testimony", { trust: 10, suspicion: -5 }],
    ["evidence_presented", { trust: 5, suspicion: -5 }],
    ["requested_item_given", { trust: 15, suspicion: -5 }],
    ["promise_fulfilled", { trust: 25, suspicion: -15 }],
    ["lie_established", { trust: -30, suspicion: 40 }],
    ["promise_broken", { trust: -40, suspicion: 35 }],
  ] as const)("names the exact delta for %s", (reasonKind, expected) => {
    expect(relationshipDeltaFor(reasonKind)).toStrictEqual(expected);
  });
});

describe("worked example #6: three stacked verifying Shows from neutral", () => {
  it("produces exactly trust +45, suspicion -30, crossing the trust-40 gate", () => {
    const oneShow = applicableReasonKindsForShow({
      verifiesEarlierTestimony: true,
      presentsRelevantClue: true,
      establishesLie: false,
    });
    expect(oneShow).toStrictEqual(["verified_testimony", "evidence_presented"]);
    expect(sumRelationshipDeltas(oneShow)).toStrictEqual({ trust: 15, suspicion: -10 });

    const threeShows = [...oneShow, ...oneShow, ...oneShow];
    const total = sumRelationshipDeltas(threeShows);
    expect(total).toStrictEqual({ trust: 45, suspicion: -30 });
    expect(stanceFor(0 + total.trust, 0 + total.suspicion)).toBe("trusting");
  });
});

describe("worked example #7: one broken promise from neutral", () => {
  it("produces exactly trust -40, suspicion +35 (wary)", () => {
    const delta = relationshipDeltaFor("promise_broken");
    expect(delta).toStrictEqual({ trust: -40, suspicion: 35 });
    expect(stanceFor(0 + delta.trust, 0 + delta.suspicion)).toBe("wary");
  });

  it("the promise-history grievance blocks the confidential gate independently of later trust recovery", () => {
    const grievances: readonly GrievanceRecord[] = [
      { npcId: "npc-1", playerId: "player-1", kind: "promise_broken" },
    ];
    // Even after trust recovers far past the confidential threshold, the
    // grievance itself is still present — recall/disclosure gates consult
    // this, not the current trust score.
    expect(hasGrievance(grievances, "npc-1", "player-1", "promise_broken")).toBe(true);
    expect(stanceFor(60, 0)).toBe("trusting");
  });
});

describe("stanceFor precedence", () => {
  it("checks suspicion unconditionally first", () => {
    expect(stanceFor(90, 40)).toBe("suspicious");
  });

  it.each([
    [39, "trusting"],
    [40, "suspicious"],
  ] as const)("suspicion boundary at %i", (suspicion, expected) => {
    expect(stanceFor(90, suspicion)).toBe(expected);
  });

  it.each([
    [39, "neutral"],
    [40, "trusting"],
  ] as const)("trust-trusting boundary at %i", (trust, expected) => {
    expect(stanceFor(trust, 0)).toBe(expected);
  });

  it.each([
    [-19, "neutral"],
    [-20, "wary"],
  ] as const)("trust-wary boundary at %i", (trust, expected) => {
    expect(stanceFor(trust, 0)).toBe(expected);
  });

  it("is neutral at the exact origin", () => {
    expect(stanceFor(0, 0)).toBe("neutral");
  });
});

describe("applicableReasonKindsForShow exclusivity", () => {
  it("applies only lie_established even when the Show also verifies and presents evidence", () => {
    expect(
      applicableReasonKindsForShow({
        verifiesEarlierTestimony: true,
        presentsRelevantClue: true,
        establishesLie: true,
      }),
    ).toStrictEqual(["lie_established"]);
  });

  it("applies neither positive reason when neither condition holds", () => {
    expect(
      applicableReasonKindsForShow({
        verifiesEarlierTestimony: false,
        presentsRelevantClue: false,
        establishesLie: false,
      }),
    ).toStrictEqual([]);
  });
});

describe("isRepeatRelationshipContribution", () => {
  it("scopes verified_testimony and lie_established by (npc, player, claim)", () => {
    const existing = [
      {
        reasonKind: "verified_testimony" as const,
        npcId: "n1",
        playerId: "p1",
        claimId: "c1",
      },
    ];
    expect(
      isRepeatRelationshipContribution(existing, {
        reasonKind: "verified_testimony",
        npcId: "n1",
        playerId: "p1",
        claimId: "c1",
      }),
    ).toBe(true);
    expect(
      isRepeatRelationshipContribution(existing, {
        reasonKind: "verified_testimony",
        npcId: "n1",
        playerId: "p1",
        claimId: "c2",
      }),
    ).toBe(false);
  });

  it("scopes evidence_presented by (npc, player, clue)", () => {
    const existing = [
      {
        reasonKind: "evidence_presented" as const,
        npcId: "n1",
        playerId: "p1",
        clueId: "clue-1",
      },
    ];
    expect(
      isRepeatRelationshipContribution(existing, {
        reasonKind: "evidence_presented",
        npcId: "n1",
        playerId: "p1",
        clueId: "clue-1",
      }),
    ).toBe(true);
  });

  it("scopes requested_item_given by (npc, player, authored request-item pair)", () => {
    const existing = [
      {
        reasonKind: "requested_item_given" as const,
        npcId: "n1",
        playerId: "p1",
        requestItemKey: "old_chapel_key",
      },
    ];
    expect(
      isRepeatRelationshipContribution(existing, {
        reasonKind: "requested_item_given",
        npcId: "n1",
        playerId: "p1",
        requestItemKey: "old_chapel_key",
      }),
    ).toBe(true);
  });

  it("scopes promise consequences by promise ID alone, guaranteed by terminal state", () => {
    const existing = [
      {
        reasonKind: "promise_fulfilled" as const,
        npcId: "n1",
        playerId: "p1",
        promiseId: "pr-1",
      },
    ];
    expect(
      isRepeatRelationshipContribution(existing, {
        reasonKind: "promise_fulfilled",
        npcId: "n2",
        playerId: "p2",
        promiseId: "pr-1",
      }),
    ).toBe(true);
  });
});

describe("grievances", () => {
  it("classifies exactly promise_broken and lie_established as grievances", () => {
    expect(isGrievanceReason("promise_broken")).toBe(true);
    expect(isGrievanceReason("lie_established")).toBe(true);
    expect(isGrievanceReason("verified_testimony")).toBe(false);
    expect(isGrievanceReason("evidence_presented")).toBe(false);
    expect(isGrievanceReason("requested_item_given")).toBe(false);
    expect(isGrievanceReason("promise_fulfilled")).toBe(false);
  });

  it("hasGrievance can check any kind or a specific one", () => {
    const grievances: readonly GrievanceRecord[] = [
      { npcId: "n1", playerId: "p1", kind: "lie_established" },
    ];
    expect(hasGrievance(grievances, "n1", "p1")).toBe(true);
    expect(hasGrievance(grievances, "n1", "p1", "promise_broken")).toBe(false);
    expect(hasGrievance(grievances, "n2", "p1")).toBe(false);
  });
});
