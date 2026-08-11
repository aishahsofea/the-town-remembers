/**
 * The recovery state machine (Decision 011 §"Recovery state machine"), as a
 * pure reducer over `(state, event, elapsedMs)` — no timer, no network call,
 * no IndexedDB access. `elapsedMs` is the caller's own reading of time since
 * the journal entry was first written; the machine never reads a clock
 * itself, so every row of the docs table is a plain, timing-independent
 * unit test.
 *
 * No transition here ever allocates a new idempotency key except the
 * explicit `tryAsNewAction` event — every other path (including every
 * automatic retry) carries the same key the caller already journaled.
 */

import type { CompletedActionResponse } from "@the-town-remembers/http-contracts";

export type RecoveryPhase =
  | "submitting"
  | "processing"
  | "offline"
  | "retrying_once"
  | "manual_recovery"
  | "conflict_auto_retry"
  | "conflict_manual"
  | "rate_limited"
  | "completed"
  | "requires_new_action";

export interface RecoveryState {
  readonly phase: RecoveryPhase;
  /** Set once the server has assigned one — undefined while still `submitting`. */
  readonly actionId: string | undefined;
  readonly pollAfterMs: number;
  readonly result: CompletedActionResponse | undefined;
  readonly requiresNewActionReason: string | undefined;
  readonly rateLimitedRetryAfterSeconds: number | undefined;
  /** Whether the 35-second automatic resend has already been used. */
  readonly resentAt35s: boolean;
  /** Whether the one automatic `ACTION_CONFLICT` resend has already been used. */
  readonly resentAfterConflict: boolean;
}

export const INITIAL_RECOVERY_STATE: RecoveryState = {
  phase: "submitting",
  actionId: undefined,
  pollAfterMs: 2_000,
  result: undefined,
  requiresNewActionReason: undefined,
  rateLimitedRetryAfterSeconds: undefined,
  resentAt35s: false,
  resentAfterConflict: false,
};

export type RecoveryEvent =
  | { readonly type: "processing"; readonly actionId: string; readonly pollAfterMs: number }
  | { readonly type: "offline" }
  | { readonly type: "online" }
  | { readonly type: "completed"; readonly result: CompletedActionResponse }
  | { readonly type: "actionConflict" }
  | { readonly type: "rateLimited"; readonly retryAfterSeconds: number }
  | { readonly type: "requiresNewAction"; readonly reason: string }
  | { readonly type: "tick" }
  | { readonly type: "tryAsNewAction" };

const RESEND_AT_MS = 35_000;
const MANUAL_RECOVERY_AT_MS = 70_000;

/**
 * Whether this tick should trigger the automatic 35-second resend — a
 * distinct, explicit action from a plain `resend` boolean so the caller
 * (which owns the actual POST) can tell "resend now" apart from "nothing to
 * do yet" without inspecting phases itself.
 */
export interface RecoveryTransition {
  readonly state: RecoveryState;
  /** True exactly once, the tick that crosses the 35-second boundary while still processing. */
  readonly shouldResend: boolean;
}

export function reduceRecovery(
  state: RecoveryState,
  event: RecoveryEvent,
  elapsedMs: number,
): RecoveryTransition {
  switch (event.type) {
    case "processing":
      return {
        state: {
          ...state,
          phase: "processing",
          actionId: event.actionId,
          pollAfterMs: event.pollAfterMs,
        },
        shouldResend: false,
      };

    case "offline":
      return { state: { ...state, phase: "offline" }, shouldResend: false };

    case "online":
      return {
        state: { ...state, phase: state.actionId === undefined ? "submitting" : "processing" },
        shouldResend: false,
      };

    case "completed":
      return {
        state: { ...state, phase: "completed", result: event.result },
        shouldResend: false,
      };

    case "actionConflict": {
      if (!state.resentAfterConflict) {
        return {
          state: { ...state, phase: "conflict_auto_retry", resentAfterConflict: true },
          shouldResend: true,
        };
      }
      return { state: { ...state, phase: "conflict_manual" }, shouldResend: false };
    }

    case "rateLimited":
      return {
        state: {
          ...state,
          phase: "rate_limited",
          rateLimitedRetryAfterSeconds: event.retryAfterSeconds,
        },
        shouldResend: false,
      };

    case "requiresNewAction":
      return {
        state: { ...state, phase: "requires_new_action", requiresNewActionReason: event.reason },
        shouldResend: false,
      };

    case "tryAsNewAction":
      return { state: INITIAL_RECOVERY_STATE, shouldResend: false };

    case "tick": {
      // Terminal phases, and phases already past the 35s/70s boundaries,
      // never move on a tick.
      if (
        state.phase === "completed" ||
        state.phase === "requires_new_action" ||
        state.phase === "manual_recovery" ||
        state.phase === "conflict_manual" ||
        state.phase === "rate_limited"
      ) {
        return { state, shouldResend: false };
      }
      if (state.phase === "offline") return { state, shouldResend: false };

      if (elapsedMs >= MANUAL_RECOVERY_AT_MS && state.resentAt35s) {
        return { state: { ...state, phase: "manual_recovery" }, shouldResend: false };
      }
      if (elapsedMs >= RESEND_AT_MS && !state.resentAt35s) {
        return {
          state: { ...state, phase: "retrying_once", resentAt35s: true },
          shouldResend: true,
        };
      }
      return { state, shouldResend: false };
    }
  }
}
