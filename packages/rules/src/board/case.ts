/**
 * Confrontation gate, accusation, resolution reservation, the winning
 * resolution's atomic plan, and the ending rumour count.
 */

import { RULES_REGISTRY } from "../kernel/version.js";
import type { EndingChoice } from "../world/promises.js";

// --- Confrontation gate -------------------------------------------------------

export interface ConfrontationGateInputs {
  readonly bellRevealed: boolean;
  readonly requiredDiscoveredCount: number;
  readonly requiredTotalCount: number;
}

/**
 * `content#REQUIRED_CLUE_KEYS` names three of the seven authored clues;
 * `content#EVIDENCE_GATE_LOCKED_MESSAGE` is reused verbatim by the caller
 * when this returns `false` — never restated here.
 */
export function isConfrontationGateOpen(inputs: ConfrontationGateInputs): boolean {
  return (
    inputs.bellRevealed &&
    inputs.requiredTotalCount > 0 &&
    inputs.requiredDiscoveredCount === inputs.requiredTotalCount
  );
}

// --- Accusation ------------------------------------------------------------------

export interface CaseSolutionGuess {
  readonly suspectId: string;
  readonly motiveId: string;
  readonly locationId: string;
}

export interface CaseSolutionReference {
  readonly culpritKey: string;
  readonly motiveKey: string;
  readonly locationKey: string;
}

/**
 * Reuses `content#CASE_SOLUTION` directly. No partial credit and no model
 * judgment: every field must match exactly.
 */
export function isCorrectSolution(
  guess: CaseSolutionGuess,
  solution: CaseSolutionReference,
): boolean {
  return (
    guess.suspectId === solution.culpritKey &&
    guess.motiveId === solution.motiveKey &&
    guess.locationId === solution.locationKey
  );
}

export type CaseAttemptOutcome = "correct" | "incorrect";

export function caseAttemptOutcome(
  guess: CaseSolutionGuess,
  solution: CaseSolutionReference,
): CaseAttemptOutcome {
  return isCorrectSolution(guess, solution) ? "correct" : "incorrect";
}

// --- Resolution reservation --------------------------------------------------------

export function resolutionReservationExpiresAt(wonAt: Date): Date {
  return new Date(
    wonAt.getTime() + RULES_REGISTRY.resolutionReservationMinutes * 60_000,
  );
}

export function isResolutionReservationActive(
  now: Date,
  reservationExpiresAt: Date,
): boolean {
  return now.getTime() < reservationExpiresAt.getTime();
}

/** After expiry, only a player whose visit began no later than the winning attempt may resolve. */
export function isEligibleToResolveAfterExpiry(
  playerVisitStartedAt: Date,
  winningAttemptEventAt: Date,
): boolean {
  return playerVisitStartedAt.getTime() <= winningAttemptEventAt.getTime();
}

export function canResolve(
  playerId: string,
  reservationOwnerPlayerId: string,
  now: Date,
  reservationExpiresAt: Date,
  playerVisitStartedAt: Date,
  winningAttemptEventAt: Date,
): boolean {
  if (isResolutionReservationActive(now, reservationExpiresAt)) {
    return playerId === reservationOwnerPlayerId;
  }
  return isEligibleToResolveAfterExpiry(playerVisitStartedAt, winningAttemptEventAt);
}

// --- Winning-resolution atomic plan -------------------------------------------------

export interface WinningResolutionPlan {
  readonly choice: EndingChoice;
  /** Conditional on the bell still being at old_chapel at commit time (D2-P). */
  readonly relocatesFestivalBell: boolean;
}

/**
 * The bell relocates only if it is still at `old_chapel` at the moment this
 * plan commits — the condition under which "a concurrent or replayed loser
 * produces no second relocation" holds automatically, without a separate
 * concurrency check bolted on afterward (`D2-P`).
 */
export function planWinningResolution(
  choice: EndingChoice,
  bellCurrentlyAtOldChapel: boolean,
): WinningResolutionPlan {
  return { choice, relocatesFestivalBell: bellCurrentlyAtOldChapel };
}

// --- Ending rumour count --------------------------------------------------------------

export interface AmbientClaimTransmissionRecord {
  readonly claimKey: string;
  readonly originKind: "player_action" | "ambient_job" | "system_seed";
  readonly eventSequence: number;
}

/**
 * The number of distinct `content#ENDING_FALSE_CLAIM_KEYS` that received at
 * least one NPC-to-NPC `claim_transmitted` event with `origin_kind:
 * "ambient_job"` strictly before the winning `case_resolved` event —
 * excluding seed, player-origin, and post-resolution transmissions.
 * Multiple hops of the same claim count once.
 */
export function computeEndingRumourCount(
  transmissions: readonly AmbientClaimTransmissionRecord[],
  endingFalseClaimKeys: readonly string[],
  winningCaseResolvedSequence: number,
): number {
  const falseClaimKeys = new Set(endingFalseClaimKeys);
  const qualifyingKeys = new Set<string>();

  for (const transmission of transmissions) {
    if (transmission.originKind !== "ambient_job") continue;
    if (transmission.eventSequence >= winningCaseResolvedSequence) continue;
    if (!falseClaimKeys.has(transmission.claimKey)) continue;
    qualifyingKeys.add(transmission.claimKey);
  }

  return qualifyingKeys.size;
}
