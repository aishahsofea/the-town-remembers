import { randomUUID } from "node:crypto";

import { runSerializable } from "@the-town-remembers/database";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  admitRateLimit,
  checkRateLimit,
  RATE_LIMIT_BUCKETS,
  rateScopeKey,
} from "./rate-limits.js";

const PLAYER_VIEW_BUCKET = RATE_LIMIT_BUCKETS.playerView;

describe.skipIf(!shouldRunDatabaseTests())("api_rate_limits token bucket", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("admits exactly ten within one second, rejects the eleventh, and admits again after the stated Retry-After", async () => {
    const scopeKey = rateScopeKey("player", randomUUID(), randomUUID());
    // The bucket's own arithmetic runs on this synthetic clock; `deadlineAt`
    // is `runSerializable`'s real-wall-clock retry budget and is unrelated.
    const start = new Date("2026-01-01T00:00:00.000Z");
    const deadlineAt = Date.now() + 30_000;

    const admissions: boolean[] = [];
    for (let index = 0; index < 10; index += 1) {
      const decision = await checkRateLimit(
        db().pool,
        deadlineAt,
        PLAYER_VIEW_BUCKET,
        scopeKey,
        start,
      );
      admissions.push(decision.admitted);
    }
    expect(admissions.every(Boolean)).toBe(true);

    const eleventh = await checkRateLimit(
      db().pool,
      deadlineAt,
      PLAYER_VIEW_BUCKET,
      scopeKey,
      start,
    );
    expect(eleventh.admitted).toBe(false);
    if (eleventh.admitted) throw new Error("unreachable");
    expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);

    const afterWait = new Date(start.getTime() + eleventh.retryAfterSeconds * 1000);
    const retried = await checkRateLimit(
      db().pool,
      deadlineAt,
      PLAYER_VIEW_BUCKET,
      scopeKey,
      afterWait,
    );
    expect(retried.admitted).toBe(true);
  }, 30_000);

  it("admits exactly thirty within one minute of sustained draining, and rejects the thirty-first", async () => {
    const scopeKey = rateScopeKey("player", randomUUID(), randomUUID());
    const start = new Date("2026-01-01T00:00:00.000Z");
    const deadlineAt = Date.now() + 30_000;

    // Ten burst tokens at t=0, then drain the steady 30/minute refill by
    // checking once every two seconds — the bucket's own exact cadence — for
    // the rest of the minute. 10 (burst) + 20 (steady, t=2s..40s) = 30.
    let admittedCount = 0;
    for (let index = 0; index < 10; index += 1) {
      const decision = await checkRateLimit(
        db().pool,
        deadlineAt,
        PLAYER_VIEW_BUCKET,
        scopeKey,
        start,
      );
      if (decision.admitted) admittedCount += 1;
    }
    for (let second = 2; second <= 40; second += 2) {
      const decision = await checkRateLimit(
        db().pool,
        deadlineAt,
        PLAYER_VIEW_BUCKET,
        scopeKey,
        new Date(start.getTime() + second * 1000),
      );
      if (decision.admitted) admittedCount += 1;
    }
    expect(admittedCount).toBe(30);

    const thirtyFirst = await checkRateLimit(
      db().pool,
      deadlineAt,
      PLAYER_VIEW_BUCKET,
      scopeKey,
      new Date(start.getTime() + 40_000),
    );
    expect(thirtyFirst.admitted).toBe(false);
  }, 30_000);

  it("admits exactly ten of twenty real concurrent checks against a burst-10 bucket", async () => {
    const scopeKey = rateScopeKey("player", randomUUID(), randomUUID());
    const now = new Date();
    const deadlineAt = now.getTime() + 20_000;

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        checkRateLimit(db().pool, deadlineAt, PLAYER_VIEW_BUCKET, scopeKey, now),
      ),
    );

    const admitted = results.filter((result) => result.admitted);
    expect(admitted).toHaveLength(10);
  }, 30_000);

  it("persists scope_key as exactly 32 bytes, never a dotted or colonned address", async () => {
    const testIp = "203.0.113.77";
    const scopeKey = rateScopeKey("ip_hash", "", testIp);
    const now = new Date();
    const deadlineAt = now.getTime() + 10_000;

    await runSerializable(db().pool, { deadlineAt }, (transaction) =>
      admitRateLimit(transaction, PLAYER_VIEW_BUCKET, scopeKey, now),
    );

    const row = await db().pool.query<{ scope_key: Buffer }>(
      `SELECT scope_key FROM public.api_rate_limits WHERE scope_key = $1`,
      [scopeKey],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]!.scope_key).toHaveLength(32);
    expect(row.rows[0]!.scope_key.toString("utf8")).not.toContain(testIp);

    const all = await db().pool.query<{ scope_key: Buffer }>(
      `SELECT scope_key FROM public.api_rate_limits`,
    );
    for (const candidate of all.rows) {
      expect(candidate.scope_key).toHaveLength(32);
      expect(candidate.scope_key.toString("utf8")).not.toContain(testIp);
    }
  }, 30_000);

  it("gives two players in the same town, and the same player id in two towns, independent buckets", async () => {
    const townA = randomUUID();
    const townB = randomUUID();
    const playerX = randomUUID();
    const playerY = randomUUID();
    const now = new Date();
    const deadlineAt = now.getTime() + 10_000;

    const scopeAX = rateScopeKey("player", townA, playerX);
    const scopeAY = rateScopeKey("player", townA, playerY);
    const scopeBX = rateScopeKey("player", townB, playerX);

    const drain = async (scopeKey: Buffer) => {
      let lastAdmitted = true;
      for (let index = 0; index < 10; index += 1) {
        const decision = await checkRateLimit(
          db().pool,
          deadlineAt,
          PLAYER_VIEW_BUCKET,
          scopeKey,
          now,
        );
        lastAdmitted = decision.admitted;
      }
      return lastAdmitted;
    };

    expect(await drain(scopeAX)).toBe(true);

    // Player X's town-A bucket is now empty; a same-town different player,
    // and the same player id under a different town, must both still admit.
    const otherPlayerSameTown = await checkRateLimit(
      db().pool,
      deadlineAt,
      PLAYER_VIEW_BUCKET,
      scopeAY,
      now,
    );
    expect(otherPlayerSameTown.admitted).toBe(true);

    const samePlayerOtherTown = await checkRateLimit(
      db().pool,
      deadlineAt,
      PLAYER_VIEW_BUCKET,
      scopeBX,
      now,
    );
    expect(samePlayerOtherTown.admitted).toBe(true);

    const exhaustedAgain = await checkRateLimit(
      db().pool,
      deadlineAt,
      PLAYER_VIEW_BUCKET,
      scopeAX,
      now,
    );
    expect(exhaustedAgain.admitted).toBe(false);
  }, 30_000);
});
