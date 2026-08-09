/**
 * Loads `BELL_MYSTERY_V1` and replays a named scenario through the action
 * planners with injected fakes — no server, no persistence, no model.
 * `scripts/rules-scenario.mjs` (`D2-M`) wraps this for CLI use.
 */

import { domainSeparatedDigest } from "@the-town-remembers/serialization";

import {
  planAccuse,
  planInspect,
  planResolve,
  planStartVisit,
  planTravel,
} from "../actions/deterministic.js";
import {
  isExternalSelectionRequired,
  resumeWithDialogue,
} from "../actions/dispatcher.js";
import { planShow } from "../actions/model-backed.js";
import {
  ACTION_ID,
  BELL_ITEM_ID,
  CASE_ATTEMPT_ID,
  CASE_SOLUTION_REFERENCE,
  CORRECT_GUESS,
  EVIDENCE_SHOWN_EVENT_ID,
  FESTIVAL_SQUARE_LOCATION_ID,
  INCORRECT_GUESS,
  PLAYER_ID,
  RESOLUTION_EVENT_ID,
  TOWN_ID,
  VISIT_ID,
} from "./fixtures.js";

export interface ScenarioStepRecord {
  readonly actionKind: string;
  readonly result: unknown;
}

export const SCENARIO_NAMES = [
  "start_and_travel",
  "inspect_new_to_town",
  "both_accusation_outcomes",
  "both_endings",
  "show_evidence_flow",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

function startAndTravel(): readonly ScenarioStepRecord[] {
  const start = planStartVisit({
    townActive: true,
    hasActiveVisit: false,
    priorAmbientJobStatus: "none",
    festivalSquareLocationId: FESTIVAL_SQUARE_LOCATION_ID,
  });
  const travelOut = planTravel({
    currentLocationId: FESTIVAL_SQUARE_LOCATION_ID,
    destinationLocationId: "lantern_inn",
    destinationKnown: true,
    destinationAccess: { state: "open" },
    visitId: VISIT_ID,
    townId: TOWN_ID,
    townRevision: 0,
  });
  const travelAgain = planTravel({
    currentLocationId: "lantern_inn",
    destinationLocationId: "lantern_inn",
    destinationKnown: true,
    destinationAccess: { state: "open" },
    visitId: VISIT_ID,
    townId: TOWN_ID,
    townRevision: 1,
  });
  return [
    { actionKind: "start_visit", result: start },
    { actionKind: "travel", result: travelOut },
    { actionKind: "travel", result: travelAgain },
  ];
}

function inspectNewToTown(): readonly ScenarioStepRecord[] {
  const first = planInspect({
    inspectableId: "empty_bell_frame",
    hasInspectable: true,
    hasClue: true,
    clueId: "bent_clapper_pin",
    clueAlreadyDiscoveredInTown: false,
    clueAlreadyDiscoveredByThisPlayer: false,
    playerId: PLAYER_ID,
  });
  const repeat = planInspect({
    inspectableId: "empty_bell_frame",
    hasInspectable: true,
    hasClue: true,
    clueId: "bent_clapper_pin",
    clueAlreadyDiscoveredInTown: true,
    clueAlreadyDiscoveredByThisPlayer: true,
    playerId: PLAYER_ID,
  });
  return [
    { actionKind: "inspect", result: first },
    { actionKind: "inspect", result: repeat },
  ];
}

function bothAccusationOutcomes(): readonly ScenarioStepRecord[] {
  const wonAt = new Date("2026-01-01T00:00:00.000Z");
  const incorrect = planAccuse({
    confrontationGateOpen: true,
    guess: INCORRECT_GUESS,
    solution: CASE_SOLUTION_REFERENCE,
    playerId: PLAYER_ID,
    townId: TOWN_ID,
    townRevision: 0,
    wonAt,
    caseAttemptId: "case-attempt-incorrect",
  });
  const correct = planAccuse({
    confrontationGateOpen: true,
    guess: CORRECT_GUESS,
    solution: CASE_SOLUTION_REFERENCE,
    playerId: PLAYER_ID,
    townId: TOWN_ID,
    townRevision: 1,
    wonAt,
    caseAttemptId: CASE_ATTEMPT_ID,
  });
  return [
    { actionKind: "accuse", result: incorrect },
    { actionKind: "accuse", result: correct },
  ];
}

function bothEndings(): readonly ScenarioStepRecord[] {
  const baseTimes = {
    now: new Date("2026-01-01T00:05:00.000Z"),
    reservationExpiresAt: new Date("2026-01-01T00:10:00.000Z"),
    playerVisitStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    winningAttemptEventAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const exposeCoverUp = planResolve({
    townAlreadyResolved: false,
    playerId: PLAYER_ID,
    reservationOwnerPlayerId: PLAYER_ID,
    ...baseTimes,
    choice: "expose_cover_up",
    bellCurrentlyAtOldChapel: true,
    bellItemId: BELL_ITEM_ID,
    bellRevision: 0,
    festivalSquareLocationId: FESTIVAL_SQUARE_LOCATION_ID,
    townId: TOWN_ID,
    townRevision: 0,
    winningCaseAttemptId: CASE_ATTEMPT_ID,
    actionId: ACTION_ID,
    resolutionEventId: RESOLUTION_EVENT_ID,
    activeVisits: [],
    activePromises: [],
  });
  const restoreQuietly = planResolve({
    townAlreadyResolved: false,
    playerId: PLAYER_ID,
    reservationOwnerPlayerId: PLAYER_ID,
    ...baseTimes,
    choice: "restore_bell_quietly",
    bellCurrentlyAtOldChapel: true,
    bellItemId: BELL_ITEM_ID,
    bellRevision: 1,
    festivalSquareLocationId: FESTIVAL_SQUARE_LOCATION_ID,
    townId: TOWN_ID,
    townRevision: 1,
    winningCaseAttemptId: CASE_ATTEMPT_ID,
    actionId: ACTION_ID,
    resolutionEventId: RESOLUTION_EVENT_ID,
    activeVisits: [],
    activePromises: [],
  });
  return [
    { actionKind: "resolve", result: exposeCoverUp },
    { actionKind: "resolve", result: restoreQuietly },
  ];
}

function showEvidenceFlow(): readonly ScenarioStepRecord[] {
  const pending = planShow({
    evidenceKind: "clue",
    clueDiscoveredInTown: true,
    itemCurrentlyHeldByPlayer: false,
    shownClueIds: ["bent_clapper_pin"],
    clueClaimEffects: [
      { clueId: "bent_clapper_pin", claimId: "lark_damaged_bell", signedWeight: 70 },
    ],
    alreadyRecordedEvidence: [],
    claimBeliefs: [{ claimId: "lark_damaged_bell", score: 0, revision: 0 }],
    relationshipReasons: [
      { reasonKind: "verified_testimony", claimId: "lark_damaged_bell" },
      { reasonKind: "evidence_presented", clueId: "bent_clapper_pin" },
    ],
    npcId: "mara_venn",
    playerId: PLAYER_ID,
    evidenceShownEventId: EVIDENCE_SHOWN_EVENT_ID,
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
  });
  const resolved = isExternalSelectionRequired(pending)
    ? resumeWithDialogue(pending, {
        npcId: "mara_venn",
        text: "That does look like the bell's clapper pin.",
        responseMode: "authored",
      })
    : pending;
  return [{ actionKind: "show", result: resolved }];
}

const SCENARIOS: Record<ScenarioName, () => readonly ScenarioStepRecord[]> = {
  start_and_travel: startAndTravel,
  inspect_new_to_town: inspectNewToTown,
  both_accusation_outcomes: bothAccusationOutcomes,
  both_endings: bothEndings,
  show_evidence_flow: showEvidenceFlow,
};

export function runScenario(name: ScenarioName): readonly ScenarioStepRecord[] {
  return SCENARIOS[name]();
}

export const SCENARIO_DIGEST_DOMAIN = "rules-scenario:v1";

export function computeScenarioDigest(name: ScenarioName): string {
  return domainSeparatedDigest(SCENARIO_DIGEST_DOMAIN, runScenario(name));
}
