/**
 * `D4-M` cost arithmetic: integer micro-USD throughout, converted to a
 * `DECIMAL(12,6)`-compatible string only at the very end
 * (`microUsdToDecimalString`), which is the one place `game-server`'s
 * persistence layer should call it — floating point cannot be reconciled
 * against a decimal ledger with a settlement-within-reservation check.
 */

import { ceilingFor, rateFor } from "./price-catalog.js";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** Ceiling-rounds so a worst-case estimate never under-reserves by a fraction of a micro-USD. */
function microUsdFor(tokens: number, ratePerMillionTokens: number): number {
  return Math.ceil((tokens * ratePerMillionTokens) / 1_000_000);
}

/**
 * The maximum this call could possibly cost, given `purpose`'s worst-case
 * token ceilings and the model that will actually answer it. Admission
 * reserves this amount before the call starts; it is never exceeded by
 * settlement (`ck_model_cost_reservations__settlement_within_reservation`).
 */
export function worstCaseMicroUsd(purpose: string, model: string): number {
  const ceiling = ceilingFor(purpose);
  const rate = rateFor(model);
  return (
    microUsdFor(ceiling.worstCaseInputTokens, rate.inputPerMillionTokens) +
    microUsdFor(ceiling.worstCaseOutputTokens, rate.outputPerMillionTokens)
  );
}

/**
 * The real cost of a completed call, from its actual token usage. Uses
 * standard rounding (not ceiling) — this is a settlement, not a reservation,
 * so it should reflect the true cost as closely as integer micro-USD allows.
 */
export function settledMicroUsd(model: string, usage: TokenUsage): number {
  const rate = rateFor(model);
  return (
    Math.round((usage.inputTokens * rate.inputPerMillionTokens) / 1_000_000) +
    Math.round((usage.outputTokens * rate.outputPerMillionTokens) / 1_000_000) +
    Math.round((usage.cacheReadTokens * rate.cacheReadPerMillionTokens) / 1_000_000) +
    Math.round((usage.cacheWriteTokens * rate.cacheWritePerMillionTokens) / 1_000_000)
  );
}

/**
 * Clamps a settled amount to its reservation's maximum. The check
 * constraint would otherwise reject the settlement outright; Decision 004's
 * own guidance is to reconcile rather than lose the write, so the caller
 * logs the clamp and stores the maximum instead of throwing at the database.
 */
export function clampToReservation(
  settledAmountMicroUsd: number,
  maximumMicroUsd: number,
): { readonly amountMicroUsd: number; readonly clamped: boolean } {
  if (settledAmountMicroUsd <= maximumMicroUsd) {
    return { amountMicroUsd: settledAmountMicroUsd, clamped: false };
  }
  return { amountMicroUsd: maximumMicroUsd, clamped: true };
}

/** `DECIMAL(12,6)` needs a plain decimal string, never a float — this is the one conversion boundary. */
export function microUsdToDecimalString(microUsd: number): string {
  const rounded = Math.round(microUsd);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const wholePart = Math.floor(absolute / 1_000_000);
  const fractionalPart = String(absolute % 1_000_000).padStart(6, "0");
  return `${sign}${wholePart}.${fractionalPart}`;
}
