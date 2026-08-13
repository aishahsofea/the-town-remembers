import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { claimCreationRequest, completeCreationRequest } from "./creation-ledger.js";

const REQUEST_HASH = Buffer.alloc(32, 1);
const OTHER_REQUEST_HASH = Buffer.alloc(32, 2);
const NOW = new Date("2026-01-01T00:00:00.000Z");

function connectionLost(): Error & { readonly code: string } {
  return Object.assign(new Error("connection lost after COMMIT"), { code: "08006" });
}

function creationRow(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    idempotency_key: "creation-key",
    request_hash: REQUEST_HASH,
    content_version: "bell-mystery-v1",
    security_key_version: "v1",
    status: "processing",
    processing_token: "other-worker",
    processing_expires_at: new Date(NOW.getTime() + 30_000),
    town_id: null,
    response_status: null,
    response_payload: null,
    ...overrides,
  };
}

/**
 * Scripts the exact failure boundary a real database cannot produce on demand:
 * the claim's writes land, but the connection loses the COMMIT acknowledgement.
 * The subsequent pool read is the durable evidence used to resolve the outcome.
 */
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
          if (
            trimmed.startsWith("SELECT") &&
            trimmed.includes("town_creation_requests")
          ) {
            return Promise.resolve({ rows: [] });
          }
          if (trimmed.startsWith("INSERT INTO public.api_rate_limits")) {
            return Promise.resolve({ rows: [{ tokens_milli: 4_000 }] });
          }
          if (trimmed.startsWith("INSERT INTO public.town_creation_requests")) {
            processingToken = String(parameters[4]);
            return Promise.resolve({ rows: [{ idempotency_key: "creation-key" }] });
          }
          throw new Error(`ambiguousClaimPool: unscripted query: ${trimmed}`);
        },
        release: () => undefined,
      }),
    query: (sql: string) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith("SELECT") && trimmed.includes("town_creation_requests")) {
        const row = durableRow(processingToken);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      throw new Error(`ambiguousClaimPool: unscripted pool query: ${trimmed}`);
    },
  };
  return pool as unknown as Pool;
}

async function claimWith(pool: Pool, now: () => Date = () => NOW) {
  return claimCreationRequest(pool, {
    idempotencyKey: "creation-key",
    requestHash: REQUEST_HASH,
    contentVersion: "bell-mystery-v1",
    securityKeyVersion: "v1",
    rateLimitScopeKey: Buffer.alloc(32, 3),
    now,
    deadlineAt: Date.now() + 5_000,
    sleep: () => Promise.resolve(),
  });
}

describe("creation claim ambiguous-commit resolution", () => {
  it("recovers ownership when the durable row carries this attempt's token", async () => {
    const decision = await claimWith(
      ambiguousClaimPool((processingToken) =>
        creationRow({ processing_token: processingToken }),
      ),
    );

    expect(decision).toMatchObject({
      outcome: "claimed",
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
    });
  });

  it("returns a fingerprint mismatch found by the durable read", async () => {
    const decision = await claimWith(
      ambiguousClaimPool(() => creationRow({ request_hash: OTHER_REQUEST_HASH })),
    );

    expect(decision).toStrictEqual({ outcome: "hash_mismatch" });
  });

  it("returns a completed row as a replay", async () => {
    const decision = await claimWith(
      ambiguousClaimPool(() =>
        creationRow({
          status: "completed",
          town_id: "town-1",
          response_status: 201,
          response_payload: { townId: "town-1", status: "active" },
        }),
      ),
    );

    expect(decision).toMatchObject({ outcome: "replay", row: { townId: "town-1" } });
  });

  it.each([
    ["no durable row", undefined],
    ["another worker's processing token", creationRow()],
  ] as const)("does not claim ownership when there is %s", async (_label, row) => {
    const afterDeadline = () => new Date(Date.now() + 10_000);
    await expect(
      claimWith(
        ambiguousClaimPool(() => row),
        afterDeadline,
      ),
    ).rejects.toMatchObject({ category: "deadline_exceeded" });
  });
});

function completionPool(input: {
  readonly updateMatched: boolean;
  readonly commit: "committed" | "ambiguous";
  readonly durableRow?: Record<string, unknown> | undefined;
}): Pool {
  const pool = {
    connect: () =>
      Promise.resolve({
        query: (sql: string) => {
          const trimmed = sql.trim();
          if (trimmed === "BEGIN" || trimmed === "ROLLBACK") {
            return Promise.resolve({ rows: [] });
          }
          if (trimmed === "COMMIT") {
            return input.commit === "ambiguous"
              ? Promise.reject(connectionLost())
              : Promise.resolve({ rows: [] });
          }
          if (trimmed.startsWith("UPDATE public.town_creation_requests")) {
            return Promise.resolve({
              rows: input.updateMatched ? [{ idempotency_key: "creation-key" }] : [],
            });
          }
          throw new Error(`completionPool: unscripted query: ${trimmed}`);
        },
        release: () => undefined,
      }),
    query: (sql: string) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith("SELECT") && trimmed.includes("town_creation_requests")) {
        return Promise.resolve({ rows: input.durableRow ? [input.durableRow] : [] });
      }
      throw new Error(`completionPool: unscripted pool query: ${trimmed}`);
    },
  };
  return pool as unknown as Pool;
}

function completeWith(pool: Pool): Promise<void> {
  return completeCreationRequest(pool, Date.now() + 5_000, {
    idempotencyKey: "creation-key",
    processingToken: "this-worker",
    townId: "town-1",
    responseStatus: 201,
    responsePayload: { townId: "town-1", status: "active" },
    now: () => NOW,
  });
}

describe("creation completion recovery", () => {
  it("accepts the ordinary matched update", async () => {
    await expect(
      completeWith(completionPool({ updateMatched: true, commit: "committed" })),
    ).resolves.toBeUndefined();
  });

  it("accepts a matching completed row after a conditional update misses", async () => {
    await expect(
      completeWith(
        completionPool({
          updateMatched: false,
          commit: "committed",
          durableRow: creationRow({ status: "completed", town_id: "town-1" }),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects an inconsistent row after a conditional update misses", async () => {
    await expect(
      completeWith(
        completionPool({
          updateMatched: false,
          commit: "committed",
          durableRow: creationRow({ status: "completed", town_id: "town-2" }),
        }),
      ),
    ).rejects.toMatchObject({ category: "unknown" });
  });

  it("accepts a matching completed row after an ambiguous COMMIT", async () => {
    await expect(
      completeWith(
        completionPool({
          updateMatched: true,
          commit: "ambiguous",
          durableRow: creationRow({ status: "completed", town_id: "town-1" }),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["no row", undefined],
    ["a different town", creationRow({ status: "completed", town_id: "town-2" })],
  ] as const)(
    "preserves ambiguity when the durable read finds %s",
    async (_label, row) => {
      await expect(
        completeWith(
          completionPool({
            updateMatched: true,
            commit: "ambiguous",
            durableRow: row,
          }),
        ),
      ).rejects.toMatchObject({ category: "ambiguous_commit" });
    },
  );
});
