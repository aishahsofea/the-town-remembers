import { describe, expect, it } from "vitest";

import { INITIAL_RECOVERY_STATE, reduceRecovery, type RecoveryState } from "./machine.js";

const COMPLETED_RESULT = {
  actionId: "action-1",
  kind: "travel",
  status: "completed",
  outcome: "applied",
  result: { disposition: "arrived", locationId: "loc-1" },
} as const;

describe("recovery state machine — Decision 011's table, row by row", () => {
  it("row 1: initial POST in flight starts as submitting, using the newly journaled key untouched", () => {
    expect(INITIAL_RECOVERY_STATE.phase).toBe("submitting");
    expect(INITIAL_RECOVERY_STATE.resentAt35s).toBe(false);
    expect(INITIAL_RECOVERY_STATE.resentAfterConflict).toBe(false);
  });

  it("row 2: 202 processing polls the private status URL — reuses the key, starts no new work", () => {
    const { state, shouldResend } = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    );
    expect(state.phase).toBe("processing");
    expect(state.actionId).toBe("action-1");
    expect(state.pollAfterMs).toBe(2_000);
    expect(shouldResend).toBe(false);
  });

  it("row 3: network offline shows the offline phase and never mints another key", () => {
    const processing = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;
    const { state, shouldResend } = reduceRecovery(processing, { type: "offline" }, 500);
    expect(state.phase).toBe("offline");
    expect(state.actionId).toBe("action-1");
    expect(shouldResend).toBe(false);
  });

  it("row 3b: coming back online while still processing resumes processing, same key", () => {
    const processing = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;
    const offline = reduceRecovery(processing, { type: "offline" }, 500).state;
    const { state } = reduceRecovery(offline, { type: "online" }, 600);
    expect(state.phase).toBe("processing");
    expect(state.actionId).toBe("action-1");
  });

  it("row 3c: coming back online before any 202 (still submitting) resumes submitting", () => {
    const offline = reduceRecovery(INITIAL_RECOVERY_STATE, { type: "offline" }, 100).state;
    const { state } = reduceRecovery(offline, { type: "online" }, 200);
    expect(state.phase).toBe("submitting");
    expect(state.actionId).toBeUndefined();
  });

  it("row 4: still processing at 35 seconds resends the exact same body and key exactly once", () => {
    const processing = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;

    const before = reduceRecovery(processing, { type: "tick" }, 34_999);
    expect(before.state.phase).toBe("processing");
    expect(before.shouldResend).toBe(false);

    const at35 = reduceRecovery(before.state, { type: "tick" }, 35_000);
    expect(at35.state.phase).toBe("retrying_once");
    expect(at35.state.resentAt35s).toBe(true);
    expect(at35.shouldResend).toBe(true);
    expect(at35.state.actionId).toBe("action-1");

    // A later tick at the same elapsed time never resends twice.
    const again = reduceRecovery(at35.state, { type: "tick" }, 35_100);
    expect(again.shouldResend).toBe(false);
  });

  it("row 5: still processing at 70 seconds stops automatic recovery, retains body and key", () => {
    let state: RecoveryState = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;
    state = reduceRecovery(state, { type: "tick" }, 35_000).state;

    const at70 = reduceRecovery(state, { type: "tick" }, 70_000);
    expect(at70.state.phase).toBe("manual_recovery");
    expect(at70.shouldResend).toBe(false);
    expect(at70.state.actionId).toBe("action-1");

    // No further automatic resend once in manual recovery.
    const later = reduceRecovery(at70.state, { type: "tick" }, 120_000);
    expect(later.shouldResend).toBe(false);
    expect(later.state.phase).toBe("manual_recovery");
  });

  it("row 6: 409 ACTION_CONFLICT honors the one-second delay and auto-resends exactly once, same key", () => {
    const processing = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;

    const first = reduceRecovery(processing, { type: "actionConflict" }, 1_000);
    expect(first.state.phase).toBe("conflict_auto_retry");
    expect(first.shouldResend).toBe(true);
    expect(first.state.actionId).toBe("action-1");

    const second = reduceRecovery(first.state, { type: "actionConflict" }, 2_000);
    expect(second.state.phase).toBe("conflict_manual");
    expect(second.shouldResend).toBe(false);
    expect(second.state.actionId).toBe("action-1");
  });

  it("row 7: 429 before action creation shows a countdown — same key, still unused", () => {
    const { state, shouldResend } = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "rateLimited", retryAfterSeconds: 5 },
      50,
    );
    expect(state.phase).toBe("rate_limited");
    expect(state.rateLimitedRetryAfterSeconds).toBe(5);
    expect(state.actionId).toBeUndefined();
    expect(shouldResend).toBe(false);
  });

  it("row 8: terminal completion renders the result — never resubmits afterward", () => {
    const processing = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;
    const { state } = reduceRecovery(processing, { type: "completed", result: COMPLETED_RESULT }, 2_100);
    expect(state.phase).toBe("completed");
    expect(state.result).toStrictEqual(COMPLETED_RESULT);

    const afterTick = reduceRecovery(state, { type: "tick" }, 100_000);
    expect(afterTick.shouldResend).toBe(false);
    expect(afterTick.state.phase).toBe("completed");
  });

  it("row 9: a terminal error requiring a new action preserves input and only allocates a new key on explicit click", () => {
    const processing = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "processing", actionId: "action-1", pollAfterMs: 2_000 },
      100,
    ).state;
    const { state } = reduceRecovery(
      processing,
      { type: "requiresNewAction", reason: "IDEMPOTENCY_KEY_REUSED" },
      2_100,
    );
    expect(state.phase).toBe("requires_new_action");
    expect(state.requiresNewActionReason).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(state.actionId).toBe("action-1");

    const clicked = reduceRecovery(state, { type: "tryAsNewAction" }, 5_000);
    expect(clicked.state).toStrictEqual(INITIAL_RECOVERY_STATE);
  });

  it("a tick never moves a rate-limited or requires-new-action phase on its own", () => {
    const rateLimited = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "rateLimited", retryAfterSeconds: 5 },
      50,
    ).state;
    expect(reduceRecovery(rateLimited, { type: "tick" }, 200_000).state.phase).toBe(
      "rate_limited",
    );

    const requiresNew = reduceRecovery(
      INITIAL_RECOVERY_STATE,
      { type: "requiresNewAction", reason: "x" },
      50,
    ).state;
    expect(reduceRecovery(requiresNew, { type: "tick" }, 200_000).state.phase).toBe(
      "requires_new_action",
    );
  });
});
