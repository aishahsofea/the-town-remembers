import { randomUUID } from "node:crypto";

import { captureStdout } from "@the-town-remembers/test-support";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  claimAction,
  retryAfterSecondsFrom,
  type ClaimActionParams,
} from "./actions.js";

describe("retryAfterSecondsFrom", () => {
  it("is null when there is no retry_after_at to measure against", () => {
    expect(
      retryAfterSecondsFrom(null, new Date("2026-01-01T00:00:00.000Z")),
    ).toBeNull();
  });

  it("rounds up to whole seconds remaining", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const retryAfterAt = new Date(now.getTime() + 1_500);
    expect(retryAfterSecondsFrom(retryAfterAt, now)).toBe(2);
  });

  it("floors at 1 second even if the target has already passed", () => {
    const now = new Date("2026-01-01T00:00:01.000Z");
    const retryAfterAt = new Date("2026-01-01T00:00:00.000Z");
    expect(retryAfterSecondsFrom(retryAfterAt, now)).toBe(1);
  });
});

/**
 * A `pg.Pool`-shaped double answering exactly the queries `claimAction`
 * issues across two attempts: the first genuinely claims a fresh row but its
 * own `COMMIT` fails with a connection-style error — `runSerializable`
 * classifies that as ambiguous (`transaction.ts#isAmbiguousCommitFailure`),
 * never a serialization conflict — so `attemptOnce` falls through to its own
 * `resolveAmbiguousCommit` read, finds the row really did land, and reports
 * `live_processing`. `claimAction`'s own loop then makes a second, ordinary
 * attempt, which now finds that same row already `processing` and returns
 * the real `202`-shaped answer.
 *
 * This is timing and failure behavior, not SQL behavior — the same reasoning
 * `database/runtime.test.ts#scriptedPool` documents for scripting a pool
 * instead of racing a real one, which a genuinely ambiguous commit cannot be
 * provoked to do on demand anyway (the connection would have to die at the
 * exact instant the server acknowledges `COMMIT`).
 */
function ambiguousClaimPool(insertedActionId: string, requestHash: Buffer): Pool {
  let attempt = -1;

  function existingRow(): Record<string, unknown> {
    return {
      id: insertedActionId,
      request_hash: requestHash,
      status: "processing",
      processing_expires_at: new Date(Date.now() + 35_000),
      retry_after_at: null,
      attempt_count: 1,
      response_status: null,
      response_payload: null,
    };
  }

  const pool = {
    connect: () =>
      Promise.resolve({
        query: (sql: string) => {
          const trimmed = sql.trim();
          if (trimmed === "BEGIN") {
            attempt += 1;
            return Promise.resolve({ rows: [] });
          }
          if (trimmed === "COMMIT") {
            if (attempt === 0) {
              return Promise.reject(Object.assign(new Error("connection lost"), {}));
            }
            return Promise.resolve({ rows: [] });
          }
          if (trimmed === "ROLLBACK") return Promise.resolve({ rows: [] });
          if (
            trimmed.startsWith("SELECT") &&
            trimmed.includes("idempotency_key = $3")
          ) {
            // Attempt 0: nothing claimed yet. Attempt 1+: the ambiguous
            // attempt 0's write really did land, so the row now exists.
            return Promise.resolve({ rows: attempt === 0 ? [] : [existingRow()] });
          }
          if (
            trimmed.startsWith("SELECT") &&
            trimmed.includes("status = 'processing'")
          ) {
            return Promise.resolve({ rows: [] }); // readBlocker: no blocking claim either way.
          }
          if (trimmed.startsWith("INSERT INTO public.player_actions")) {
            return Promise.resolve({ rows: [{ id: insertedActionId }] });
          }
          throw new Error(
            `ambiguousClaimPool: unscripted query: ${trimmed.slice(0, 80)}`,
          );
        },
        release: () => undefined,
      }),
    query: (sql: string) => {
      const trimmed = sql.trim();
      // `readExistingViaPool`, run only right after attempt 0's ambiguous
      // `COMMIT` — the row it finds proves the write actually landed.
      if (trimmed.startsWith("SELECT") && trimmed.includes("idempotency_key = $3")) {
        return Promise.resolve({ rows: [existingRow()] });
      }
      throw new Error(
        `ambiguousClaimPool: unscripted pool.query: ${trimmed.slice(0, 80)}`,
      );
    },
  };
  return pool as unknown as Pool;
}

describe("claim-level ambiguous commit (P3-18 acceptance 3)", () => {
  it("reports its resolution when a claim's own COMMIT is genuinely ambiguous", async () => {
    const insertedActionId = randomUUID();
    const requestHash = Buffer.alloc(32, 1);
    const pool = ambiguousClaimPool(insertedActionId, requestHash);

    const params: ClaimActionParams = {
      townId: "town_1",
      playerId: "player_1",
      idempotencyKey: randomUUID(),
      requestHash,
      actionKind: "start_visit",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      deadlineAt: Date.now() + 5_000,
      requestId: "req_ambiguous_test",
      sleep: () => Promise.resolve(),
    };

    const captured = await captureStdout(async () => {
      const decision = await claimAction(pool, params);
      expect(decision.outcome).toBe("processing");
    });

    const ambiguousEvent = captured.events.find(
      (event) =>
        event["event"] === "action_lifecycle" &&
        event["requestId"] === "req_ambiguous_test" &&
        event["status"] === "ambiguous_resolved",
    );
    expect(ambiguousEvent).toBeDefined();
    expect(ambiguousEvent?.["ambiguousCommitResolution"]).toBe("applied");
  });
});
