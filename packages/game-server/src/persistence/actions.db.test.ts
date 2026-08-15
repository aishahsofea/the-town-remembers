import { randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertPlayer,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_PROCESSING_ATTEMPTS } from "../application/actions/ledger.js";
import { actionRequestHash } from "../security/fingerprint.js";
import {
  claimAction,
  completeAction,
  readActionForPlayer,
  StaleProcessingClaimError,
  storeRetryableConflict,
  type ClaimActionParams,
} from "./actions.js";

const START_VISIT_HASH = actionRequestHash({
  kind: "start_visit",
  targetActorId: null,
  targetEntityId: null,
  payload: {},
});

describe.skipIf(!shouldRunDatabaseTests())("player_actions claim state machine", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  async function fixtureTownAndPlayer(): Promise<{
    readonly townId: string;
    readonly playerId: string;
  }> {
    const townId = await insertTown(db().pool);
    const playerId = await insertPlayer(db().pool, townId);
    return { townId, playerId };
  }

  function claimParams(
    townId: string,
    playerId: string,
    overrides: Partial<ClaimActionParams> = {},
  ): ClaimActionParams {
    return {
      townId,
      playerId,
      idempotencyKey: randomUUID(),
      requestHash: START_VISIT_HASH,
      actionKind: "start_visit",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
      requestId: "req_test",
      ...overrides,
    };
  }

  it("claims a fresh key", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const decision = await claimAction(db().pool, claimParams(townId, playerId));
    expect(decision.outcome).toBe("claimed");
  });

  it("resolves same-key replay before ever consulting the blocker (acceptance 8)", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const params = claimParams(townId, playerId);

    const first = await claimAction(db().pool, params);
    expect(first.outcome).toBe("claimed");

    // A live claim on the *same* key must be answered `processing`, never
    // `blocked` — a blocking action can never be its own blocker.
    const second = await claimAction(db().pool, params);
    expect(second.outcome).toBe("processing");
    if (second.outcome === "processing" && first.outcome === "claimed") {
      expect(second.actionId).toBe(first.actionId);
    }
  });

  it("blocks a different new key while another action is live, creating no row (acceptance 6)", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const blocking = await claimAction(db().pool, claimParams(townId, playerId));
    expect(blocking.outcome).toBe("claimed");
    if (blocking.outcome !== "claimed") throw new Error("unreachable");

    const newKey = randomUUID();
    const blocked = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey: newKey }),
    );
    expect(blocked.outcome).toBe("blocked");
    if (blocked.outcome === "blocked") {
      expect(blocked.blockingActionId).toBe(blocking.actionId);
    }

    const row = await db().pool.query(
      "SELECT id FROM public.player_actions WHERE town_id = $1 AND idempotency_key = $2",
      [townId, newKey],
    );
    expect(row.rowCount).toBe(0);
  });

  it("supersedes an expired blocker then creates the new key's row in one transaction (acceptance 7)", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const blocking = await claimAction(
      db().pool,
      claimParams(townId, playerId, { now: () => claimedAt }),
    );
    expect(blocking.outcome).toBe("claimed");
    if (blocking.outcome !== "claimed") throw new Error("unreachable");

    const afterExpiry = new Date(claimedAt.getTime() + 40_000);
    const newKey = randomUUID();
    const superseding = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey: newKey, now: () => afterExpiry }),
    );
    expect(superseding.outcome).toBe("claimed");

    const rows = await db().pool.query<{
      id: string;
      status: string;
      error_code: string | null;
    }>(
      `SELECT id, status, error_code FROM public.player_actions
        WHERE town_id = $1 AND player_id = $2 ORDER BY created_at`,
      [townId, playerId],
    );
    expect(rows.rowCount).toBe(2);
    const blocker = rows.rows.find((row) => row.id === blocking.actionId);
    expect(blocker?.status).toBe("failed");
    expect(blocker?.error_code).toBe("ACTION_SUPERSEDED");
    const superseder = rows.rows.find((row) => row.id !== blocking.actionId);
    expect(superseder?.status).toBe("processing");
  });

  it("rejects a stale worker's completion after a takeover; the new owner commits cleanly (acceptance 4)", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const params = claimParams(townId, playerId, { now: () => claimedAt });
    const first = await claimAction(db().pool, params);
    expect(first.outcome).toBe("claimed");
    if (first.outcome !== "claimed") throw new Error("unreachable");
    expect(first.executionAttempt).toBe(0);

    const afterExpiry = new Date(claimedAt.getTime() + 40_000);
    const second = await claimAction(db().pool, { ...params, now: () => afterExpiry });
    expect(second.outcome).toBe("claimed");
    if (second.outcome !== "claimed") throw new Error("unreachable");
    expect(second.actionId).toBe(first.actionId);
    expect(second.processingToken).not.toBe(first.processingToken);
    expect(second.executionAttempt).toBe(1);

    await expect(
      completeAction(db().pool, Date.now() + 5_000, {
        townId,
        actionId: first.actionId,
        processingToken: first.processingToken,
        outcome: "applied",
        responseStatus: 200,
        responsePayload: { stale: true },
        visitId: null,
        now: () => afterExpiry,
      }),
    ).rejects.toBeInstanceOf(StaleProcessingClaimError);

    await completeAction(db().pool, Date.now() + 5_000, {
      townId,
      actionId: second.actionId,
      processingToken: second.processingToken,
      outcome: "applied",
      responseStatus: 200,
      responsePayload: { stale: false },
      visitId: null,
      now: () => afterExpiry,
    });

    const row = await db().pool.query<{ status: string; response_payload: unknown }>(
      "SELECT status, response_payload FROM public.player_actions WHERE town_id = $1 AND id = $2",
      [townId, first.actionId],
    );
    expect(row.rows[0]?.status).toBe("completed");
    expect(row.rows[0]?.response_payload).toStrictEqual({ stale: false });
  });

  it("exhausts after MAX_PROCESSING_ATTEMPTS claimed attempts with no committed result (acceptance 5)", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    let at = new Date("2026-01-01T00:00:00.000Z");
    const idempotencyKey = randomUUID();

    let lastActionId: string | undefined;
    for (let attempt = 0; attempt < MAX_PROCESSING_ATTEMPTS; attempt += 1) {
      const outcome = await claimAction(
        db().pool,
        claimParams(townId, playerId, { idempotencyKey, now: () => at }),
      );
      expect(outcome.outcome).toBe("claimed");
      if (outcome.outcome === "claimed") lastActionId = outcome.actionId;
      at = new Date(at.getTime() + 40_000);
    }

    const exhausted = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey, now: () => at }),
    );
    expect(exhausted.outcome).toBe("replay");
    if (exhausted.outcome === "replay") {
      expect(exhausted.status).toBe("failed");
      expect(exhausted.responseStatus).toBe(503);
      expect(exhausted.responsePayload).toMatchObject({
        code: "ACTION_PROCESSING_EXHAUSTED",
      });
    }

    const row = await db().pool.query<{ status: string; outcome: string | null }>(
      "SELECT status, outcome FROM public.player_actions WHERE town_id = $1 AND id = $2",
      [townId, lastActionId],
    );
    expect(row.rows[0]?.status).toBe("failed");
    expect(row.rows[0]?.outcome).toBeNull();
  });

  it("recovers a response lost after commit: the same key replays the saved body with no second row (acceptance 3)", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const params = claimParams(townId, playerId);
    const claimed = await claimAction(db().pool, params);
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");
    expect(claimed.executionAttempt).toBe(0);

    const savedPayload = {
      actionId: claimed.actionId,
      kind: "start_visit",
      status: "completed",
      outcome: "applied",
      result: { disposition: "started" },
    };
    await completeAction(db().pool, Date.now() + 5_000, {
      townId,
      actionId: claimed.actionId,
      processingToken: claimed.processingToken,
      outcome: "applied",
      responseStatus: 201,
      responsePayload: savedPayload,
      visitId: null,
      now: () => new Date(),
    });

    const replay = await claimAction(db().pool, params);
    expect(replay.outcome).toBe("replay");
    if (replay.outcome === "replay") {
      expect(replay.status).toBe("completed");
      expect(replay.responseStatus).toBe(201);
      expect(replay.responsePayload).toStrictEqual(savedPayload);
    }

    const rows = await db().pool.query(
      "SELECT id FROM public.player_actions WHERE town_id = $1 AND idempotency_key = $2",
      [townId, params.idempotencyKey],
    );
    expect(rows.rowCount).toBe(1);
  });

  it("reports a fingerprint mismatch for a replay whose canonical body differs", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const idempotencyKey = randomUUID();
    const first = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey }),
    );
    expect(first.outcome).toBe("claimed");

    const differentHash = actionRequestHash({
      kind: "travel",
      targetActorId: null,
      targetEntityId: "some-location",
      payload: {},
    });
    const second = await claimAction(
      db().pool,
      claimParams(townId, playerId, {
        idempotencyKey,
        requestHash: differentHash,
      }),
    );
    expect(second.outcome).toBe("key_reused");
  });

  it("replays the saved 409 ACTION_CONFLICT before retry_after_at, then reclaims to processing after it", async () => {
    const { townId, playerId } = await fixtureTownAndPlayer();
    const claimedAt = new Date("2026-01-01T00:00:00.000Z");
    const idempotencyKey = randomUUID();
    const claimed = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey, now: () => claimedAt }),
    );
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");

    const retryAfterAt = new Date(claimedAt.getTime() + 1_000);
    await storeRetryableConflict(db().pool, Date.now() + 5_000, {
      townId,
      actionId: claimed.actionId,
      processingToken: claimed.processingToken,
      retryAfterAt,
      now: () => claimedAt,
    });

    const beforeRetry = new Date(retryAfterAt.getTime() - 100);
    const conflictReplay = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey, now: () => beforeRetry }),
    );
    expect(conflictReplay.outcome).toBe("replay");
    if (conflictReplay.outcome === "replay") {
      expect(conflictReplay.status).toBe("retryable");
      expect(conflictReplay.responseStatus).toBe(409);
      expect(conflictReplay.retryAfterSeconds).toBeGreaterThan(0);
    }

    const afterRetry = new Date(retryAfterAt.getTime() + 1_000);
    const reclaimed = await claimAction(
      db().pool,
      claimParams(townId, playerId, { idempotencyKey, now: () => afterRetry }),
    );
    expect(reclaimed.outcome).toBe("claimed");
    if (reclaimed.outcome === "claimed") {
      expect(reclaimed.actionId).toBe(claimed.actionId);
      expect(reclaimed.processingToken).not.toBe(claimed.processingToken);
      expect(reclaimed.executionAttempt).toBe(1);
    }

    const row = await db().pool.query<{
      status: string;
      response_status: number | null;
      error_code: string | null;
      retry_after_at: Date | null;
    }>(
      `SELECT status, response_status, error_code, retry_after_at
         FROM public.player_actions WHERE town_id = $1 AND id = $2`,
      [townId, claimed.actionId],
    );
    expect(row.rows[0]?.status).toBe("processing");
    expect(row.rows[0]?.response_status).toBeNull();
    expect(row.rows[0]?.error_code).toBeNull();
    expect(row.rows[0]?.retry_after_at).toBeNull();
  });

  describe("readActionForPlayer", () => {
    it("finds the owner's action and is 404-equivalent (undefined) for a nonexistent one", async () => {
      const { townId, playerId } = await fixtureTownAndPlayer();
      const claimed = await claimAction(db().pool, claimParams(townId, playerId));
      expect(claimed.outcome).toBe("claimed");
      if (claimed.outcome !== "claimed") throw new Error("unreachable");

      const found = await readActionForPlayer(
        db().pool,
        townId,
        playerId,
        claimed.actionId,
      );
      expect(found?.id).toBe(claimed.actionId);

      const missing = await readActionForPlayer(
        db().pool,
        townId,
        playerId,
        randomUUID(),
      );
      expect(missing).toBeUndefined();
    });

    it("is indistinguishable from a nonexistent action for another player (acceptance 10)", async () => {
      const { townId, playerId } = await fixtureTownAndPlayer();
      const otherPlayerId = await insertPlayer(db().pool, townId);
      const claimed = await claimAction(db().pool, claimParams(townId, playerId));
      expect(claimed.outcome).toBe("claimed");
      if (claimed.outcome !== "claimed") throw new Error("unreachable");

      const asWrongOwner = await readActionForPlayer(
        db().pool,
        townId,
        otherPlayerId,
        claimed.actionId,
      );
      const asNonexistent = await readActionForPlayer(
        db().pool,
        townId,
        otherPlayerId,
        randomUUID(),
      );
      expect(asWrongOwner).toBeUndefined();
      expect(asWrongOwner).toStrictEqual(asNonexistent);
    });
  });
});
