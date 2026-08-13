import { describe, expect, it } from "vitest";

import { RelationshipSnapshotMismatchError } from "../beliefs/relationships.js";
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
  const baseTravelInputs = {
    visitId: "visit-1",
    townId: "town-1",
    townRevision: 5,
  };

  it("denies an unknown destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "nowhere",
      destinationKnown: false,
      destinationAccess: { state: "open" },
      ...baseTravelInputs,
    });
    expect(result.reasonCode).toBe("DESTINATION_UNKNOWN");
  });

  it("denies a locked destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "old_chapel",
      destinationKnown: true,
      destinationAccess: { state: "locked" },
      ...baseTravelInputs,
    });
    expect(result.reasonCode).toBe("LOCATION_LOCKED");
  });

  it("is no_change when already at the destination", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "festival_square",
      destinationKnown: true,
      destinationAccess: { state: "open" },
      ...baseTravelInputs,
    });
    expect(result.outcome).toBe("no_change");
  });

  it("applies arrival guarded by a real towns revision, then updates the visit's location with no fake revision", () => {
    const result = planTravel({
      currentLocationId: "festival_square",
      destinationLocationId: "lantern_inn",
      destinationKnown: true,
      destinationAccess: { state: "open" },
      ...baseTravelInputs,
    });
    expect(result.outcome).toBe("applied");

    const townChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "towns",
    );
    expect(townChange).toMatchObject({
      key: { id: "town-1" },
      expectedRevision: 5,
    });

    const visitChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "player_visits",
    );
    expect(visitChange).toMatchObject({
      key: { id: "visit-1" },
      change: { current_location_entity_id: "lantern_inn" },
    });
    expect(visitChange).not.toHaveProperty("expectedRevision");
  });
});

