/**
 * Absolute operation deadline plumbing (`P3-09`; docs/007 "Processing and HTTP
 * time budget").
 *
 * A request records its application deadline once, at the moment it starts,
 * and every later step derives its own budget from that one clock reading —
 * nothing recomputes `PLAYER_API_TIMING`'s numbers. The final four seconds
 * (`reservedCommitWindowMs`) are reserved for the commit transaction alone:
 * every pre-commit read must finish by `preCommitDeadline()`, and the commit
 * transaction's own statement timeout leaves a further half-second
 * (`responseSerializationReserveMs`) for turning the result back into JSON.
 */

import { DATABASE, PLAYER_API_TIMING } from "@the-town-remembers/runtime-config/game";

export interface OperationDeadline {
  readonly startedAtMs: number;
  readonly applicationBudgetMs: number;
  readonly reservedCommitWindowMs: number;
  readonly responseSerializationReserveMs: number;
}

export function startOperationDeadline(now: Date): OperationDeadline {
  return {
    startedAtMs: now.getTime(),
    applicationBudgetMs: PLAYER_API_TIMING.applicationBudgetMs,
    reservedCommitWindowMs: PLAYER_API_TIMING.reservedCommitWindowMs,
    responseSerializationReserveMs: PLAYER_API_TIMING.responseSerializationReserveMs,
  };
}

/** The absolute instant, in epoch milliseconds, the whole operation must finish by. */
export function applicationDeadlineAt(deadline: OperationDeadline): number {
  return deadline.startedAtMs + deadline.applicationBudgetMs;
}

/** Every pre-commit read or call must end by this instant, leaving the reserved window free. */
export function preCommitDeadline(deadline: OperationDeadline): number {
  return applicationDeadlineAt(deadline) - deadline.reservedCommitWindowMs;
}

/**
 * The final transaction's `statement_timeout`: the smaller of the accepted
 * database ceiling and whatever remains of the application budget, itself
 * reduced by the response-serialization margin. Never zero — a deadline that
 * has already passed still returns 1ms rather than an invalid non-positive
 * timeout, letting the query attempt (and fail on its own terms) rather than
 * silently skip the statement.
 */
export function commitStatementTimeoutMs(
  deadline: OperationDeadline,
  now: Date,
): number {
  const remaining =
    applicationDeadlineAt(deadline) -
    now.getTime() -
    deadline.responseSerializationReserveMs;
  return Math.max(1, Math.min(DATABASE.maximumStatementTimeoutMs, remaining));
}
