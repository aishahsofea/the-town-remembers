import { describe, expect, it } from "vitest";

import {
  planAccuse,
  planAddNoteAction,
  planInspect,
  planLeaveVisit,
  planResolve,
  planStartVisit,
  planTravel,
} from "./deterministic.js";

describe("planStartVisit", () => {
  it("denies when the town is not active", () => {
    const result = planStartVisit({
      townActive: false,
      hasActiveVisit: false,
      priorAmbientJobStatus: "none",
      festivalSquareLocationId: "festival_square",
    });
    expect(result.outcome).toBe("denied");
    expect(result.reasonCode).toBe("TOWN_NOT_ACTIVE");
  });

  it("denies when the prior ambient job has not finished", () => {
    const result = planStartVisit({
      townActive: true,
      hasActiveVisit: false,
      priorAmbientJobStatus: "processing",
      festivalSquareLocationId: "festival_square",
    });
    expect(result.reasonCode).toBe("PRIOR_VISIT_NOT_CLOSED");
  });

  it("is no_change when a visit is already active", () => {
    const result = planStartVisit({
      townActive: true,
      hasActiveVisit: true,
      priorAmbientJobStatus: "processing",
      festivalSquareLocationId: "festival_square",
    });
    expect(result.outcome).toBe("no_change");
  });

  it("applies a new visit at Festival Square", () => {
    const result = planStartVisit({
      townActive: true,
      hasActiveVisit: false,
      priorAmbientJobStatus: "none",
      festivalSquareLocationId: "festival_square",
    });
    expect(result.outcome).toBe("applied");
    expect(result.effects).toHaveLength(2);
  });
});

describe("planTravel", () => {
  it("denies an unknown destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "nowhere",
      destinationKnown: false,
      destinationAccess: { state: "open" },
    });
    expect(result.reasonCode).toBe("DESTINATION_UNKNOWN");
  });

  it("denies a locked destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "old_chapel",
      destinationKnown: true,
      destinationAccess: { state: "locked" },
    });
    expect(result.reasonCode).toBe("LOCATION_LOCKED");
  });

  it("is no_change when already at the destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "festival_square",
      destinationKnown: true,
      destinationAccess: { state: "open" },
    });
    expect(result.outcome).toBe("no_change");
  });

  it("applies arrival at a new open destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "lantern_inn",
      destinationKnown: true,
      destinationAccess: { state: "open" },
    });
    expect(result.outcome).toBe("applied");
  });
});

describe("planInspect", () => {
  it("denies an unknown inspectable", () => {
    const result = planInspect({
      inspectableId: "x",
      hasInspectable: false,
      hasClue: false,
      clueId: null,
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      playerId: "p1",
    });
    expect(result.reasonCode).toBe("INSPECTABLE_NOT_FOUND");
  });

  it("is no_change for a repeat inspection", () => {
    const result = planInspect({
      inspectableId: "x",
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: true,
      clueAlreadyDiscoveredByThisPlayer: true,
      playerId: "p1",
    });
    expect(result.outcome).toBe("no_change");
  });

  it("applies and records a new-to-town discovery", () => {
    const result = planInspect({
      inspectableId: "x",
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      playerId: "p1",
    });
    expect(result.outcome).toBe("applied");
    expect(result.effects).toHaveLength(2);
  });

  it("applies with no clue-discovery effect for an inspectable with no clue", () => {
    const result = planInspect({
      inspectableId: "x",
      hasInspectable: true,
      hasClue: false,
      clueId: null,
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      playerId: "p1",
    });
    expect(result.outcome).toBe("no_change");
  });
});

describe("planAddNoteAction", () => {
  it("denies without an active visit", () => {
    const result = planAddNoteAction({
      hasActiveVisit: false,
      playerId: "p1",
      text: "hi",
    });
    expect(result.reasonCode).toBe("VISIT_NOT_ACTIVE");
  });

  it("applies and creates a note board entry", () => {
    const result = planAddNoteAction({
      hasActiveVisit: true,
      playerId: "p1",
      text: "hi",
    });
    expect(result.outcome).toBe("applied");
    expect(result.effects).toHaveLength(2);
  });
});

describe("planLeaveVisit", () => {
  it("denies without an active visit", () => {
    const result = planLeaveVisit({
      hasActiveVisit: false,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 0,
    });
    expect(result.reasonCode).toBe("VISIT_NOT_ACTIVE");
  });

  it("applies with no outbox intent when no eligible event occurred", () => {
    const result = planLeaveVisit({
      hasActiveVisit: true,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 0,
    });
    expect(result.outcome).toBe("applied");
    expect(result.effects).toHaveLength(2);
  });

  it("applies with an outbox intent when at least one eligible event occurred", () => {
    const result = planLeaveVisit({
      hasActiveVisit: true,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 2,
    });
    expect(result.effects).toHaveLength(3);
  });
});

describe("planAccuse", () => {
  const solution = {
    culpritKey: "corin_hale",
    motiveKey: "protect_lark",
    locationKey: "old_chapel",
  };

  it("denies while the confrontation gate is locked", () => {
    const result = planAccuse({
      confrontationGateOpen: false,
      guess: {
        suspectId: "corin_hale",
        motiveId: "protect_lark",
        locationId: "old_chapel",
      },
      solution,
      playerId: "p1",
    });
    expect(result.reasonCode).toBe("CASE_GATE_LOCKED");
  });

  it("applies an incorrect attempt (immutable shared history, not no_change)", () => {
    const result = planAccuse({
      confrontationGateOpen: true,
      guess: {
        suspectId: "mara_venn",
        motiveId: "personal_profit",
        locationId: "festival_square",
      },
      solution,
      playerId: "p1",
    });
    expect(result.outcome).toBe("applied");
    expect((result.effects[1] as { row: { outcome: string } }).row.outcome).toBe(
      "incorrect",
    );
  });

  it("applies a correct attempt", () => {
    const result = planAccuse({
      confrontationGateOpen: true,
      guess: {
        suspectId: "corin_hale",
        motiveId: "protect_lark",
        locationId: "old_chapel",
      },
      solution,
      playerId: "p1",
    });
    expect((result.effects[1] as { row: { outcome: string } }).row.outcome).toBe(
      "correct",
    );
  });
});

describe("planResolve", () => {
  const baseTimes = {
    now: new Date("2026-01-01T00:05:00.000Z"),
    reservationExpiresAt: new Date("2026-01-01T00:10:00.000Z"),
    playerVisitStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    winningAttemptEventAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("is no_change when the town is already resolved", () => {
    const result = planResolve({
      townAlreadyResolved: true,
      playerId: "p1",
      reservationOwnerPlayerId: "p1",
      ...baseTimes,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: true,
    });
    expect(result.outcome).toBe("no_change");
  });

  it("denies a non-owner while the reservation is active", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      playerId: "someone-else",
      reservationOwnerPlayerId: "p1",
      ...baseTimes,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: true,
    });
    expect(result.reasonCode).toBe("RESOLUTION_NOT_ELIGIBLE");
  });

  it("applies the winning resolution and relocates the bell when it is still at old_chapel", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      playerId: "p1",
      reservationOwnerPlayerId: "p1",
      ...baseTimes,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: true,
    });
    expect(result.outcome).toBe("applied");
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "event_origin" && effect.eventType === "item_relocated",
      ),
    ).toBe(true);
  });

  it("applies without relocation when the bell already moved (D2-P)", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      playerId: "p1",
      reservationOwnerPlayerId: "p1",
      ...baseTimes,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: false,
    });
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "event_origin" && effect.eventType === "item_relocated",
      ),
    ).toBe(false);
  });
});
