import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { claimJoinRequest, readJoinRequest } from "./join-ledger.js";

const REQUEST_HASH = Buffer.alloc(32, 1);
const OTHER_REQUEST_HASH = Buffer.alloc(32, 2);
const SECRET_HASH = Buffer.alloc(32, 3);
const OTHER_SECRET_HASH = Buffer.alloc(32, 4);
const NOW = new Date("2026-01-01T00:00:00.000Z");

function connectionLost(): Error & { readonly code: string } {
  return Object.assign(new Error("connection lost after COMMIT"), { code: "08006" });
}

function joinRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    idempotency_key: "join-key",
    request_hash: REQUEST_HASH,
    join_secret_hash: SECRET_HASH,
    status: "processing",
    processing_token: "other-worker",
    processing_expires_at: new Date(NOW.getTime() + 30_000),
    player_id: null,
    initial_visit_id: null,
    replay_expires_at: null,
    bootstrap_confirmed_at: null,
    replay_closed_at: null,
    replay_closed_reason: null,
    session_issue_count: 0,
    response_status: null,
    response_payload: null,
    ...overrides,
  };
}

function ambiguousClaimPool(
  durableRow: (processingToken: string) => Record<string, unknown> | undefined,
): Pool {
  let processingToken = "";
  const pool = {
    connect: () =>
      Promise.resolve({
        query: (sql: string, parameters: readonly unknown[] = []) => {
          const trimmed = sql.trim();
          if (trimmed === "BEGIN" || trimmed === "ROLLBACK") {
            return Promise.resolve({ rows: [] });
          }
          if (trimmed === "COMMIT") return Promise.reject(connectionLost());
          if (trimmed.startsWith("SELECT") && trimmed.includes("join_requests")) {
            return Promise.resolve({ rows: [] });
          }
          if (trimmed.startsWith("INSERT INTO public.api_rate_limits")) {
            return Promise.resolve({ rows: [{ tokens_milli: 9_000 }] });
          }
          if (trimmed.startsWith("INSERT INTO public.join_requests")) {
            processingToken = String(parameters[4]);
            return Promise.resolve({ rows: [{ idempotency_key: "join-key" }] });
          }
          throw new Error(`ambiguousClaimPool: unscripted query: ${trimmed}`);
        },
        release: () => undefined,
      }),
    query: (sql: string) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith("SELECT") && trimmed.includes("join_requests")) {
        const row = durableRow(processingToken);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      throw new Error(`ambiguousClaimPool: unscripted pool query: ${trimmed}`);
    },
  };
  return pool as unknown as Pool;
}

async function claimWith(pool: Pool, now: () => Date = () => NOW) {
  return claimJoinRequest(pool, {
    townId: "town-1",
    idempotencyKey: "join-key",
    requestHash: REQUEST_HASH,
    joinSecretHash: SECRET_HASH,
    rateLimitScopeKey: Buffer.alloc(32, 5),
    now,
    deadlineAt: Date.now() + 5_000,
    sleep: () => Promise.resolve(),
  });
}

describe("join claim ambiguous-commit resolution", () => {
  it("recovers ownership when the durable row carries this attempt's token", async () => {
    const decision = await claimWith(
      ambiguousClaimPool((processingToken) =>
        joinRow({ processing_token: processingToken }),
      ),
    );

    expect(decision).toMatchObject({ outcome: "claimed" });
  });

  it("authenticates the secret before disclosing any other durable state", async () => {
    const decision = await claimWith(
      ambiguousClaimPool(() =>
        joinRow({
          request_hash: OTHER_REQUEST_HASH,
          join_secret_hash: OTHER_SECRET_HASH,
        }),
      ),
    );

    expect(decision).toStrictEqual({ outcome: "secret_mismatch" });
  });

  it("returns a fingerprint mismatch after the secret matches", async () => {
    const decision = await claimWith(
      ambiguousClaimPool(() => joinRow({ request_hash: OTHER_REQUEST_HASH })),
    );

    expect(decision).toStrictEqual({ outcome: "hash_mismatch" });
  });

  it("returns a closed row without minting another session", async () => {
    const decision = await claimWith(
      ambiguousClaimPool(() =>
        joinRow({
          join_secret_hash: null,
          status: "completed",
          replay_closed_at: NOW,
          replay_closed_reason: "confirmed",
        }),
      ),
    );

    expect(decision).toStrictEqual({ outcome: "closed", reason: "confirmed" });
  });

  it("returns a completed open row as a replay", async () => {
    const decision = await claimWith(
      ambiguousClaimPool(() =>
        joinRow({
          status: "completed",
          player_id: "player-1",
          response_status: 201,
          response_payload: { player: { id: "player-1" } },
        }),
      ),
    );

    expect(decision).toMatchObject({
      outcome: "replay",
      row: { playerId: "player-1" },
    });
  });

  it.each([
    ["no durable row", undefined],
    ["another worker's processing token", joinRow()],
  ] as const)("does not claim ownership when there is %s", async (_label, row) => {
    const afterDeadline = () => new Date(Date.now() + 10_000);
    await expect(
      claimWith(
        ambiguousClaimPool(() => row),
        afterDeadline,
      ),
    ).rejects.toThrow("join claim deadline exceeded");
  });
});

describe("readJoinRequest", () => {
  it("maps a durable row and reports an absent one", async () => {
    const presentPool = {
      query: () => Promise.resolve({ rows: [joinRow({ player_id: "player-1" })] }),
    } as unknown as Pool;
    const absentPool = {
      query: () => Promise.resolve({ rows: [] }),
    } as unknown as Pool;

    await expect(
      readJoinRequest(presentPool, "town-1", "join-key"),
    ).resolves.toMatchObject({ playerId: "player-1" });
    await expect(
      readJoinRequest(absentPool, "town-1", "join-key"),
    ).resolves.toBeUndefined();
  });
});
