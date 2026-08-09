/**
 * Pure planners for the seven action kinds that need no NPC dialogue:
 * `start_visit`, `travel`, `inspect`, `add_note`, `leave`, `accuse`,
 * `resolve`. Each resolves to a complete `DecisionResult` in one call.
 */

import type { PromiseKind } from "@the-town-remembers/database/domains";

import { relationshipDeltaFor } from "../beliefs/relationships.js";
import {
  caseAttemptOutcome,
  canResolve,
  planWinningResolution,
  resolutionReservationExpiresAt,
  type CaseSolutionGuess,
  type CaseSolutionReference,
} from "../board/case.js";
import { deniedResult, type DecisionResult } from "../kernel/decision.js";
import type { EffectPlanEntry } from "../kernel/effects.js";
import { classifyInspectDiscovery, shouldRecordClueDiscovery } from "../world/clues.js";
import {
  keepSecretEndingOutcome,
  returnItemEndingOutcome,
  type EndingChoice,
} from "../world/promises.js";
import {
  canStartNewVisit,
  canTravelTo,
  classifyStartVisit,
  classifyTravel,
  planLeave,
  type LocationAccessState,
  type PriorAmbientJobStatus,
} from "../world/visits.js";
import { dispatcherTrace as makeTrace } from "./dispatcher.js";

// --- start_visit ------------------------------------------------------------------

export interface StartVisitInputs {
  readonly townActive: boolean;
  readonly hasActiveVisit: boolean;
  readonly priorAmbientJobStatus: PriorAmbientJobStatus;
  readonly festivalSquareLocationId: string;
}

export function planStartVisit(
  inputs: StartVisitInputs,
): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.start_visit");
  if (!inputs.townActive) return deniedResult("TOWN_NOT_ACTIVE", trace, {});
  if (!canStartNewVisit(inputs.priorAmbientJobStatus, inputs.hasActiveVisit)) {
    return deniedResult("PRIOR_VISIT_NOT_CLOSED", trace, {});
  }

  if (classifyStartVisit(inputs.hasActiveVisit) === "already_active") {
    return {
      outcome: "no_change",
      reasonCode: "OK",
      effects: [],
      preconditions: {},
      trace,
    };
  }

  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "visit_started", effectIndex: 0 },
    {
      kind: "insert",
      table: "player_visits",
      row: {
        current_location_entity_id: inputs.festivalSquareLocationId,
        status: "active",
      },
    },
  ];
  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}

// --- travel -------------------------------------------------------------------------

export interface TravelInputs {
  readonly currentLocationId: string;
  readonly destinationLocationId: string;
  readonly destinationKnown: boolean;
  readonly destinationAccess: LocationAccessState;
  /** The active visit being travelled on. */
  readonly visitId: string;
  /** Travel conditionally updates the town revision (docs/005 §player_visits). */
  readonly townRevision: number;
}

export function planTravel(inputs: TravelInputs): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.travel", [inputs.destinationLocationId]);
  if (!inputs.destinationKnown) return deniedResult("DESTINATION_UNKNOWN", trace, {});
  if (!canTravelTo(inputs.destinationAccess))
    return deniedResult("LOCATION_LOCKED", trace, {});

  if (
    classifyTravel(inputs.currentLocationId, inputs.destinationLocationId) ===
    "already_there"
  ) {
    return {
      outcome: "no_change",
      reasonCode: "OK",
      effects: [],
      preconditions: {},
      trace,
    };
  }

  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "travelled", effectIndex: 0 },
    {
      kind: "conditional_state_change",
      table: "player_visits",
      key: { id: inputs.visitId },
      expectedRevision: inputs.townRevision,
      change: { current_location_entity_id: inputs.destinationLocationId },
    },
  ];
  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}

// --- inspect --------------------------------------------------------------------------

export interface InspectInputs {
  readonly inspectableId: string;
  readonly hasInspectable: boolean;
  readonly hasClue: boolean;
  readonly clueId: string | null;
  readonly clueAlreadyDiscoveredInTown: boolean;
  readonly clueAlreadyDiscoveredByThisPlayer: boolean;
  readonly playerId: string;
}

