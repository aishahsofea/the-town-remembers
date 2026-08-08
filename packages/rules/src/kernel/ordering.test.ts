import { describe, expect, it } from "vitest";

import {
  compareAmbientCandidates,
  compareByAcceptedAtThenId,
  compareByAuthoredOrder,
  compareByCreatedAtThenId,
  compareByDiscoverySequenceThenPlayerId,
  compareByMapOrder,
  compareByNormalizedNameThenId,
  compareByPair,
  compareRecallAnchors,
  compareRecallResults,
  compareResolutionChoices,
} from "./ordering.js";

describe("compareRecallAnchors", () => {
  it("orders by importance desc, occurred_at desc, episode ID asc", () => {
    const fixture = [
      {
        importance: 50,
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        episodeId: "b",
      },
      {
        importance: 90,
        occurredAt: new Date("2026-01-02T00:00:00.000Z"),
        episodeId: "a",
      },
      {
        importance: 90,
        occurredAt: new Date("2026-01-03T00:00:00.000Z"),
        episodeId: "c",
      },
      {
        importance: 90,
        occurredAt: new Date("2026-01-03T00:00:00.000Z"),
        episodeId: "a",
      },
    ];
    const sorted = [...fixture].toSorted(compareRecallAnchors);
    expect(sorted.map((entry) => entry.episodeId)).toStrictEqual(["a", "c", "a", "b"]);
  });
});

describe("compareRecallResults", () => {
  it("orders by score desc, occurred_at desc, episode ID asc", () => {
    const fixture = [
      { score: 0.2, occurredAt: new Date("2026-01-01T00:00:00.000Z"), episodeId: "x" },
      { score: 0.9, occurredAt: new Date("2026-01-01T00:00:00.000Z"), episodeId: "z" },
      { score: 0.9, occurredAt: new Date("2026-01-02T00:00:00.000Z"), episodeId: "y" },
    ];
    const sorted = [...fixture].toSorted(compareRecallResults);
    expect(sorted.map((entry) => entry.episodeId)).toStrictEqual(["y", "z", "x"]);
  });
});

describe("compareAmbientCandidates", () => {
  it("orders by priority desc, claim key, speaker ID, recipient ID", () => {
    const fixture = [
      {
        priority: 10,
        normalizedClaimKey: "claim-a",
        speakerActorId: "s2",
        recipientActorId: "r1",
      },
      {
        priority: 40,
        normalizedClaimKey: "claim-b",
        speakerActorId: "s1",
        recipientActorId: "r2",
      },
      {
        priority: 40,
        normalizedClaimKey: "claim-a",
        speakerActorId: "s1",
        recipientActorId: "r1",
      },
      {
        priority: 40,
        normalizedClaimKey: "claim-a",
        speakerActorId: "s1",
        recipientActorId: "r0",
      },
    ];
    const sorted = [...fixture].toSorted(compareAmbientCandidates);
    expect(sorted.map((entry) => entry.recipientActorId)).toStrictEqual([
      "r0",
      "r1",
      "r2",
      "r1",
    ]);
  });
});

describe("compareByMapOrder", () => {
  it("orders by (mapOrder, id)", () => {
    const fixture = [
      { mapOrder: 3, id: "d" },
      { mapOrder: 0, id: "b" },
      { mapOrder: 0, id: "a" },
      { mapOrder: 1, id: "c" },
    ];
    const sorted = [...fixture].toSorted(compareByMapOrder);
    expect(sorted.map((entry) => entry.id)).toStrictEqual(["a", "b", "c", "d"]);
  });
});

describe("compareByNormalizedNameThenId", () => {
  it("orders by normalized name then ID", () => {
    const fixture = [
      { normalizedName: "nessa", id: "2" },
      { normalizedName: "corin", id: "1" },
      { normalizedName: "corin", id: "0" },
    ];
    const sorted = [...fixture].toSorted(compareByNormalizedNameThenId);
    expect(sorted.map((entry) => entry.id)).toStrictEqual(["0", "1", "2"]);
  });
});

describe("compareByDiscoverySequenceThenPlayerId", () => {
  it("orders by discovery sequence then player ID", () => {
    const fixture = [
      { discoverySequence: 2, playerId: "p2" },
      { discoverySequence: 1, playerId: "p2" },
      { discoverySequence: 1, playerId: "p1" },
    ];
    const sorted = [...fixture].toSorted(compareByDiscoverySequenceThenPlayerId);
    expect(sorted.map((entry) => entry.playerId)).toStrictEqual(["p1", "p2", "p2"]);
  });
});

describe("compareByAcceptedAtThenId", () => {
  it("orders by (acceptedAt, id)", () => {
    const fixture = [
      { acceptedAt: new Date("2026-01-02T00:00:00.000Z"), id: "b" },
      { acceptedAt: new Date("2026-01-01T00:00:00.000Z"), id: "z" },
      { acceptedAt: new Date("2026-01-01T00:00:00.000Z"), id: "a" },
    ];
    const sorted = [...fixture].toSorted(compareByAcceptedAtThenId);
    expect(sorted.map((entry) => entry.id)).toStrictEqual(["a", "z", "b"]);
  });
});

describe("compareByCreatedAtThenId", () => {
  it("orders by (createdAt, id)", () => {
    const fixture = [
      { createdAt: new Date("2026-01-02T00:00:00.000Z"), id: "b" },
      { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "z" },
      { createdAt: new Date("2026-01-01T00:00:00.000Z"), id: "a" },
    ];
    const sorted = [...fixture].toSorted(compareByCreatedAtThenId);
    expect(sorted.map((entry) => entry.id)).toStrictEqual(["a", "z", "b"]);
  });
});

describe("compareByPair", () => {
  it("orders by (firstEntryId, secondEntryId)", () => {
    const fixture = [
      { firstId: "b", secondId: "a" },
      { firstId: "a", secondId: "z" },
      { firstId: "a", secondId: "a" },
    ];
    const sorted = [...fixture].toSorted(compareByPair);
    expect(sorted).toStrictEqual([
      { firstId: "a", secondId: "a" },
      { firstId: "a", secondId: "z" },
      { firstId: "b", secondId: "a" },
    ]);
  });
});

describe("compareByAuthoredOrder", () => {
  it("orders by frozen authored order then ID", () => {
    const fixture = [
      { authoredOrder: 2, id: "y" },
      { authoredOrder: 0, id: "z" },
      { authoredOrder: 0, id: "a" },
    ];
    const sorted = [...fixture].toSorted(compareByAuthoredOrder);
    expect(sorted.map((entry) => entry.id)).toStrictEqual(["a", "z", "y"]);
  });
});

describe("compareResolutionChoices", () => {
  it("always places expose_cover_up before restore_bell_quietly", () => {
    const sorted = ["restore_bell_quietly", "expose_cover_up"].toSorted(
      compareResolutionChoices,
    );
    expect(sorted).toStrictEqual(["expose_cover_up", "restore_bell_quietly"]);
  });
});
