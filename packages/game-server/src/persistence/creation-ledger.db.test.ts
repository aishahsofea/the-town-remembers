import { randomBytes, randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { townCreationRequestHash } from "../security/fingerprint.js";
import { claimCreationRequest } from "./creation-ledger.js";

/** A fresh scope key per call, so no two test cases share a rate bucket. */
function freshScopeKey(): Buffer {
  return randomBytes(32);
}

describe.skipIf(!shouldRunDatabaseTests())("creation ledger claim", () => {
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

  it("claims a fresh key", async () => {
    const decision = await claimCreationRequest(db().pool, {
      idempotencyKey: randomUUID(),
      requestHash: townCreationRequestHash(),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      rateLimitScopeKey: freshScopeKey(),
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(decision.outcome).toBe("claimed");
  });

  it("reports a fingerprint mismatch for a replay whose canonical body differs", async () => {
    const idempotencyKey = randomUUID();
    const rateLimitScopeKey = freshScopeKey();
    const first = await claimCreationRequest(db().pool, {
      idempotencyKey,
      requestHash: townCreationRequestHash("v1"),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      rateLimitScopeKey,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(first.outcome).toBe("claimed");

    const second = await claimCreationRequest(db().pool, {
      idempotencyKey,
      requestHash: townCreationRequestHash("v2-does-not-exist"),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      rateLimitScopeKey,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(second.outcome).toBe("hash_mismatch");
  });

  it("rate-limits the sixth new key against one scope but leaves no ledger row behind", async () => {
    const rateLimitScopeKey = freshScopeKey();

    for (let index = 0; index < 5; index += 1) {
      const decision = await claimCreationRequest(db().pool, {
        idempotencyKey: randomUUID(),
        requestHash: townCreationRequestHash(),
        contentVersion: "bell-mystery-v1",
        securityKeyVersion: "v1",
        rateLimitScopeKey,
        now: () => new Date(),
        deadlineAt: Date.now() + 5_000,
      });
      expect(decision.outcome).toBe("claimed");
    }

    const sixthKey = randomUUID();
    const sixth = await claimCreationRequest(db().pool, {
      idempotencyKey: sixthKey,
      requestHash: townCreationRequestHash(),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      rateLimitScopeKey,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(sixth.outcome).toBe("rate_limited");
    if (sixth.outcome === "rate_limited") {
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    }

    const row = await db().pool.query(
      "SELECT idempotency_key FROM public.town_creation_requests WHERE idempotency_key = $1",
      [sixthKey],
    );
    expect(row.rowCount).toBe(0);

    // The same key succeeds once the bucket's own rate has had time to admit
    // it again — a 429 never permanently blocks a fresh idempotency key.
    const retried = await claimCreationRequest(db().pool, {
      idempotencyKey: sixthKey,
      requestHash: townCreationRequestHash(),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      rateLimitScopeKey,
      now: () => new Date(Date.now() + 15 * 60_000),
      deadlineAt: Date.now() + 5_000,
    });
    expect(retried.outcome).toBe("claimed");
  });
});