export function planInspect(inputs: InspectInputs): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.inspect", [inputs.inspectableId]);
  if (!inputs.hasInspectable) return deniedResult("INSPECTABLE_NOT_FOUND", trace, {});

  const discovery = classifyInspectDiscovery({
    hasInspectable: inputs.hasInspectable,
    hasClue: inputs.hasClue,
    clueAlreadyDiscoveredInTown: inputs.clueAlreadyDiscoveredInTown,
    clueAlreadyDiscoveredByThisPlayer: inputs.clueAlreadyDiscoveredByThisPlayer,
  });

  if (discovery === "already_discovered_by_player" || discovery === "none") {
    return {
      outcome: "no_change",
      reasonCode: "OK",
      effects: [],
      preconditions: {},
      trace,
    };
  }

  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "inspected", effectIndex: 0 },
  ];
  if (shouldRecordClueDiscovery(discovery) && inputs.clueId !== null) {
    effects.push({
      kind: "insert",
      table: "clue_discoveries",
      row: { clue_id: inputs.clueId, player_id: inputs.playerId },
    });
  }
  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}

// --- add_note ---------------------------------------------------------------------------

export interface AddNoteInputs {
  readonly hasActiveVisit: boolean;
  readonly playerId: string;
  readonly text: string;
}

export function planAddNoteAction(
  inputs: AddNoteInputs,
): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.add_note");
  if (!inputs.hasActiveVisit) return deniedResult("VISIT_NOT_ACTIVE", trace, {});

  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "note_added", effectIndex: 0 },
    {
      kind: "insert",
      table: "case_board_entries",
      row: {
        entry_kind: "note",
        verification_status: "unverified_player_note",
        note_text: inputs.text,
        contributed_by_player_id: inputs.playerId,
      },
    },
  ];
  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}

// --- leave --------------------------------------------------------------------------------

export interface LeaveInputs {
  readonly hasActiveVisit: boolean;
  readonly lastEventSequenceAtLeave: number;
  readonly eligibleEventCountInRange: number;
  readonly townId: string;
  readonly townRevision: number;
}

export function planLeaveVisit(inputs: LeaveInputs): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.leave");
  if (!inputs.hasActiveVisit) return deniedResult("VISIT_NOT_ACTIVE", trace, {});

  const leavePlan = planLeave(
    inputs.lastEventSequenceAtLeave,
    inputs.eligibleEventCountInRange,
  );
  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "visit_ended", effectIndex: 0 },
    {
      kind: "conditional_state_change",
      table: "towns",
      key: { id: inputs.townId },
      expectedRevision: inputs.townRevision,
      change: {
        ambient_scheduled_through_sequence: leavePlan.newScheduledThroughSequence,
      },
    },
  ];
  if (leavePlan.createsOutboxIntent) {
    effects.push({
      kind: "insert",
      table: "outbox",
      row: { job_type: "ambient_tick" },
    });
  }
  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}

// --- accuse -------------------------------------------------------------------------------

export interface AccuseInputs {
  readonly confrontationGateOpen: boolean;
  readonly guess: CaseSolutionGuess;
  readonly solution: CaseSolutionReference;
  readonly playerId: string;
  readonly townId: string;
  readonly townRevision: number;
  /** The moment this attempt is won, seeding the ten-minute reservation window. */
  readonly wonAt: Date;
}

export function planAccuse(inputs: AccuseInputs): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.accuse");
  if (!inputs.confrontationGateOpen) return deniedResult("CASE_GATE_LOCKED", trace, {});

  const outcome = caseAttemptOutcome(inputs.guess, inputs.solution);
  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "case_attempted", effectIndex: 0 },
    {
      kind: "insert",
      table: "case_attempts",
      row: {
        outcome,
        player_id: inputs.playerId,
        suspect_entity_id: inputs.guess.suspectId,
        motive_entity_id: inputs.guess.motiveId,
        location_entity_id: inputs.guess.locationId,
      },
    },
  ];
  // A correct attempt atomically reserves the ending choice: the town moves
  // to awaiting_resolution, records the winner, and starts the ten-minute
  // window `resolve` consumes. An incorrect attempt is immutable and applied
  // on its own — it creates shared history, never a silent no_change.
  if (outcome === "correct") {
    effects.push({
      kind: "conditional_state_change",
      table: "towns",
      key: { id: inputs.townId },
      expectedRevision: inputs.townRevision,
      change: {
        status: "awaiting_resolution",
        resolution_owner_player_id: inputs.playerId,
        resolution_reservation_expires_at: resolutionReservationExpiresAt(
          inputs.wonAt,
        ).toISOString(),
      },
    });
  }
  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}

