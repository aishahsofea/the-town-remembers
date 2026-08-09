import { describe, expect, it } from "vitest";

import {
  buildProvenancePath,
  computeBoardContradictionPairs,
  entryKindForSourceKind,
  isBoardEligibleTransmission,
  shouldCreateAccountCard,
  shouldCreateVerifiedEvidenceCard,
  verificationStatusFor,
  type TransmissionLink,
} from "./provenance.js";

describe("buildProvenancePath", () => {
  it("follows parent_transmission_id from root to recipient, reversed into root-first order", () => {
    const links = new Map<string, TransmissionLink>([
      [
        "t3",
        {
          transmissionId: "t3",
          parentTransmissionId: "t2",
          speakerActorId: "player-1",
          speakerActorType: "player",
        },
      ],
      [
        "t2",
        {
          transmissionId: "t2",
          parentTransmissionId: "t1",
          speakerActorId: "nessa_reed",
          speakerActorType: "npc",
        },
      ],
      [
        "t1",
        {
          transmissionId: "t1",
          parentTransmissionId: null,
          speakerActorId: "mara_venn",
          speakerActorType: "npc",
        },
      ],
    ]);

    expect(buildProvenancePath("t3", links)).toStrictEqual([
      { actorId: "mara_venn", actorType: "npc" },
      { actorId: "nessa_reed", actorType: "npc" },
      { actorId: "player-1", actorType: "player" },
    ]);
  });

  it("returns a single-element path for an original assertion with no parent", () => {
    const links = new Map<string, TransmissionLink>([
      [
        "t1",
        {
          transmissionId: "t1",
          parentTransmissionId: null,
          speakerActorId: "corin_hale",
          speakerActorType: "npc",
        },
      ],
    ]);
    expect(buildProvenancePath("t1", links)).toStrictEqual([
      { actorId: "corin_hale", actorType: "npc" },
    ]);
  });

  it("returns an empty path and does not loop forever on a cycle", () => {
    const links = new Map<string, TransmissionLink>([
      [
        "a",
        {
          transmissionId: "a",
          parentTransmissionId: "b",
          speakerActorId: "x",
          speakerActorType: "npc",
        },
      ],
      [
        "b",
        {
          transmissionId: "b",
          parentTransmissionId: "a",
          speakerActorId: "y",
          speakerActorType: "npc",
        },
      ],
    ]);
    const path = buildProvenancePath("a", links);
    expect(path).toHaveLength(2);
  });
});

describe("entryKindForSourceKind / verificationStatusFor", () => {
  it.each([
    ["original_assertion", "testimony"],
    ["direct_observation", "testimony"],
    ["repeated_testimony", "hearsay"],
    ["alleged_hearsay", "hearsay"],
  ] as const)("%s maps to %s", (sourceKind, expected) => {
    expect(entryKindForSourceKind(sourceKind)).toBe(expected);
  });

  it("maps entryKind to the matching verificationStatus", () => {
    expect(verificationStatusFor("testimony")).toBe("attributed_testimony");
    expect(verificationStatusFor("hearsay")).toBe("attributed_hearsay");
  });
});

describe("isBoardEligibleTransmission", () => {
  it("accepts an NPC-to-player transmission below confidential", () => {
    expect(isBoardEligibleTransmission("player", "npc", "guarded")).toBe(true);
    expect(isBoardEligibleTransmission("player", "npc", "public")).toBe(true);
    expect(isBoardEligibleTransmission("player", "npc", "final_truth")).toBe(true);
  });

  it("rejects a player-to-NPC assertion", () => {
    expect(isBoardEligibleTransmission("npc", "player", "public")).toBe(false);
  });

  it("rejects an NPC-to-NPC transmission (no player recipient)", () => {
    expect(isBoardEligibleTransmission("npc", "npc", "public")).toBe(false);
  });

  it("rejects confidential-tier dialogue", () => {
    expect(isBoardEligibleTransmission("player", "npc", "confidential")).toBe(false);
  });
});

describe("no-repeat-write dedup", () => {
  it("creates a verified evidence card only once per clue", () => {
    expect(shouldCreateVerifiedEvidenceCard("clue-1", new Set())).toBe(true);
    expect(shouldCreateVerifiedEvidenceCard("clue-1", new Set(["clue-1"]))).toBe(false);
  });

  it("creates an account card only once per transmission", () => {
    expect(shouldCreateAccountCard("t1", new Set())).toBe(true);
    expect(shouldCreateAccountCard("t1", new Set(["t1"]))).toBe(false);
  });
});

describe("computeBoardContradictionPairs", () => {
  it("pairs only entries both currently visible on the board, in lexical entry-ID order", () => {
    const pairs = computeBoardContradictionPairs(
      [
        { entryId: "entry-z", claimId: "claim-a" },
        { entryId: "entry-a", claimId: "claim-b" },
      ],
      [{ claimAId: "claim-a", claimBId: "claim-b" }],
    );
    expect(pairs).toStrictEqual([
      { firstEntryId: "entry-a", secondEntryId: "entry-z" },
    ]);
  });

  it("forms no pair when only one side's claim is visible", () => {
    const pairs = computeBoardContradictionPairs(
      [{ entryId: "entry-1", claimId: "claim-a" }],
      [{ claimAId: "claim-a", claimBId: "claim-b" }],
    );
    expect(pairs).toStrictEqual([]);
  });

  it("never emits a verdict field, only the two entry IDs", () => {
    const pairs = computeBoardContradictionPairs(
      [
        { entryId: "entry-1", claimId: "claim-a" },
        { entryId: "entry-2", claimId: "claim-b" },
      ],
      [{ claimAId: "claim-a", claimBId: "claim-b" }],
    );
    expect(Object.keys(pairs[0]!)).toStrictEqual(["firstEntryId", "secondEntryId"]);
  });

  it("deduplicates when the relation is stored both directions", () => {
    const pairs = computeBoardContradictionPairs(
      [
        { entryId: "entry-1", claimId: "claim-a" },
        { entryId: "entry-2", claimId: "claim-b" },
      ],
      [
        { claimAId: "claim-a", claimBId: "claim-b" },
        { claimAId: "claim-b", claimBId: "claim-a" },
      ],
    );
    expect(pairs).toHaveLength(1);
  });
});
