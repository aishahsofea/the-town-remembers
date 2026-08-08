/**
 * Visits, travel, notes, and event classification.
 */

import type { EventType } from "@the-town-remembers/database/domains";

// --- Start Visit ------------------------------------------------------------

export type VisitStartDisposition = "started" | "already_active";

/** An already-active visit is a `no_change` result, matching `disposition: already_active`. */
export function classifyStartVisit(hasActiveVisit: boolean): VisitStartDisposition {
  return hasActiveVisit ? "already_active" : "started";
}

export type PriorAmbientJobStatus = "processing" | "completed" | "quarantined" | "none";

/**
 * A new visit may start once the player has no active visit and their prior
 * visit's ambient job (if any) has finished — `processing` or `quarantined`
 * blocks a new visit until it completes.
 */
export function canStartNewVisit(
  priorAmbientJobStatus: PriorAmbientJobStatus,
  hasActiveVisit: boolean,
): boolean {
  if (hasActiveVisit) return true;
  return priorAmbientJobStatus === "completed" || priorAmbientJobStatus === "none";
}

// --- Travel -------------------------------------------------------------------

export type TravelDisposition = "arrived" | "already_there";

export function classifyTravel(
  currentLocationId: string,
  destinationLocationId: string,
): TravelDisposition {
  return currentLocationId === destinationLocationId ? "already_there" : "arrived";
}

export interface LocationAccessState {
  readonly state: "open" | "locked";
}

export function canTravelTo(access: LocationAccessState): boolean {
  return access.state === "open";
}

// --- Notes ----------------------------------------------------------------------

/**
 * `Note` produces no clue/gate/belief/promise effect and does not
 * re-validate text shape — the HTTP boundary's `NoteTextSchema` already
 * bounds it at 1–280 trimmed grapheme clusters. This module's only job is
 * visit-state and immutable-attribution mechanics.
 */
export interface AddNoteResult {
  readonly disposition: "added";
}

export function planAddNote(): AddNoteResult {
  return { disposition: "added" };
}

// --- Event range (D2-H) --------------------------------------------------------

export interface AmbientEventRange {
  readonly lowerExclusive: number;
  readonly upperInclusive: number;
}

/** The next disjoint `(scheduledThrough, lastEvent]` range, evaluated once at `Leave`. */
export function computeAmbientEventRange(
  scheduledThroughSequence: number,
  lastEventSequenceAtLeave: number,
): AmbientEventRange {
  return {
    lowerExclusive: scheduledThroughSequence,
    upperInclusive: lastEventSequenceAtLeave,
  };
}

export function isSequenceInRange(
  range: AmbientEventRange,
  sequenceNo: number,
): boolean {
  return sequenceNo > range.lowerExclusive && sequenceNo <= range.upperInclusive;
}

// --- ambient_eligible (D2-I) -----------------------------------------------------

/**
 * Assigned once, at event-creation time, from this fixed table. Explicit in
 * Decision 008: travel, ordinary `Ask`-only interaction, inspection alone,
 * notes, and non-evidentiary custody movement are ineligible; structured
 * belief creation or a material change is eligible. Every other value here
 * is this plan's own classification (`D2-I`), reviewable as a single table
 * rather than scattered across call sites.
 */
const STATICALLY_INELIGIBLE: ReadonlySet<EventType> = new Set([
  "travelled",
  "inspected",
  "note_added",
  "visit_started",
  "visit_ended",
  "capability_changed",
  "case_attempted",
  "case_resolved",
  "relationship_changed",
  "authored_observation",
]);

const STATICALLY_ELIGIBLE: ReadonlySet<EventType> = new Set([
  "claim_transmitted",
  "promise_accepted",
  "promise_fulfilled",
  "promise_broken",
  "source_discredited",
  "item_relocated",
  "clue_discovered",
]);

export interface AmbientEligibilityOptions {
  /** Consulted only for `npc_interaction` and `evidence_shown`. */
  readonly hasStructuredEffect?: boolean;
  /** Consulted only for `item_transferred`. */
  readonly isEvidentiary?: boolean;
}

export function computeAmbientEligible(
  eventType: EventType,
  options: AmbientEligibilityOptions = {},
): boolean {
  if (STATICALLY_ELIGIBLE.has(eventType)) return true;
  if (STATICALLY_INELIGIBLE.has(eventType)) return false;

  if (eventType === "npc_interaction" || eventType === "evidence_shown") {
    return options.hasStructuredEffect === true;
  }
  if (eventType === "item_transferred") {
    return options.isEvidentiary === true;
  }
  return false;
}

// --- Leave ------------------------------------------------------------------------

export interface LeavePlan {
  /** The boundary advances unconditionally, even when the range had no eligible event. */
  readonly newScheduledThroughSequence: number;
  /** An outbox intent is created only when the range contains at least one eligible event. */
  readonly createsOutboxIntent: boolean;
}

export function planLeave(
  lastEventSequenceAtLeave: number,
  eligibleEventCountInRange: number,
): LeavePlan {
  return {
    newScheduledThroughSequence: lastEventSequenceAtLeave,
    createsOutboxIntent: eligibleEventCountInRange > 0,
  };
}
