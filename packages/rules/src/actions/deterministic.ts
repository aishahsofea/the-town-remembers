/**
 * Pure planners for the seven action kinds that need no NPC dialogue:
 * `start_visit`, `travel`, `inspect`, `add_note`, `leave`, `accuse`,
 * `resolve`. Each resolves to a complete `DecisionResult` in one call.
 */

import type { PromiseKind } from "@the-town-remembers/database/domains";

import {
  relationshipDeltaFor,
  type RelationshipContribution,
  type RelationshipSnapshot,
} from "../beliefs/relationships.js";
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
import { RULES_REGISTRY } from "../kernel/version.js";
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
  computeAmbientEventRange,
  planLeave,
  type LocationAccessState,
  type PriorAmbientJobStatus,
} from "../world/visits.js";
import { dispatcherTrace as makeTrace } from "./dispatcher.js";
import { relationshipStateChangeEffects } from "./relationship-effects.js";

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
  readonly townId: string;
  /** `player_visits` has no revision column; the town's own revision guards the plan. */
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
      table: "towns",
      key: { id: inputs.townId },
      expectedRevision: inputs.townRevision,
      change: {},
    },
    {
      kind: "conditional_state_change",
      table: "player_visits",
      key: { id: inputs.visitId },
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
  readonly townId: string;
  /** `clue_discoveries`/`case_board_entries` have no unique guard against a
   * concurrent double board-entry (`P3-11` §"exactly one board entry" —
   * see acceptance 3), so a real towns-revision guard is what makes the
   * loser of a race replay through `D3-O`'s reload-and-replan loop rather
   * than committing a second contradictory record. */
  readonly townRevision: number;
  /** The player's current location — also the revealed item's resting place
   * for a non-portable reveal, since inspecting always happens from the
   * inspectable's own location. */
  readonly locationEntityId: string;
  readonly revealsItemId: string | null;
  /** An inspectable's item reveal is independent of its clue, if it even has
   * one — `square_bench_glint` reveals `nessas_field_lens` with no clue at
   * all. `revealed_event_id` is immutable once set (docs/005), so this is
   * the reveal's own once-only gate, entirely separate from
   * `clueAlreadyDiscoveredInTown`. */
  readonly itemAlreadyRevealed: boolean;
  readonly revealedItemPortable: boolean;
  readonly revealedItemRevision: number;
  /** A second, independent guard against the same double-board-entry race:
   * even if `clueAlreadyDiscoveredInTown` were somehow stale, a board entry
   * that already exists for this clue is never inserted twice. */
  readonly boardEntryAlreadyExists: boolean;
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
  const discoversNewClue =
    shouldRecordClueDiscovery(discovery) && inputs.clueId !== null;
  const revealsNewItem = inputs.revealsItemId !== null && !inputs.itemAlreadyRevealed;

  if (!discoversNewClue && !revealsNewItem) {
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
    {
      kind: "conditional_state_change",
      table: "towns",
      key: { id: inputs.townId },
      expectedRevision: inputs.townRevision,
      change: {},
    },
  ];
  if (discoversNewClue) {
    effects.push({
      kind: "insert",
      table: "clue_discoveries",
      row: { clue_id: inputs.clueId, player_id: inputs.playerId },
    });
  }
  // The shared board record happens exactly once, the moment this clue first
  // becomes known to the town — never on a later player's own first look at
  // the same evidence (`D3-I`; docs/006's "first shared verified-evidence
  // board record").
  if (
    discovery === "new_to_town" &&
    !inputs.boardEntryAlreadyExists &&
    inputs.clueId !== null
  ) {
    effects.push({
      kind: "insert",
      table: "case_board_entries",
      row: {
        entry_kind: "verified_evidence",
        verification_status: "verified_physical",
        clue_id: inputs.clueId,
        contributed_by_player_id: inputs.playerId,
      },
    });
  }
  if (revealsNewItem) {
    effects.push({
      kind: "conditional_state_change",
      table: "items",
      key: { id: inputs.revealsItemId },
      expectedRevision: inputs.revealedItemRevision,
      change: inputs.revealedItemPortable
        ? {
            held_by_actor_id: inputs.playerId,
            location_entity_id: null,
            location_entity_type: null,
          }
        : {},
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
  /**
   * `towns.ambient_scheduled_through_sequence` as this plan read it — the
   * exclusive lower bound of the range this departure claims. Concurrent
   * departures get disjoint ranges precisely because each one starts where
   * the last committed one stopped.
   */
  readonly ambientScheduledThroughSequence: number;
  readonly townId: string;
  readonly townRevision: number;
  readonly visitId: string;
  readonly actionId: string;
  readonly now: Date;
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
    {
      kind: "conditional_state_change",
      table: "player_visits",
      key: { id: inputs.visitId },
      change: {
        status: "ended",
        end_revision: inputs.townRevision + 1,
        ended_at: inputs.now.toISOString(),
        ended_by_action_id: inputs.actionId,
        end_reason: "left_town",
      },
    },
  ];
  if (leavePlan.createsOutboxIntent) {
    // The job is bound to the departing visit and to the half-open range
    // `(scheduled_through, last_event]` it is allowed to react to; without
    // both, `uq_outbox__visit_job_type` and `ck_outbox__range` reject it and
    // a second tick could re-read the same events.
    const range = computeAmbientEventRange(
      inputs.ambientScheduledThroughSequence,
      inputs.lastEventSequenceAtLeave,
    );
    effects.push({
      kind: "insert",
      table: "outbox",
      row: {
        job_type: "ambient_tick",
        visit_id: inputs.visitId,
        after_event_sequence: range.lowerExclusive,
        through_event_sequence: range.upperInclusive,
      },
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
  /**
   * Pre-allocated by the caller so this same attempt can be referenced by
   * `towns.winning_case_attempt_id` within this plan — a rule can never
   * generate the id itself.
   */
  readonly caseAttemptId: string;
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
        id: inputs.caseAttemptId,
        outcome,
        player_id: inputs.playerId,
        suspect_entity_id: inputs.guess.suspectId,
        motive_entity_id: inputs.guess.motiveId,
        location_entity_id: inputs.guess.locationId,
      },
    },
  ];
  // A correct attempt atomically reserves the ending choice: the town moves
  // to awaiting_resolution, records the winner and the winning attempt, and
  // starts the ten-minute window `resolve` consumes. An incorrect attempt is
  // immutable and applied on its own — it creates shared history, never a
  // silent no_change.
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
        winning_case_attempt_id: inputs.caseAttemptId,
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
  readonly playerId: string;
  readonly kind: PromiseKind;
  /** Consulted only for `keep_secret`. */
  readonly protectedClaimEntersPublicResolution: boolean;
  /** Consulted only for `return_item`. */
  readonly requesterHoldsItemAtResolution: boolean;
}

/** One other player's still-active visit, ended with `town_resolved` by this same transaction. */
export interface ResolveActiveVisit {
  readonly visitId: string;
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
  /** The winning accusation's id, recorded on `towns` when it was accepted. */
  readonly winningCaseAttemptId: string;
  /** This Resolve action's own id, recorded as every ended visit's closer. */
  readonly actionId: string;
  /** The pre-allocated id of the `case_resolved` event this plan creates. */
  readonly resolutionEventId: string;
  readonly activeVisits: readonly ResolveActiveVisit[];
  readonly activePromises: readonly ResolvePromiseInput[];
  /**
   * The current relationship row for every (npc, player) pair a settling
   * promise touches. Two promises between the same pair are summed against
   * one snapshot and clamped once, so only one row per pair is needed.
   */
  readonly relationships: readonly RelationshipSnapshot[];
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
      row: {
        choice: winningPlan.choice,
        chosen_by_player_id: inputs.playerId,
        case_attempt_id: inputs.winningCaseAttemptId,
      },
    },
    {
      kind: "conditional_state_change",
      table: "towns",
      key: { id: inputs.townId },
      expectedRevision: inputs.townRevision,
      change: { status: "resolved", resolved_at: inputs.now.toISOString() },
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

  for (const visit of inputs.activeVisits.toSorted((left, right) =>
    left.visitId.localeCompare(right.visitId),
  )) {
    effects.push({
      kind: "conditional_state_change",
      table: "player_visits",
      key: { id: visit.visitId },
      change: {
        status: "ended",
        end_revision: inputs.townRevision + 1,
        ended_at: inputs.now.toISOString(),
        ended_by_action_id: inputs.actionId,
        end_reason: "town_resolved",
      },
    });
  }

  const relationshipContributions: RelationshipContribution[] = [];
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

    const reasonKind = outcome === "fulfilled" ? "promise_fulfilled" : "promise_broken";
    const delta = relationshipDeltaFor(reasonKind);
    relationshipContributions.push({
      npcId: promise.npcId,
      playerId: promise.playerId,
      reasonKind,
    });
    effects.push(
      {
        kind: "conditional_state_change",
        table: "promises",
        key: { id: promise.promiseId },
        change: { status: outcome, resolved_event_id: inputs.resolutionEventId },
      },
      {
        kind: "insert",
        table: "relationship_changes",
        row: {
          npc_id: promise.npcId,
          player_id: promise.playerId,
          reason_kind: reasonKind,
          rule_version: RULES_REGISTRY.rulesVersion,
          promise_id: promise.promiseId,
          trust_delta: delta.trust,
          suspicion_delta: delta.suspicion,
        },
      },
    );
  }
  effects.push(
    ...relationshipStateChangeEffects(
      inputs.relationships,
      relationshipContributions,
      inputs.resolutionEventId,
    ),
  );

  return { outcome: "applied", reasonCode: "OK", effects, preconditions: {}, trace };
}
