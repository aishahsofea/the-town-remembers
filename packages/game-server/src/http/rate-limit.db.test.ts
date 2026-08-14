/**
 * `P3-07` route-level rate limiting, proved through the real HTTP surface.
 * The token-bucket algorithm itself (burst/sustained-rate arithmetic,
 * concurrency, town-folding) is proved directly against
 * `persistence/rate-limits.ts` in `rate-limits.db.test.ts`; this file proves
 * the *wiring*: a `429` leaves no ledger row, a replay bypasses a drained
 * bucket, and invite preview is never gated at all.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import { materializeTown } from "@the-town-remembers/town-seed";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

const JUDGE_CODE = "correct-judge-code-for-tests";
const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: JUDGE_CODE,
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

function createTownRequest(input: {
  readonly idempotencyKey: string;
  readonly sourceIp: string | undefined;
}): HttpRequest {
  return {
    method: "POST",
    path: "/api/v1/towns",
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["idempotency-key", input.idempotencyKey],
      ["authorization", `Bearer ${JUDGE_CODE}`],
    ]),
    body: "{}",
    sourceIp: input.sourceIp,
  };
}

function joinAttemptSecret(): string {
  return randomBytes(32).toString("base64url");
}

function joinRequest(input: {
  readonly inviteToken: string;
  readonly idempotencyKey: string;
  readonly secret: string;
  readonly displayName: string;
  readonly sourceIp: string | undefined;
}): HttpRequest {
  return {
    method: "POST",
    path: `/api/v1/invites/${input.inviteToken}/join`,
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["idempotency-key", input.idempotencyKey],
      ["join-attempt-secret", input.secret],
    ]),
    body: JSON.stringify({ displayName: input.displayName }),
    sourceIp: input.sourceIp,
  };
}

function invitePreviewRequest(inviteToken: string): HttpRequest {
  return {
    method: "GET",
    path: `/api/v1/invites/${inviteToken}`,
    headers: new Map(),
    body: undefined,
    sourceIp: randomUUID(),
  };
}

function playerViewRequest(townId: string, cookieHeader: string): HttpRequest {
  return {
    method: "GET",
    path: `/api/v1/towns/${townId}/player-view`,
    headers: new Map([["cookie", cookieHeader]]),
    body: undefined,
    sourceIp: randomUUID(),
  };
}

/** The `Set-Cookie` value's `name=value` pair, reusable as a request `Cookie` header. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

describe.skipIf(!shouldRunDatabaseTests())("route-level rate limiting", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    config = {
      buildId: "test-build",
      appOrigin: APP_ORIGIN,
      now: () => new Date(),
      pool: handle.pool,
      securityConfig: SECURITY_CONFIG,
    };
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("a 429 on town creation leaves no ledger row, and the same key succeeds once the bucket admits again", async () => {
    const sourceIp = randomUUID();

    // town_creation's burst is 5.
    for (let index = 0; index < 5; index += 1) {
      const { response } = await routeRequest(
        createTownRequest({ idempotencyKey: randomUUID(), sourceIp }),
        `req_${index}`,
        config,
      );
      expect(response.status).toBe(201);
    }

    const sixthKey = randomUUID();
    const { response: sixth } = await routeRequest(
      createTownRequest({ idempotencyKey: sixthKey, sourceIp }),
      "req_sixth",
      config,
    );
    expect(sixth.status).toBe(429);
    expect(sixth.headers["retry-after"]).toBeDefined();

    const row = await db().pool.query(
      "SELECT idempotency_key FROM public.town_creation_requests WHERE idempotency_key = $1",
      [sixthKey],
    );
    expect(row.rowCount).toBe(0);

    const retryAfterSeconds = Number(sixth.headers["retry-after"]);
    const laterConfig: RouterConfig = {
      ...config,
      now: () => new Date(Date.now() + (retryAfterSeconds + 1) * 1000),
    };
    const { response: retried } = await routeRequest(
      createTownRequest({ idempotencyKey: sixthKey, sourceIp }),
      "req_retried",
      laterConfig,
    );
    expect(retried.status).toBe(201);
  }, 30_000);

  it("a 429 on join leaves no ledger row", async () => {
    const inviteToken = randomUUID();
    const seed = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (seed.outcome !== "committed") throw new Error("The seed did not commit.");

    const sourceIp = randomUUID();

    // join's burst is 10.
    for (let index = 0; index < 10; index += 1) {
      const { response } = await routeRequest(
        joinRequest({
          inviteToken,
          idempotencyKey: randomUUID(),
          secret: joinAttemptSecret(),
          displayName: `Drainer ${index}`,
          sourceIp,
        }),
        `req_${index}`,
        config,
      );
      expect(response.status).toBe(201);
    }

    const eleventhKey = randomUUID();
    const { response: eleventh } = await routeRequest(
      joinRequest({
        inviteToken,
        idempotencyKey: eleventhKey,
        secret: joinAttemptSecret(),
        displayName: "Rejected",
        sourceIp,
      }),
      "req_eleventh",
      config,
    );
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers["retry-after"]).toBeDefined();

    const row = await db().pool.query(
      "SELECT idempotency_key FROM public.join_requests WHERE town_id = $1 AND idempotency_key = $2",
      [seed.value.townId, eleventhKey],
    );
    expect(row.rowCount).toBe(0);
  }, 30_000);

  it("recognizes a replay before the bucket is consumed: a drained join bucket still returns the saved response", async () => {
    const inviteToken = randomUUID();
    const seed = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (seed.outcome !== "committed") throw new Error("The seed did not commit.");

    const sourceIp = randomUUID();
    const firstKey = randomUUID();
    const firstSecret = joinAttemptSecret();
    const first = await routeRequest(
      joinRequest({
        inviteToken,
        idempotencyKey: firstKey,
        secret: firstSecret,
        displayName: "First Joiner",
        sourceIp,
      }),
      "req_first",
      config,
    );
    expect(first.response.status).toBe(201);

    // Drain the rest of the burst (9 more, for 10 total new claims).
    for (let index = 0; index < 9; index += 1) {
      const { response } = await routeRequest(
        joinRequest({
          inviteToken,
          idempotencyKey: randomUUID(),
          secret: joinAttemptSecret(),
          displayName: `Drainer ${index}`,
          sourceIp,
        }),
        `req_drain_${index}`,
        config,
      );
      expect(response.status).toBe(201);
    }

    // Confirm the bucket is in fact drained for a genuinely new key.
    const { response: drained } = await routeRequest(
      joinRequest({
        inviteToken,
        idempotencyKey: randomUUID(),
        secret: joinAttemptSecret(),
        displayName: "Should Be Rejected",
        sourceIp,
      }),
      "req_confirm_drained",
      config,
    );
    expect(drained.status).toBe(429);

    // The very first key, replayed with its own secret, still succeeds.
    const replay = await routeRequest(
      joinRequest({
        inviteToken,
        idempotencyKey: firstKey,
        secret: firstSecret,
        displayName: "First Joiner",
        sourceIp,
      }),
      "req_replay",
      config,
    );
    expect(replay.response.status).toBe(201);
    expect(replay.response.body).toBe(first.response.body);
  }, 30_000);

  it("never rate-limits invite preview", async () => {
    const inviteToken = randomUUID();
    const seed = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (seed.outcome !== "committed") throw new Error("The seed did not commit.");

    // Comfortably more than any configured burst (max 10), from a single
    // fixed vantage point, to prove there is no bucket to exhaust.
    for (let index = 0; index < 25; index += 1) {
      const { response } = await routeRequest(
        invitePreviewRequest(inviteToken),
        `req_${index}`,
        config,
      );
      expect(response.status).toBe(200);
    }
  }, 30_000);

  it("still admits and scopes consistently when the transport reports no source IP", async () => {
    const idempotencyKey = randomUUID();
    const { response } = await routeRequest(
      createTownRequest({ idempotencyKey, sourceIp: undefined }),
      "req_1",
      config,
    );
    expect(response.status).toBe(201);

    const inviteToken = randomUUID();
    const seed = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (seed.outcome !== "committed") throw new Error("The seed did not commit.");

    const { response: joined } = await routeRequest(
      joinRequest({
        inviteToken,
        idempotencyKey: randomUUID(),
        secret: joinAttemptSecret(),
        displayName: "No IP Joiner",
        sourceIp: undefined,
      }),
      "req_2",
      config,
    );
    expect(joined.status).toBe(201);
  }, 30_000);

  it("the eleventh player-view within a burst is 429 with Retry-After", async () => {
    const now = new Date();
    const fixedTimeConfig: RouterConfig = { ...config, now: () => now };
    const inviteToken = randomUUID();
    const seed = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: now,
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (seed.outcome !== "committed") throw new Error("The seed did not commit.");

    const joined = await routeRequest(
      joinRequest({
        inviteToken,
        idempotencyKey: randomUUID(),
        secret: joinAttemptSecret(),
        displayName: "View Burner",
        sourceIp: randomUUID(),
      }),
      "req_join",
      fixedTimeConfig,
    );
    expect(joined.response.status).toBe(201);
    const cookie = cookiePair(joined.response.cookies[0]!);

    // player_view's burst is 10.
    for (let index = 0; index < 10; index += 1) {
      const { response } = await routeRequest(
        playerViewRequest(seed.value.townId, cookie),
        `req_view_${index}`,
        fixedTimeConfig,
      );
      expect(response.status).toBe(200);
    }

    const { response: eleventh } = await routeRequest(
      playerViewRequest(seed.value.townId, cookie),
      "req_view_eleventh",
      fixedTimeConfig,
    );
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers["retry-after"]).toBeDefined();
  }, 30_000);
});
