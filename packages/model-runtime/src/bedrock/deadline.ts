/**
 * `D4-L`'s admission check: a step starts only if
 * `now + worstCase(step) <= applicationDeadline - reserve`. `model-runtime`
 * cannot depend on `game-server`'s `OperationDeadline` (wrong dependency
 * direction), so this is the same arithmetic over plain, caller-supplied
 * values instead — `game-server` computes `applicationDeadlineAt` and the
 * reserve from `runtime-config#PLAYER_API_TIMING` and passes them in.
 */

export interface ConverseFitCheck {
  readonly now: Date;
  readonly applicationDeadlineAt: Date;
  readonly worstCaseMs: number;
  readonly reserveMs: number;
}

export function fitsBeforeReserve(check: ConverseFitCheck): boolean {
  return (
    check.now.getTime() + check.worstCaseMs <=
    check.applicationDeadlineAt.getTime() - check.reserveMs
  );
}