describe("planInspect", () => {
  const baseInspectInputs = {
    inspectableId: "x",
    playerId: "p1",
    townId: "town-1",
    townRevision: 5,
    locationEntityId: "old_chapel",
    revealsItemId: null,
    itemAlreadyRevealed: false,
    revealedItemPortable: false,
    revealedItemRevision: 0,
    boardEntryAlreadyExists: false,
  };

  it("denies an unknown inspectable and emits nothing (P3-11 acceptance 8)", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: false,
      hasClue: false,
      clueId: null,
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
    });
    expect(result.outcome).toBe("denied");
    expect(result.reasonCode).toBe("INSPECTABLE_NOT_FOUND");
    expect(result.effects).toHaveLength(0);
  });

  it("is no_change for a repeat inspection", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: true,
      clueAlreadyDiscoveredByThisPlayer: true,
    });
    expect(result.outcome).toBe("no_change");
    expect(result.effects).toHaveLength(0);
  });

  it("applies with no clue-discovery effect for an inspectable with no clue", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: false,
      clueId: null,
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
    });
    expect(result.outcome).toBe("no_change");
  });

  it("a new-to-town discovery guards the town revision, records the discovery, and creates the shared board entry", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
    });
    expect(result.outcome).toBe("applied");
    expect(result.effects).toHaveLength(4);

    const townGuard = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "towns",
    );
    expect(townGuard).toMatchObject({ key: { id: "town-1" }, expectedRevision: 5 });

    const discoveryInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "clue_discoveries",
    );
    expect(discoveryInsert).toMatchObject({
      row: { clue_id: "clue-1", player_id: "p1" },
    });

    const boardInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
    );
    expect(boardInsert).toMatchObject({
      row: {
        entry_kind: "verified_evidence",
        verification_status: "verified_physical",
        clue_id: "clue-1",
        contributed_by_player_id: "p1",
      },
    });
  });

  it("a new-to-player discovery records the discovery but never a second board entry", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: true,
      clueAlreadyDiscoveredByThisPlayer: false,
    });
    expect(result.outcome).toBe("applied");

    const discoveryInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "clue_discoveries",
    );
    expect(discoveryInsert).toMatchObject({
      row: { clue_id: "clue-1", player_id: "p1" },
    });
    expect(
      result.effects.some(
        (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
      ),
    ).toBe(false);
  });

  it("does not insert a second board entry when boardEntryAlreadyExists (the concurrency guard)", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      boardEntryAlreadyExists: true,
    });
    expect(result.outcome).toBe("applied");
    expect(
      result.effects.some(
        (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
      ),
    ).toBe(false);
  });

  it("a portable reveal transfers custody to the player in the same items conditional_state_change", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      revealsItemId: "item-1",
      revealedItemPortable: true,
      revealedItemRevision: 3,
    });
    const itemChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "items",
    );
    expect(itemChange).toMatchObject({
      key: { id: "item-1" },
      expectedRevision: 3,
      change: {
        held_by_actor_id: "p1",
        location_entity_id: null,
        location_entity_type: null,
      },
    });
  });

  it("a non-portable reveal changes no custody column, only marking the item revealed", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      revealsItemId: "festival_bell",
      revealedItemPortable: false,
      revealedItemRevision: 1,
    });
    const itemChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "items",
    );
    expect(itemChange).toMatchObject({
      key: { id: "festival_bell" },
      expectedRevision: 1,
      change: {},
    });
  });

  it("emits no items effect for an inspectable that reveals nothing", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: true,
      clueId: "clue-1",
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
    });
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "items",
      ),
    ).toBe(false);
  });

  it("applies an item reveal for an inspectable with no clue at all (square_bench_glint/nessas_field_lens)", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: false,
      clueId: null,
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      revealsItemId: "nessas_field_lens",
      revealedItemPortable: true,
      revealedItemRevision: 0,
    });
    expect(result.outcome).toBe("applied");
    expect(
      result.effects.some(
        (effect) => effect.kind === "insert" && effect.table === "clue_discoveries",
      ),
    ).toBe(false);
    expect(
      result.effects.some(
        (effect) => effect.kind === "insert" && effect.table === "case_board_entries",
      ),
    ).toBe(false);
    const itemChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "items",
    );
    expect(itemChange).toMatchObject({
      key: { id: "nessas_field_lens" },
      change: { held_by_actor_id: "p1" },
    });
  });

  it("is no_change for a no-clue inspectable whose item is already revealed", () => {
    const result = planInspect({
      ...baseInspectInputs,
      hasInspectable: true,
      hasClue: false,
      clueId: null,
      clueAlreadyDiscoveredInTown: false,
      clueAlreadyDiscoveredByThisPlayer: false,
      revealsItemId: "nessas_field_lens",
      itemAlreadyRevealed: true,
      revealedItemPortable: true,
    });
    expect(result.outcome).toBe("no_change");
    expect(result.effects).toHaveLength(0);
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
  const baseLeaveInputs = {
    townId: "town-1",
    townRevision: 7,
    visitId: "visit-1",
    actionId: "action-1",
    ambientScheduledThroughSequence: 4,
    now: new Date("2026-01-01T00:00:00.000Z"),
  };

  it("denies without an active visit", () => {
    const result = planLeaveVisit({
      hasActiveVisit: false,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 0,
      ...baseLeaveInputs,
    });
    expect(result.reasonCode).toBe("VISIT_NOT_ACTIVE");
  });

  it("applies with no outbox intent when no eligible event occurred, and ends the visit", () => {
    const result = planLeaveVisit({
      hasActiveVisit: true,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 0,
      ...baseLeaveInputs,
    });
    expect(result.outcome).toBe("applied");
    expect(result.effects).toHaveLength(3);

    const townChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "towns",
    );
    expect(townChange).toMatchObject({
      key: { id: "town-1" },
      expectedRevision: 7,
    });

    const visitChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "player_visits",
    );
    expect(visitChange).toMatchObject({
      key: { id: "visit-1" },
      change: {
        status: "ended",
        end_revision: 8,
        ended_at: "2026-01-01T00:00:00.000Z",
        ended_by_action_id: "action-1",
        end_reason: "left_town",
      },
    });
    expect(visitChange).not.toHaveProperty("expectedRevision");
  });

  it("applies with an outbox intent when at least one eligible event occurred", () => {
    const result = planLeaveVisit({
      hasActiveVisit: true,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 2,
      ...baseLeaveInputs,
    });
    expect(result.effects).toHaveLength(4);

    const outboxInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "outbox",
    );
    // The half-open range this departure claims: everything after the last
    // already-scheduled sequence, through the departure event itself.
    expect(outboxInsert).toStrictEqual({
      kind: "insert",
      table: "outbox",
      row: {
        job_type: "ambient_tick",
        visit_id: "visit-1",
        after_event_sequence: 4,
        through_event_sequence: 10,
      },
    });
  });

  it("claims a range disjoint from the one an earlier departure already scheduled", () => {
    const first = planLeaveVisit({
      hasActiveVisit: true,
      lastEventSequenceAtLeave: 10,
      eligibleEventCountInRange: 2,
      ...baseLeaveInputs,
    });
    const second = planLeaveVisit({
      hasActiveVisit: true,
      lastEventSequenceAtLeave: 19,
      eligibleEventCountInRange: 1,
      ...baseLeaveInputs,
      visitId: "visit-2",
      // The town advanced to the first departure's upper bound.
      ambientScheduledThroughSequence: 10,
    });
    const rangeOf = (result: typeof first) => {
      const insert = result.effects.find(
        (effect) => effect.kind === "insert" && effect.table === "outbox",
      );
      return insert?.kind === "insert" ? insert.row : undefined;
    };
    expect(rangeOf(first)).toMatchObject({
      after_event_sequence: 4,
      through_event_sequence: 10,
    });
    expect(rangeOf(second)).toMatchObject({
      after_event_sequence: 10,
      through_event_sequence: 19,
    });
  });
});

