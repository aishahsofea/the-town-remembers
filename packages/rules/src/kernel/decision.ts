/**
 * The shared result shape every pure rule function returns.
 *
 * `DecisionOutcome` is deliberately a four-member union — `allowed` is the
 * step-1 precondition gate in Decision 008's five-step action order, distinct
 * from the terminal three-member `ActionOutcome`
 * (`database/domains.ts#ACTION_OUTCOMES`) that `P2-17` maps it to at step 5.
 */

import type { ReasonCode } from "./reason-codes.js";
import type { RuleTrace } from "./trace.js";

export type DecisionOutcome = "allowed" | "applied" | "no_change" | "denied";

export interface DecisionPreconditions {
  readonly expectedRevision?: number;
}

export interface DecisionResult<
  TEffect,
  TPreconditions extends DecisionPreconditions = DecisionPreconditions,
> {
  readonly outcome: DecisionOutcome;
  readonly reasonCode: ReasonCode;
  readonly effects: readonly TEffect[];
  readonly preconditions: TPreconditions;
  readonly trace: RuleTrace;
}

export function deniedResult<TEffect, TPreconditions extends DecisionPreconditions>(
  reasonCode: ReasonCode,
  trace: RuleTrace,
  preconditions: TPreconditions,
): DecisionResult<TEffect, TPreconditions> {
  return { outcome: "denied", reasonCode, effects: [], preconditions, trace };
}
