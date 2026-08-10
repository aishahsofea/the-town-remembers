import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { townCreationRequestHash } from "../security/fingerprint.js";
import { claimCreationRequest } from "./creation-ledger.js";

describe.skipIf(!shouldRunDatabaseTests())("creation ledger claim", () => {
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

  it("claims a fresh key", async () => {
    const decision = await claimCreationRequest(db().pool, {
      idempotencyKey: randomUUID(),
      requestHash: townCreationRequestHash(),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(decision.outcome).toBe("claimed");
  });

  it("reports a fingerprint mismatch for a replay whose canonical body differs", async () => {
    const idempotencyKey = randomUUID();
    const first = await claimCreationRequest(db().pool, {
      idempotencyKey,
      requestHash: townCreationRequestHash("v1"),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(first.outcome).toBe("claimed");

    const second = await claimCreationRequest(db().pool, {
      idempotencyKey,
      requestHash: townCreationRequestHash("v2-does-not-exist"),
      contentVersion: "bell-mystery-v1",
      securityKeyVersion: "v1",
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    expect(second.outcome).toBe("hash_mismatch");
  });
});
