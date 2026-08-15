/**
 * `D4-K`: the closed gate-result vocabulary a model-backed action's
 * deterministic gate produces before dialogue selection.
 *
 * Decision 009 names "gate result" as the fourth key of the authored
 * fallback lookup (alongside NPC, action kind, and response kind) and as one
 * of `dialogue_directive`'s two inputs, but enumerates no values. A closed
 * domain here — rather than a free-form string chosen ad hoc per call site —
 * is what lets `rules/content-validation/fallback-coverage.ts` check the
 * authored fallback table for completeness at content-authoring time instead
 * of discovering a missing case at runtime.
 */

export const GATE_RESULTS = [
  /** The deterministic gate raised no denial; dialogue selection proceeds normally. */
  "passed",
  "denied_disclosure_tier",
  "denied_belief",
  "denied_access",
  "denied_custody",
  "denied_promise_context",
  "denied_draft_state",
  "no_disclosure_available",
  "town_frozen",
] as const;

export type GateResult = (typeof GATE_RESULTS)[number];

const GATE_RESULT_SET: ReadonlySet<string> = new Set(GATE_RESULTS);

export function isGateResult(value: string): value is GateResult {
  return GATE_RESULT_SET.has(value);
}
