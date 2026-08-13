import { describe, expect, it } from "vitest";

import {
  decideAction,
  MAX_PROCESSING_ATTEMPTS,
  type BlockingActionRow,
  type ExistingActionRow,
} from "./ledger.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const PAST = new Date("2026-08-11T11:00:00.000Z");
const FUTURE = new Date("2026-08-11T13:00:00.000Z");

const HASH_A = Buffer.from("a".repeat(64), "hex");
const HASH_B = Buffer.from("b".repeat(64), "hex");

function existingRow(overrides: Partial<ExistingActionRow>): ExistingActionRow {
  return {
    id: "action_1",
    requestHash: HASH_A,
    status: "processing",
    processingExpiresAt: FUTURE,
    retryAfterAt: null,
    attemptCount: 1,
    responseStatus: null,
    responsePayload: null,
    ...overrides,
  };
}

const BLOCKER: BlockingActionRow = {
  id: "action_blocker",
  processingExpiresAt: FUTURE,
};
const EXPIRED_BLOCKER: BlockingActionRow = {
  id: "action_blocker",
  processingExpiresAt: PAST,
};

describe("decideAction — Decision 006 §Idempotency and conflicts", () => {
  it("creates when no existing row and no blocker (None)", () => {
    expect(
      decideAction({
        existing: undefined,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "create" });
  });

  it("responds processing for the same input while still processing (Same input, processing)", () => {
    const row = existingRow({ status: "processing", processingExpiresAt: FUTURE });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "respondProcessing", row });
  });

  it("replays the saved conflict for retryable before retry_after_at (Same input, retryable, before)", () => {
    const row = existingRow({ status: "retryable", retryAfterAt: FUTURE });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "replayConflict", row });
  });

  it("reclaims retryable after retry_after_at (Same input, retryable, after)", () => {
    const row = existingRow({ status: "retryable", retryAfterAt: PAST });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "reclaim" });
  });

  it("reclaims retryable exactly at retry_after_at (boundary is inclusive of reclaim)", () => {
    const row = existingRow({ status: "retryable", retryAfterAt: NOW });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "reclaim" });
  });

  it("replays a saved completed row (Same input, completed)", () => {
    const row = existingRow({
      status: "completed",
      processingExpiresAt: null,
      responseStatus: 201,
      responsePayload: { ok: true },
    });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "replaySaved", row });
  });

  it("replays a saved failed row (Same input, failed)", () => {
    const row = existingRow({
      status: "failed",
      processingExpiresAt: null,
      responseStatus: 503,
      responsePayload: { code: "ACTION_PROCESSING_EXHAUSTED" },
    });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "replaySaved", row });
  });

  it("rejects key reuse for a mismatched fingerprint (Different input)", () => {
    const row = existingRow({ status: "completed", responseStatus: 200 });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_B,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "rejectKeyReuse" });
  });

  it("checks the fingerprint before the status for every status", () => {
    for (const status of ["processing", "retryable", "completed", "failed"] as const) {
      const row = existingRow({ status });
      expect(
        decideAction({
          existing: row,
          blocker: undefined,
          requestHash: HASH_B,
          now: NOW,
        }),
      ).toStrictEqual({ kind: "rejectKeyReuse" });
    }
  });

  it("takes over an expired same-key processing claim under the attempt cap (Expired processing claim)", () => {
    const row = existingRow({
      status: "processing",
      processingExpiresAt: PAST,
      attemptCount: MAX_PROCESSING_ATTEMPTS - 1,
    });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "takeover" });
  });

  it("exhausts after MAX_PROCESSING_ATTEMPTS claimed attempts with no committed result", () => {
    const row = existingRow({
      status: "processing",
      processingExpiresAt: PAST,
      attemptCount: MAX_PROCESSING_ATTEMPTS,
    });
    expect(
      decideAction({
        existing: row,
        blocker: undefined,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "exhaust" });
  });

  it("blocks a different new key while another action is live (ACTION_IN_PROGRESS)", () => {
    expect(
      decideAction({
        existing: undefined,
        blocker: BLOCKER,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "blockInProgress", blocker: BLOCKER });
  });

  it("supersedes an expired blocker then creates the new key's row (ACTION_SUPERSEDED)", () => {
    expect(
      decideAction({
        existing: undefined,
        blocker: EXPIRED_BLOCKER,
        requestHash: HASH_A,
        now: NOW,
      }),
    ).toStrictEqual({ kind: "supersedeThenCreate", blocker: EXPIRED_BLOCKER });
  });

  it("resolves same-key replay before ever considering a blocker", () => {
    // A live blocker is present, but `existing` is this exact key: the
    // blocker must never be consulted (docs/006: "Same-key replay is
    // resolved first"). This is also the blocking action's own key case
    // named explicitly in the acceptance criteria.
    const row = existingRow({ status: "completed", responseStatus: 200 });
    expect(
      decideAction({ existing: row, blocker: BLOCKER, requestHash: HASH_A, now: NOW }),
    ).toStrictEqual({ kind: "replaySaved", row });
  });
});
