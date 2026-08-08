/**
 * Inspection-safe rule traces.
 *
 * A trace explains a decision to an operator reading `inspection.*` views: it
 * names the rule version, the stable keys the rule matched against, the
 * inputs it consulted, and the reason code it produced. It is never sent to
 * a player. Its field names are structurally disjoint from every
 * player-facing type's field names, checked the same way
 * `packages/http-contracts/src/leakage.test.ts` checks the reverse
 * direction, so a future spread of a trace into a response body would show
 * up as a duplicate key rather than passing silently.
 */

import type { ReasonCode } from "./reason-codes.js";

export interface RuleTrace {
  readonly rulesVersion: string;
  readonly ruleName: string;
  /** Authored or canonical keys the rule matched against (never a raw UUID alone). */
  readonly matchedStableKeys: readonly string[];
  /** Named inputs the rule consulted, for operator inspection only. */
  readonly evaluatedInputs: Readonly<Record<string, unknown>>;
  /**
   * Named distinctly from `DecisionResult.reasonCode` (which a player-facing
   * `DeniedActionResult.reasonCode` receives unchanged, per `D2-K`) so this
   * type never shares a field name with a player-safe type.
   */
  readonly matchedReasonCode: ReasonCode;
}

export function ruleTrace(
  fields: Omit<RuleTrace, "evaluatedInputs"> & {
    readonly evaluatedInputs?: Readonly<Record<string, unknown>>;
  },
): RuleTrace {
  return {
    rulesVersion: fields.rulesVersion,
    ruleName: fields.ruleName,
    matchedStableKeys: fields.matchedStableKeys,
    evaluatedInputs: fields.evaluatedInputs ?? {},
    matchedReasonCode: fields.matchedReasonCode,
  };
}
