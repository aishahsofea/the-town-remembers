import { describe, expect, it } from "vitest";

import { EVENT_TYPES, type EventType } from "@the-town-remembers/database/domains";

import {
  canStartNewVisit,
  canTravelTo,
  classifyStartVisit,
  classifyTravel,
  computeAmbientEligible,
  computeAmbientEventRange,
  isSequenceInRange,
  planAddNote,
  planLeave,
} from "./visits.js";

describe("classifyStartVisit", () => {
  it("is already_active when a visit is already active", () => {
    expect(classifyStartVisit(true)).toBe("already_active");
  });

  it("is started otherwise", () => {
    expect(classifyStartVisit(false)).toBe("started");
  });
});

describe("canStartNewVisit", () => {
  it("allows starting when the player has no active visit and no prior ambient job", () => {
    expect(canStartNewVisit("none", false)).toBe(true);
  });

  it("allows starting once the prior ambient job has completed", () => {
    expect(canStartNewVisit("completed", false)).toBe(true);
  });

  it("blocks a new visit while the prior ambient job is still processing or quarantined", () => {
    expect(canStartNewVisit("processing", false)).toBe(false);
    expect(canStartNewVisit("quarantined", false)).toBe(false);
  });

  it("an already-active visit is never blocked (it's a no_change path, not a denial)", () => {
    expect(canStartNewVisit("processing", true)).toBe(true);
  });
});

describe("classifyTravel", () => {
  it("is already_there for the current location", () => {
    expect(classifyTravel("festival_square", "festival_square")).toBe("already_there");
  });

  it("is arrived for a different location", () => {
    expect(classifyTravel("festival_square", "old_chapel")).toBe("arrived");
  });
});

describe("canTravelTo", () => {
  it("permits travel only to an open location", () => {
    expect(canTravelTo({ state: "open" })).toBe(true);
    expect(canTravelTo({ state: "locked" })).toBe(false);
  });
});

describe("planAddNote", () => {
  it("always adds — text-shape validation happens at the HTTP boundary", () => {
    expect(planAddNote()).toStrictEqual({ disposition: "added" });
  });
});

describe("event range (D2-H)", () => {
  it("is the disjoint (scheduledThrough, lastEvent] range", () => {
    const range = computeAmbientEventRange(10, 25);
    expect(range).toStrictEqual({ lowerExclusive: 10, upperInclusive: 25 });
    expect(isSequenceInRange(range, 10)).toBe(false);
    expect(isSequenceInRange(range, 11)).toBe(true);
    expect(isSequenceInRange(range, 25)).toBe(true);
    expect(isSequenceInRange(range, 26)).toBe(false);
  });

  it("a tick's own newly-created events fall outside its own input range by construction", () => {
    const range = computeAmbientEventRange(10, 25);
    // Sequence 26 would be an event the ambient tick itself creates while
    // processing this range — it cannot chain into the same tick.
    expect(isSequenceInRange(range, 26)).toBe(false);
  });
});

describe("computeAmbientEligible: every EVENT_TYPES value classified (D2-I)", () => {
  const EXPECTED: Record<EventType, boolean> = {
    authored_observation: false,
    visit_started: false,
    travelled: false,
    inspected: false,
    clue_discovered: true,
    npc_interaction: false, // ordinary Ask-only, default options
    claim_transmitted: true,
    evidence_shown: false, // no structured effect, default options
    item_transferred: false, // non-evidentiary, default options
    item_relocated: true,
    promise_accepted: true,
    promise_fulfilled: true,
    promise_broken: true,
    capability_changed: false,
    note_added: false,
    visit_ended: false,
    relationship_changed: false,
    source_discredited: true,
    case_attempted: false,
    case_resolved: false,
  };

  it.each(EVENT_TYPES.map((eventType) => [eventType, EXPECTED[eventType]] as const))(
    "classifies %s as eligible=%s by default",
    (eventType, expected) => {
      expect(computeAmbientEligible(eventType)).toBe(expected);
    },
  );

  it("covers every one of the 20 EVENT_TYPES values with no silent gap", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(20);
    expect(new Set(EVENT_TYPES)).toStrictEqual(new Set(Object.keys(EXPECTED)));
  });

  it("npc_interaction becomes eligible with a structured effect", () => {
    expect(
      computeAmbientEligible("npc_interaction", { hasStructuredEffect: true }),
    ).toBe(true);
  });

  it("evidence_shown becomes eligible with a structured effect", () => {
    expect(
      computeAmbientEligible("evidence_shown", { hasStructuredEffect: true }),
    ).toBe(true);
  });

  it("item_transferred becomes eligible when evidentiary", () => {
    expect(computeAmbientEligible("item_transferred", { isEvidentiary: true })).toBe(
      true,
    );
  });
});

describe("planLeave", () => {
  it("advances the boundary unconditionally, even with zero eligible events", () => {
    expect(planLeave(30, 0)).toStrictEqual({
      newScheduledThroughSequence: 30,
      createsOutboxIntent: false,
    });
  });

  it("creates an outbox intent when at least one eligible event was in range", () => {
    expect(planLeave(30, 1)).toStrictEqual({
      newScheduledThroughSequence: 30,
      createsOutboxIntent: true,
    });
  });
});