describe("planAccuse", () => {
  const solution = {
    culpritKey: "corin_hale",
    motiveKey: "protect_lark",
    locationKey: "old_chapel",
  };
  const baseInputs = {
    solution,
    playerId: "p1",
    townId: "town-1",
    townRevision: 9,
    wonAt: new Date("2026-01-01T00:00:00.000Z"),
    caseAttemptId: "case-attempt-1",
  };

  it("denies while the confrontation gate is locked", () => {
    const result = planAccuse({
      confrontationGateOpen: false,
      guess: {
        suspectId: "corin_hale",
        motiveId: "protect_lark",
        locationId: "old_chapel",
      },
      ...baseInputs,
    });
    expect(result.reasonCode).toBe("CASE_GATE_LOCKED");
  });

  it("applies an incorrect attempt (immutable shared history, not no_change) with no reservation effect", () => {
    const result = planAccuse({
      confrontationGateOpen: true,
      guess: {
        suspectId: "mara_venn",
        motiveId: "personal_profit",
        locationId: "festival_square",
      },
      ...baseInputs,
    });
    expect(result.outcome).toBe("applied");
    expect((result.effects[1] as { row: { outcome: string } }).row.outcome).toBe(
      "incorrect",
    );
    expect(result.effects).toHaveLength(2);
  });

  it("applies a correct attempt and reserves resolution for ten minutes", () => {
    const result = planAccuse({
      confrontationGateOpen: true,
      guess: {
        suspectId: "corin_hale",
        motiveId: "protect_lark",
        locationId: "old_chapel",
      },
      ...baseInputs,
    });
    expect(
      (result.effects[1] as { row: { outcome: string; id: string } }).row,
    ).toMatchObject({ outcome: "correct", id: "case-attempt-1" });
    const reservation = result.effects.find(
      (effect) => effect.kind === "conditional_state_change",
    );
    expect(reservation).toMatchObject({
      table: "towns",
      key: { id: "town-1" },
      expectedRevision: 9,
      change: {
        status: "awaiting_resolution",
        resolution_owner_player_id: "p1",
        resolution_reservation_expires_at: "2026-01-01T00:10:00.000Z",
        winning_case_attempt_id: "case-attempt-1",
      },
    });
  });
});

