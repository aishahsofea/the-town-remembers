import { describe, expect, it } from "vitest";

import {
  aggregateRelationshipUpdates,
  applicableReasonKindsForShow,
  hasGrievance,
  isGrievanceReason,
  isRepeatRelationshipContribution,
  relationshipDeltaFor,
  RelationshipSnapshotMismatchError,
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

describe("aggregateRelationshipUpdates", () => {
  const neutral = {
    npcId: "npc-1",
    playerId: "player-1",
    trustScore: 0,
    suspicionScore: 0,
    revision: 4,
  };

  it("sums one event's reasons against the snapshot and carries its revision", () => {
    expect(
      aggregateRelationshipUpdates(
        [neutral],
        [
          { npcId: "npc-1", playerId: "player-1", reasonKind: "verified_testimony" },
          { npcId: "npc-1", playerId: "player-1", reasonKind: "evidence_presented" },
        ],
      ),
    ).toStrictEqual([
      {
        npcId: "npc-1",
        playerId: "player-1",
        expectedRevision: 4,
        trustScore: 15,
        suspicionScore: -10,
      },
    ]);
  });

  it("clamps the total once, not each contribution", () => {
    // Clamping per contribution would stop at 100 after the first reason and
    // then subtract nothing; clamping once keeps the arithmetic honest.
    const [aggregate] = aggregateRelationshipUpdates(
      [{ ...neutral, trustScore: 95 }],
      [
        { npcId: "npc-1", playerId: "player-1", reasonKind: "verified_testimony" },
        { npcId: "npc-1", playerId: "player-1", reasonKind: "lie_established" },
      ],
    );
    expect(aggregate).toMatchObject({ trustScore: 75, suspicionScore: 35 });
  });

  it("throws rather than silently skipping a relationship it holds no snapshot for", () => {
    // Returning [] here would let the caller commit its ledger insert and
    // promise settlement while the current row kept its stale scores.
    expect(() =>
      aggregateRelationshipUpdates(
        [],
        [{ npcId: "npc-1", playerId: "player-1", reasonKind: "promise_broken" }],
      ),
    ).toThrow(RelationshipSnapshotMismatchError);
  });

  it("names every uncovered pair once, however many contributions it had", () => {
    try {
      aggregateRelationshipUpdates(
        [neutral],
        [
          { npcId: "npc-2", playerId: "player-1", reasonKind: "promise_broken" },
          { npcId: "npc-2", playerId: "player-1", reasonKind: "promise_fulfilled" },
          { npcId: "npc-3", playerId: "player-1", reasonKind: "promise_broken" },
        ],
      );
      expect.unreachable("expected a RelationshipSnapshotMismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(RelationshipSnapshotMismatchError);
      const mismatch = error as RelationshipSnapshotMismatchError;
      expect(mismatch.missingPairs).toStrictEqual([
        "(npc-2, player-1)",
        "(npc-3, player-1)",
      ]);
      expect(mismatch.duplicatedPairs).toStrictEqual([]);
    }
  });

  it("throws on two snapshots for one pair, whose revisions cannot both be the guard", () => {
    try {
      aggregateRelationshipUpdates(
        [neutral, { ...neutral, revision: 9 }],
        [{ npcId: "npc-1", playerId: "player-1", reasonKind: "promise_broken" }],
      );
      expect.unreachable("expected a RelationshipSnapshotMismatchError");
    } catch (error) {
      expect(error).toBeInstanceOf(RelationshipSnapshotMismatchError);
      const mismatch = error as RelationshipSnapshotMismatchError;
      expect(mismatch.duplicatedPairs).toStrictEqual(["(npc-1, player-1)"]);
      expect(mismatch.message).toContain("more than one snapshot");
    }
  });

  it("tolerates an unused snapshot — over-fetching is not a mismatch", () => {
    expect(
      aggregateRelationshipUpdates(
        [neutral, { ...neutral, npcId: "npc-9" }],
        [{ npcId: "npc-1", playerId: "player-1", reasonKind: "promise_broken" }],
      ),
    ).toHaveLength(1);
  });

  it("keys pairs injectively, so ids containing the separator cannot collide", () => {
    // Without length-prefixing, ("a:b", "c") and ("a", "b:c") share a key and
    // one settlement would be attributed to the other's row.
    const aggregates = aggregateRelationshipUpdates(
      [
        { npcId: "a:b", playerId: "c", trustScore: 0, suspicionScore: 0, revision: 1 },
        { npcId: "a", playerId: "b:c", trustScore: 0, suspicionScore: 0, revision: 2 },
      ],
      [
        { npcId: "a:b", playerId: "c", reasonKind: "promise_fulfilled" },
        { npcId: "a", playerId: "b:c", reasonKind: "promise_broken" },
      ],
    );
    expect(aggregates).toStrictEqual([
      {
        npcId: "a",
        playerId: "b:c",
        expectedRevision: 2,
        trustScore: -40,
        suspicionScore: 35,
      },
      {
        npcId: "a:b",
        playerId: "c",
        expectedRevision: 1,
        trustScore: 25,
        suspicionScore: -15,
      },
    ]);
  });

  it("skips a row whose clamped scores did not move", () => {
    expect(
      aggregateRelationshipUpdates(
        [{ ...neutral, trustScore: 100, suspicionScore: -100 }],
        [{ npcId: "npc-1", playerId: "player-1", reasonKind: "evidence_presented" }],
      ),
    ).toStrictEqual([]);
  });

  it("orders several relationships by npc then player", () => {
    const aggregates = aggregateRelationshipUpdates(
      [
        { ...neutral, npcId: "npc-b" },
        { ...neutral, npcId: "npc-a", playerId: "player-2" },
        { ...neutral, npcId: "npc-a" },
      ],
      [
        { npcId: "npc-b", playerId: "player-1", reasonKind: "promise_broken" },
        { npcId: "npc-a", playerId: "player-2", reasonKind: "promise_broken" },
        { npcId: "npc-a", playerId: "player-1", reasonKind: "promise_broken" },
      ],
    );
    expect(aggregates.map((entry) => `${entry.npcId}/${entry.playerId}`)).toStrictEqual(
      ["npc-a/player-1", "npc-a/player-2", "npc-b/player-1"],
    );
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