// --- resolve ------------------------------------------------------------------------------

/**
 * One active promise as of resolution time, carrying whichever field its
 * `kind` needs to compute the ending outcome
 * (`world/promises.ts#keepSecretEndingOutcome`/`#returnItemEndingOutcome`).
 */
export interface ResolvePromiseInput {
  readonly promiseId: string;
  readonly npcId: string;
  readonly kind: PromiseKind;
  /** Consulted only for `keep_secret`. */
  readonly protectedClaimEntersPublicResolution: boolean;
  /** Consulted only for `return_item`. */
  readonly requesterHoldsItemAtResolution: boolean;
}

export interface ResolveInputs {
  readonly townAlreadyResolved: boolean;
  readonly playerId: string;
  readonly reservationOwnerPlayerId: string;
  readonly now: Date;
  readonly reservationExpiresAt: Date;
  readonly playerVisitStartedAt: Date;
  readonly winningAttemptEventAt: Date;
  readonly choice: EndingChoice;
  readonly bellCurrentlyAtOldChapel: boolean;
  readonly bellItemId: string;
  readonly bellRevision: number;
  readonly festivalSquareLocationId: string;
  readonly townId: string;
  readonly townRevision: number;
  readonly activePromises: readonly ResolvePromiseInput[];
}

export function planResolve(inputs: ResolveInputs): DecisionResult<EffectPlanEntry> {
  const trace = makeTrace("actions.resolve");
  if (inputs.townAlreadyResolved) {
    return {
      outcome: "no_change",
      reasonCode: "OK",
      effects: [],
      preconditions: {},
      trace,
    };
  }
  if (
    !canResolve(
      inputs.playerId,
      inputs.reservationOwnerPlayerId,
      inputs.now,
      inputs.reservationExpiresAt,
      inputs.playerVisitStartedAt,
      inputs.winningAttemptEventAt,
    )
  ) {
    return deniedResult("RESOLUTION_NOT_ELIGIBLE", trace, {});
  }

  const winningPlan = planWinningResolution(
    inputs.choice,
    inputs.bellCurrentlyAtOldChapel,
  );
  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "case_resolved", effectIndex: 0 },
    {
      kind: "insert",
      table: "town_resolutions",
      row: { choice: winningPlan.choice, chosen_by_player_id: inputs.playerId },
    },
    {
      kind: "conditional_state_change",
      table: "towns",
      key: { id: inputs.townId },
      expectedRevision: inputs.townRevision,
      change: { status: "resolved" },
    },
  ];
  if (winningPlan.relocatesFestivalBell) {
    effects.push(
      {
        kind: "event_origin",
        eventType: "item_relocated",
        effectIndex: effects.length,
      },
      {
        kind: "conditional_state_change",
        table: "items",
        key: { id: inputs.bellItemId },
        expectedRevision: inputs.bellRevision,
        change: { location_entity_id: inputs.festivalSquareLocationId },
      },
    );
  }

  for (const promise of inputs.activePromises.toSorted((left, right) =>
    left.promiseId.localeCompare(right.promiseId),
  )) {
    const outcome =
      promise.kind === "keep_secret"
        ? keepSecretEndingOutcome(
            inputs.choice,
            promise.protectedClaimEntersPublicResolution,
          )
        : returnItemEndingOutcome(promise.requesterHoldsItemAtResolution);
    if (outcome === "unchanged") continue;

    const delta = relationshipDeltaFor(
      outcome === "fulfilled" ? "promise_fulfilled" : "promise_broken",
    );
    effects.push(
      {
        kind: "conditional_state_change",
        table: "promises",
        key: { id: promise.promiseId },
        expectedRevision: inputs.townRevision,
        change: { status: outcome },
      },
      {
        kind: "insert",
        table: "relationship_changes",
        row: {
          npc_id: promise.npcId,
          promise_id: promise.promiseId,
          trust_delta: delta.trust,
          suspicion_delta: delta.suspicion,
        },
      },
    );
  }

  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}