describe("planResolve", () => {
  const baseTimes = {
    now: new Date("2026-01-01T00:05:00.000Z"),
    reservationExpiresAt: new Date("2026-01-01T00:10:00.000Z"),
    playerVisitStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    winningAttemptEventAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const baseInputs = {
    playerId: "p1",
    reservationOwnerPlayerId: "p1",
    ...baseTimes,
    bellItemId: "item-bell",
    bellRevision: 3,
    festivalSquareLocationId: "festival_square",
    townId: "town-1",
    townRevision: 12,
    winningCaseAttemptId: "case-attempt-1",
    actionId: "resolve-action-1",
    resolutionEventId: "event-resolution-1",
    activeVisits: [],
    activePromises: [],
    relationships: [],
  };

  it("is no_change when the town is already resolved", () => {
    const result = planResolve({
      townAlreadyResolved: true,
      ...baseInputs,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: true,
    });
    expect(result.outcome).toBe("no_change");
  });

  it("denies a non-owner while the reservation is active", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      playerId: "someone-else",
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: true,
    });
    expect(result.reasonCode).toBe("RESOLUTION_NOT_ELIGIBLE");
  });

  it("applies the winning resolution, marks the town resolved with resolved_at, and relocates the bell", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
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

    const resolutionInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "town_resolutions",
    );
    expect(resolutionInsert).toMatchObject({
      row: { case_attempt_id: "case-attempt-1", chosen_by_player_id: "p1" },
    });

    const townChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "towns",
    );
    expect(townChange).toMatchObject({
      key: { id: "town-1" },
      expectedRevision: 12,
      change: { status: "resolved", resolved_at: "2026-01-01T00:05:00.000Z" },
    });

    const bellChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "items",
    );
    expect(bellChange).toMatchObject({
      key: { id: "item-bell" },
      expectedRevision: 3,
      change: { location_entity_id: "festival_square" },
    });
  });

  it("applies without relocation when the bell already moved (D2-P)", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: false,
    });
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "event_origin" && effect.eventType === "item_relocated",
      ),
    ).toBe(false);
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "items",
      ),
    ).toBe(false);
  });

  it("ends every other active visit with the town_resolved reason, guarded by no fake revision", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: false,
      activeVisits: [{ visitId: "visit-2" }, { visitId: "visit-3" }],
    });
    const visitChanges = result.effects.filter(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "player_visits",
    );
    expect(visitChanges).toHaveLength(2);
    expect(visitChanges[0]).toMatchObject({
      key: { id: "visit-2" },
      change: {
        status: "ended",
        end_revision: 13,
        ended_at: "2026-01-01T00:05:00.000Z",
        ended_by_action_id: "resolve-action-1",
        end_reason: "town_resolved",
      },
    });
    expect(visitChanges[0]).not.toHaveProperty("expectedRevision");
  });

  it("fulfills an active return_item promise when the requester holds the item, with a schema-valid relationship row", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "restore_bell_quietly",
      bellCurrentlyAtOldChapel: false,
      activePromises: [
        {
          promiseId: "promise-1",
          npcId: "npc-1",
          playerId: "p1",
          kind: "return_item",
          protectedClaimEntersPublicResolution: false,
          requesterHoldsItemAtResolution: true,
        },
      ],
      relationships: [
        {
          npcId: "npc-1",
          playerId: "p1",
          trustScore: 0,
          suspicionScore: 0,
          revision: 0,
        },
      ],
    });
    const promiseChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "promises",
    );
    expect(promiseChange).toMatchObject({
      key: { id: "promise-1" },
      change: { status: "fulfilled", resolved_event_id: "event-resolution-1" },
    });
    expect(promiseChange).not.toHaveProperty("expectedRevision");

    const relationshipInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "relationship_changes",
    );
    expect(relationshipInsert).toMatchObject({
      row: {
        npc_id: "npc-1",
        player_id: "p1",
        promise_id: "promise-1",
        reason_kind: "promise_fulfilled",
      },
    });
  });

  it("breaks an active keep_secret promise whose protected claim enters public resolution", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "expose_cover_up",
      bellCurrentlyAtOldChapel: false,
      activePromises: [
        {
          promiseId: "promise-2",
          npcId: "npc-2",
          playerId: "p2",
          kind: "keep_secret",
          protectedClaimEntersPublicResolution: true,
          requesterHoldsItemAtResolution: false,
        },
      ],
      relationships: [
        {
          npcId: "npc-2",
          playerId: "p2",
          trustScore: 0,
          suspicionScore: 0,
          revision: 0,
        },
      ],
    });
    const promiseChange = result.effects.find(
      (effect) =>
        effect.kind === "conditional_state_change" && effect.table === "promises",
    );
    expect(promiseChange).toMatchObject({
      key: { id: "promise-2" },
      change: { status: "broken", resolved_event_id: "event-resolution-1" },
    });
    const relationshipInsert = result.effects.find(
      (effect) => effect.kind === "insert" && effect.table === "relationship_changes",
    );
    expect(relationshipInsert).toMatchObject({
      row: { reason_kind: "promise_broken", player_id: "p2" },
    });
  });

  it("leaves an unaffected keep_secret promise unchanged — no promise or relationship effect", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "expose_cover_up",
      bellCurrentlyAtOldChapel: false,
      activePromises: [
        {
          promiseId: "promise-3",
          npcId: "npc-3",
          playerId: "p3",
          kind: "keep_secret",
          protectedClaimEntersPublicResolution: false,
          requesterHoldsItemAtResolution: false,
        },
      ],
    });
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "conditional_state_change" && effect.table === "promises",
      ),
    ).toBe(false);
  });

  it("advances each settling promise's current relationship row, summed once per pair", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "expose_cover_up",
      bellCurrentlyAtOldChapel: false,
      activePromises: [
        {
          promiseId: "promise-1",
          npcId: "npc-1",
          playerId: "p1",
          kind: "return_item",
          protectedClaimEntersPublicResolution: false,
          requesterHoldsItemAtResolution: true,
        },
        {
          promiseId: "promise-2",
          npcId: "npc-1",
          playerId: "p1",
          kind: "keep_secret",
          protectedClaimEntersPublicResolution: true,
          requesterHoldsItemAtResolution: false,
        },
        {
          promiseId: "promise-3",
          npcId: "npc-2",
          playerId: "p1",
          kind: "keep_secret",
          protectedClaimEntersPublicResolution: true,
          requesterHoldsItemAtResolution: false,
        },
      ],
      relationships: [
        {
          npcId: "npc-1",
          playerId: "p1",
          trustScore: 30,
          suspicionScore: 0,
          revision: 5,
        },
        {
          npcId: "npc-2",
          playerId: "p1",
          trustScore: 0,
          suspicionScore: 0,
          revision: 2,
        },
      ],
    });
    const relationshipChanges = result.effects.filter(
      (effect) =>
        effect.kind === "conditional_state_change" &&
        effect.table === "npc_player_relationships",
    );
    // Two promises settle against npc-1 (fulfilled +25/-15, broken -40/+35):
    // one row carrying the summed deltas, not one row per promise.
    expect(relationshipChanges).toHaveLength(2);
    expect(relationshipChanges[0]).toMatchObject({
      key: { npc_id: "npc-1", player_id: "p1" },
      expectedRevision: 5,
      change: {
        trust_score: 15,
        suspicion_score: 20,
        updated_event_id: "event-resolution-1",
      },
    });
    expect(relationshipChanges[1]).toMatchObject({
      key: { npc_id: "npc-2", player_id: "p1" },
      expectedRevision: 2,
      change: { trust_score: -40, suspicion_score: 35 },
    });
  });

  it("refuses to settle a promise it was given no relationship row for", () => {
    // The promise update and the ledger insert are already queued by this
    // point; committing them without advancing npc_player_relationships
    // would leave the settlement half-applied.
    expect(() =>
      planResolve({
        townAlreadyResolved: false,
        ...baseInputs,
        choice: "expose_cover_up",
        bellCurrentlyAtOldChapel: false,
        activePromises: [
          {
            promiseId: "promise-1",
            npcId: "npc-1",
            playerId: "p1",
            kind: "keep_secret",
            protectedClaimEntersPublicResolution: true,
            requesterHoldsItemAtResolution: false,
          },
        ],
        relationships: [],
      }),
    ).toThrow(RelationshipSnapshotMismatchError);
  });

  it("emits no relationship state change for a promise that did not settle", () => {
    const result = planResolve({
      townAlreadyResolved: false,
      ...baseInputs,
      choice: "expose_cover_up",
      bellCurrentlyAtOldChapel: false,
      activePromises: [
        {
          promiseId: "promise-3",
          npcId: "npc-3",
          playerId: "p3",
          kind: "keep_secret",
          protectedClaimEntersPublicResolution: false,
          requesterHoldsItemAtResolution: false,
        },
      ],
      relationships: [
        {
          npcId: "npc-3",
          playerId: "p3",
          trustScore: 10,
          suspicionScore: 0,
          revision: 1,
        },
      ],
    });
    expect(
      result.effects.some(
        (effect) =>
          effect.kind === "conditional_state_change" &&
          effect.table === "npc_player_relationships",
      ),
    ).toBe(false);
  });
});
