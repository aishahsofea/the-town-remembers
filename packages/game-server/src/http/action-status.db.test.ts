/**
 * `GET /api/v1/towns/{townId}/actions/{actionId}` acceptance suite (`P3-08`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ProblemResponseSchema } from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_PROCESSING_ATTEMPTS } from "../application/actions/ledger.js";
import {
  claimAction,
  completeAction,
  storeRetryableConflict,
} from "../persistence/actions.js";
import { actionRequestHash } from "../security/fingerprint.js";
import { routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

function joinAttemptSecret(): string {
  return randomBytes(32).toString("base64url");
}

function joinRequest(inviteToken: string, displayName: string): HttpRequest {
  return {
    method: "POST",
    path: `/api/v1/invites/${inviteToken}/join`,
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["idempotency-key", randomUUID()],
      ["join-attempt-secret", joinAttemptSecret()],
    ]),
    body: JSON.stringify({ displayName }),
    sourceIp: randomUUID(),
  };
}

function actionStatusRequest(
  townId: string,
  actionId: string,
  cookieHeader: string,
): HttpRequest {
  return {
    method: "GET",
    path: `/api/v1/towns/${townId}/actions/${actionId}`,
    headers: new Map([["cookie", cookieHeader]]),
    body: undefined,
    sourceIp: undefined,
  };
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

describe.skipIf(!shouldRunDatabaseTests())("action status route", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let otherTownId: string;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    config = {
      buildId: "test-build",
      appOrigin: APP_ORIGIN,
      now: () => new Date(),
      pool: handle.pool,
      securityConfig: SECURITY_CONFIG,
    };

    inviteToken = randomUUID();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = result.value.townId;

    const otherResult = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(randomUUID()).digest(),
    });
    if (otherResult.outcome !== "committed")
      throw new Error("The seed did not commit.");
    otherTownId = otherResult.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  async function joinedPlayer(displayName: string) {
    const { response } = await routeRequest(
      joinRequest(inviteToken, displayName),
      "req_join",
      config,
    );
    expect(response.status).toBe(201);
    const body = parseBody(response.body);
    const player = body["player"] as { id: string; displayName: string };
    const cookie = cookiePair(response.cookies[0]!);
    return { playerId: player.id, cookie };
  }

  it("returns 404 for a nonexistent action ID", async () => {
    const player = await joinedPlayer("Nobody's Action");
    const { response } = await routeRequest(
      actionStatusRequest(townId, randomUUID(), player.cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(404);
    expect(ProblemResponseSchema.safeParse(parseBody(response.body)).success).toBe(
      true,
    );
  }, 30_000);

  it("returns 404 for another player's action, identical to a nonexistent one", async () => {
    const owner = await joinedPlayer("Action Owner");
    const stranger = await joinedPlayer("Stranger");

    const claimed = await claimAction(db().pool, {
      townId,
      playerId: owner.playerId,
      idempotencyKey: randomUUID(),
      requestHash: actionRequestHash({
        kind: "travel",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "travel",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");

    const asStranger = await routeRequest(
      actionStatusRequest(townId, claimed.actionId, stranger.cookie),
      "req_1",
      config,
    );
    const asNonexistent = await routeRequest(
      actionStatusRequest(townId, randomUUID(), stranger.cookie),
      "req_1",
      config,
    );
    expect(asStranger.response.status).toBe(404);
    expect(parseBody(asStranger.response.body)).toStrictEqual(
      parseBody(asNonexistent.response.body),
    );
  }, 30_000);

  it("returns 202 with Retry-After, Location, and pollAfterMs while processing", async () => {
    const player = await joinedPlayer("Poller");
    const claimed = await claimAction(db().pool, {
      townId,
      playerId: player.playerId,
      idempotencyKey: randomUUID(),
      requestHash: actionRequestHash({
        kind: "travel",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "travel",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");

    const { response } = await routeRequest(
      actionStatusRequest(townId, claimed.actionId, player.cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(202);
    expect(response.headers["retry-after"]).toBe("2");
    expect(response.headers["location"]).toBe(
      `/api/v1/towns/${townId}/actions/${claimed.actionId}`,
    );
    expect(parseBody(response.body)).toStrictEqual({
      actionId: claimed.actionId,
      status: "processing",
      pollAfterMs: 2000,
    });
  }, 30_000);

  it("returns the saved completed envelope once terminal", async () => {
    const player = await joinedPlayer("Completer");
    const claimed = await claimAction(db().pool, {
      townId,
      playerId: player.playerId,
      idempotencyKey: randomUUID(),
      requestHash: actionRequestHash({
        kind: "leave",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "leave",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");

    const savedPayload = {
      actionId: claimed.actionId,
      kind: "leave",
      status: "completed",
      outcome: "applied",
      result: { visitId: randomUUID(), transitionStatus: "not_required" },
    };
    await completeAction(db().pool, Date.now() + 5_000, {
      townId,
      actionId: claimed.actionId,
      processingToken: claimed.processingToken,
      outcome: "applied",
      responseStatus: 200,
      responsePayload: savedPayload,
      visitId: null,
      now: () => new Date(),
    });

    const { response } = await routeRequest(
      actionStatusRequest(townId, claimed.actionId, player.cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(200);
    expect(parseBody(response.body)).toStrictEqual(savedPayload);
  }, 30_000);

  it("returns the saved 409 ACTION_CONFLICT with Retry-After and actionId while retryable", async () => {
    const player = await joinedPlayer("Conflicted");
    const claimed = await claimAction(db().pool, {
      townId,
      playerId: player.playerId,
      idempotencyKey: randomUUID(),
      requestHash: actionRequestHash({
        kind: "ask",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "ask",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");

    await storeRetryableConflict(db().pool, Date.now() + 5_000, {
      townId,
      actionId: claimed.actionId,
      processingToken: claimed.processingToken,
      retryAfterAt: new Date(Date.now() + 60_000),
      now: () => new Date(),
    });

    const { response } = await routeRequest(
      actionStatusRequest(townId, claimed.actionId, player.cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(409);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    const body = ProblemResponseSchema.parse(parseBody(response.body));
    expect(body.code).toBe("ACTION_CONFLICT");
    expect(body.actionId).toBe(claimed.actionId);
    expect(body.requestId).toBe("req_1");
  }, 30_000);

  it("returns the saved 503 ACTION_PROCESSING_EXHAUSTED with no Retry-After once exhausted", async () => {
    const player = await joinedPlayer("Exhausted Poller");
    const idempotencyKey = randomUUID();
    let at = new Date("2026-01-01T00:00:00.000Z");
    let lastActionId: string | undefined;

    for (let attempt = 0; attempt < MAX_PROCESSING_ATTEMPTS; attempt += 1) {
      const claimed = await claimAction(db().pool, {
        townId,
        playerId: player.playerId,
        idempotencyKey,
        requestHash: actionRequestHash({
          kind: "inspect",
          targetActorId: null,
          targetEntityId: null,
          payload: {},
        }),
        actionKind: "inspect",
        requestPayload: {},
        targetActorId: null,
        targetEntityId: null,
        now: () => at,
        deadlineAt: Date.now() + 5_000,
      });
      expect(claimed.outcome).toBe("claimed");
      if (claimed.outcome === "claimed") lastActionId = claimed.actionId;
      at = new Date(at.getTime() + 40_000);
    }

    // The `MAX_PROCESSING_ATTEMPTS`th claim above only reaches the attempt
    // cap; one more claim attempt past the cap is what actually exhausts it.
    await claimAction(db().pool, {
      townId,
      playerId: player.playerId,
      idempotencyKey,
      requestHash: actionRequestHash({
        kind: "inspect",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "inspect",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => at,
      deadlineAt: Date.now() + 5_000,
    });

    const { response } = await routeRequest(
      actionStatusRequest(townId, lastActionId!, player.cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBeUndefined();
    const body = ProblemResponseSchema.parse(parseBody(response.body));
    expect(body.code).toBe("ACTION_PROCESSING_EXHAUSTED");
    expect(body.actionId).toBe(lastActionId);
  }, 30_000);

  it("rejects a cookie minted for a different, real town as invalid session (401)", async () => {
    const player = await joinedPlayer("Cross Town Poller");
    const claimed = await claimAction(db().pool, {
      townId,
      playerId: player.playerId,
      idempotencyKey: randomUUID(),
      requestHash: actionRequestHash({
        kind: "travel",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "travel",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");

    const forgedCookie = player.cookie.replace(townId, otherTownId);
    const { response } = await routeRequest(
      actionStatusRequest(otherTownId, claimed.actionId, forgedCookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(401);
  }, 30_000);

  it("returns 410 for a retired town even with a previously valid session", async () => {
    const retiredInvite = randomUUID();
    const retiredResult = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(retiredInvite).digest(),
    });
    if (retiredResult.outcome !== "committed")
      throw new Error("The seed did not commit.");
    const retiredTownId = retiredResult.value.townId;

    const { response: joinResponse } = await routeRequest(
      joinRequest(retiredInvite, "Soon Retired Poller"),
      "req_join",
      config,
    );
    expect(joinResponse.status).toBe(201);
    const cookie = cookiePair(joinResponse.cookies[0]!);

    await db().pool.query("UPDATE public.towns SET status = 'retired' WHERE id = $1", [
      retiredTownId,
    ]);

    const { response } = await routeRequest(
      actionStatusRequest(retiredTownId, randomUUID(), cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(410);
  }, 30_000);
});
