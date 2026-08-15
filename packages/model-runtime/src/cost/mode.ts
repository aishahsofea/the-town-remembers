/**
 * Decision 004's monthly-spend ladder. `$10.35` is the accepted **hard**
 * model-cost fallback ("the cap is an application control, not a real-time
 * billing guarantee") — at or above it, no further model call may be
 * admitted at all, and every model-backed action uses its authored
 * fallback. `$9.50` is the "tighten" point (Decision 004: "stop new
 * towns") and `$8.00` is where dialogue switches from Sonnet to Haiku.
 * Both `$8.00` and `$9.50` also run in reduced-cost (Haiku) mode; `tighten`
 * only adds the stop-new-towns signal on top.
 */

export const COST_MODE_THRESHOLDS_USD = Object.freeze({
  reducedCost: 8.0,
  tighten: 9.5,
  hardCap: 10.35,
});

export const COST_MODE_THRESHOLDS_MICRO_USD = Object.freeze({
  reducedCost: 8_000_000,
  tighten: 9_500_000,
  hardCap: 10_350_000,
});

export const COST_MODES = [
  "normal",
  "reduced_cost",
  "tighten",
  "fallback_only",
] as const;
export type CostMode = (typeof COST_MODES)[number];

/** `monthlySpendMicroUsd` should already include this call's own worst-case reservation — admission checks the state a commit would produce, not the state before it. */
export function resolveCostMode(monthlySpendMicroUsd: number): CostMode {
  if (monthlySpendMicroUsd >= COST_MODE_THRESHOLDS_MICRO_USD.hardCap)
    return "fallback_only";
  if (monthlySpendMicroUsd >= COST_MODE_THRESHOLDS_MICRO_USD.tighten) return "tighten";
  if (monthlySpendMicroUsd >= COST_MODE_THRESHOLDS_MICRO_USD.reducedCost) {
    return "reduced_cost";
  }
  return "normal";
}

/** Sonnet dialogue only in "normal" mode; every other mode uses Haiku (or, under fallback_only, no model call at all). */
export function reducedCostModeActive(mode: CostMode): boolean {
  return mode !== "normal";
}

/** False only under the hard cap — every other mode still admits model calls, just at Haiku's rate. */
export function modelCallsAdmitted(mode: CostMode): boolean {
  return mode !== "fallback_only";
}

/** True from the "tighten" threshold on — an operator-facing signal, not something this package enforces itself (town creation lives in game-server). */
export function shouldStopNewTowns(mode: CostMode): boolean {
  return mode === "tighten" || mode === "fallback_only";
}
