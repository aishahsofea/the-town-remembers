import { createHash, randomBytes, randomUUID } from "node:crypto";

import { materializeTown } from "@the-town-remembers/town-seed";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { join } from "../application/join.js";
import { joinRequestHash } from "../security/fingerprint.js";
import { claimJoinRequest } from "./join-ledger.js";
import { authenticate, confirmBootstrap, reissueIfDue } from "./sessions.js";

const SESSION_TOKEN_PEPPER = "test-pepper-not-real";

function sessionTokenHashOf(token: string): Buffer {
  return createHash("sha256")
    .update(SESSION_TOKEN_PEPPER, "utf8")
    .update(token, "utf8")
    .digest();
}

describe.skipIf(!shouldRunDatabaseTests())("session authentication and refresh", () => {
  let handle: DisposableDatabase | undefined;
  let townId: string;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(randomUUID()).digest(),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = result.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  async function joinFreshPlayer(displayName: string) {
    return join(
      {
        pool: db().pool,
        sessionTokenPepper: SESSION_TOKEN_PEPPER,
        now: () => new Date(),
      },
      {
        townId,
        townActive: true,
        townStatus: "active",
        idempotencyKey: randomUUID(),
        joinAttemptSecret: randomBytes(32).toString("base64url"),
        displayName,
      },
    );
  }

  it("authenticates a valid session token", async () => {
    const result = await joinFreshPlayer("Auth Ok");
    const outcome = await authenticate(
      db().pool,
      townId,
      sessionTokenHashOf(result.sessionToken),
    );
    expect(outcome.outcome).toBe("authenticated");
    if (outcome.outcome === "authenticated") {
      expect(outcome.session.playerId).toBe(result.player.id);
    }
  }, 30_000);

  it("rejects an unknown token", async () => {
    const outcome = await authenticate(db().pool, townId, randomBytes(32));
    expect(outcome.outcome).toBe("invalid_session");
  }, 30_000);

  it("rejects a token presented against a town that does not exist at all", async () => {
    const outcome = await authenticate(db().pool, randomUUID(), randomBytes(32));
    expect(outcome.outcome).toBe("invalid_session");
  }, 30_000);

  it("rejects a token scoped to a different town", async () => {
    const otherTown = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(randomUUID()).digest(),
    });
    if (otherTown.outcome !== "committed") throw new Error("The seed did not commit.");

    const result = await joinFreshPlayer("Cross Town");
    const outcome = await authenticate(
      db().pool,
      otherTown.value.townId,
      sessionTokenHashOf(result.sessionToken),
    );
    expect(outcome.outcome).toBe("invalid_session");
  }, 30_000);

  it("rejects a revoked session", async () => {
    const result = await joinFreshPlayer("Revoked Player");
    const beforeRevoke = await authenticate(
      db().pool,
      townId,
      sessionTokenHashOf(result.sessionToken),
    );
    expect(beforeRevoke.outcome).toBe("authenticated");

    await db().pool.query(
      "UPDATE public.player_sessions SET status = 'revoked' WHERE town_id = $1 AND player_id = $2",
      [townId, result.player.id],
    );

    const outcome = await authenticate(
      db().pool,
      townId,
      sessionTokenHashOf(result.sessionToken),
    );
    expect(outcome.outcome).toBe("invalid_session");
  }, 30_000);

  it("reports a retired town even for an otherwise-valid session", async () => {
    const retiring = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(randomUUID()).digest(),
    });
    if (retiring.outcome !== "committed") throw new Error("The seed did not commit.");
    const retiredTownId = retiring.value.townId;

    const result = await join(
      {
        pool: db().pool,
        sessionTokenPepper: SESSION_TOKEN_PEPPER,
        now: () => new Date(),
      },
      {
        townId: retiredTownId,
        townActive: true,
        townStatus: "active",
        idempotencyKey: randomUUID(),
        joinAttemptSecret: randomBytes(32).toString("base64url"),
        displayName: "Retired Town Player",
      },
    );

    await db().pool.query("UPDATE public.towns SET status = 'retired' WHERE id = $1", [
      retiredTownId,
    ]);

    const outcome = await authenticate(
      db().pool,
      retiredTownId,
      sessionTokenHashOf(result.sessionToken),
    );
    expect(outcome.outcome).toBe("town_retired");
  }, 30_000);

  it("does not reissue before 30 days but does at or after", async () => {
    const result = await joinFreshPlayer("Reissue Timing");
    const outcome = await authenticate(
      db().pool,
      townId,
      sessionTokenHashOf(result.sessionToken),
    );
    if (outcome.outcome !== "authenticated") throw new Error("expected authenticated");
    const sessionId = outcome.session.sessionId;

    const at29Days = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(await reissueIfDue(db().pool, townId, sessionId, at29Days)).toBe(false);

    const at31Days = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await reissueIfDue(db().pool, townId, sessionId, at31Days)).toBe(true);
  }, 30_000);

  it("elects exactly one of five concurrent requests to reissue", async () => {
    const result = await joinFreshPlayer("Concurrent Reissue");
    const outcome = await authenticate(
      db().pool,
      townId,
      sessionTokenHashOf(result.sessionToken),
    );
    if (outcome.outcome !== "authenticated") throw new Error("expected authenticated");
    const sessionId = outcome.session.sessionId;

    const due = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reissueIfDue(db().pool, townId, sessionId, due)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  }, 30_000);

  it("closes the replay window and clears the join secret on bootstrap confirmation", async () => {
    const result = await joinFreshPlayer("Bootstrap Confirm");
    const outcome = await authenticate(
      db().pool,
      townId,
      sessionTokenHashOf(result.sessionToken),
    );
    if (outcome.outcome !== "authenticated") throw new Error("expected authenticated");

    await confirmBootstrap(
      db().pool,
      townId,
      outcome.session.joinRequestId,
      new Date(),
    );

    const row = await db().pool.query<{
      bootstrap_confirmed_at: Date | null;
      join_secret_hash: Buffer | null;
    }>(
      "SELECT bootstrap_confirmed_at, join_secret_hash FROM public.join_requests WHERE town_id = $1 AND idempotency_key = $2",
      [townId, outcome.session.joinRequestId],
    );
    expect(row.rows[0]?.bootstrap_confirmed_at).not.toBeNull();
    expect(row.rows[0]?.join_secret_hash).toBeNull();

    const replay = await claimJoinRequest(db().pool, {
      townId,
      idempotencyKey: outcome.session.joinRequestId,
      requestHash: joinRequestHash({ displayName: "Bootstrap Confirm" }),
      joinSecretHash: randomBytes(32),
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(replay).toStrictEqual({ outcome: "closed", reason: "confirmed" });
  }, 30_000);
});
