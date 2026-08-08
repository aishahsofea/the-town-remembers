import { randomUUID } from "node:crypto";

import { runSerializable } from "@the-town-remembers/database";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The transaction helper's behavior against a real engine.
 *
 * These live beside the migrations rather than beside the helper because the
 * disposable harness needs `database-admin` to migrate, and a package that
 * `test-support` depends on cannot depend back on it without closing a cycle
 * the workspace check exists to prevent.
 */

describe.skipIf(!shouldRunDatabaseTests())("serializable transactions", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  const deadline = () => ({ deadlineAt: Date.now() + 20_000 });

  it("commits and reports no retries when nothing conflicts", async () => {
    const result = await runSerializable(database().pool, deadline(), (tx) =>
      tx.query<{ value: number }>("SELECT 1 AS value"),
    );
    expect(result.outcome).toBe("committed");
    expect(result.outcome === "committed" && result.retries).toBe(0);
  });

  it("rolls back every write when the body throws", async () => {
    const townId = randomUUID();
    await expect(
      runSerializable(database().pool, deadline(), async (tx) => {
        await tx.query(
          `INSERT INTO public.towns
             (id, invite_token_hash, content_version, status, created_at, updated_at)
           VALUES ($1, $2, 'bell-mystery-v1', 'active', now(), now())`,
          [townId, Buffer.alloc(32, 3)],
        );
        throw new Error("deliberate failure");
      }),
    ).rejects.toThrow();

    const rows = await database().pool.query(
      "SELECT 1 FROM public.towns WHERE id = $1",
      [townId],
    );
    expect(rows.rowCount).toBe(0);
  });

  it("retries a real serialization conflict and re-runs the body whole", async () => {
    const townId = randomUUID();
    await database().pool.query(
      `INSERT INTO public.towns
         (id, invite_token_hash, content_version, status, revision, created_at, updated_at)
       VALUES ($1, $2, 'bell-mystery-v1', 'active', 0, now(), now())`,
      [townId, Buffer.alloc(32, 4)],
    );

    const attempts: number[] = [];
    const observedRevisions: number[] = [];

    const result = await runSerializable(
      database().pool,
      { ...deadline(), onAttempt: (attempt) => attempts.push(attempt) },
      async (tx) => {
        const rows = await tx.query<{ revision: number }>(
          "SELECT revision FROM public.towns WHERE id = $1",
          [townId],
        );
        const revision = rows[0]?.revision ?? 0;
        observedRevisions.push(revision);

        // Only the first attempt races an outside writer. The retry therefore
        // observes the newer revision, which is the property that matters:
        // the body re-reads rather than reusing its stale value.
        if (attempts.length === 1) {
          await database().pool.query(
            "UPDATE public.towns SET revision = revision + 1, updated_at = now() WHERE id = $1",
            [townId],
          );
        }

        await tx.query(
          "UPDATE public.towns SET revision = $2, updated_at = now() WHERE id = $1",
          [townId, revision + 10],
        );
        return revision;
      },
    );

    expect(result.outcome).toBe("committed");
    expect(attempts.length).toBeGreaterThan(1);
    expect(observedRevisions.at(-1)).toBeGreaterThan(observedRevisions[0] ?? 0);
  }, 30_000);

  it("stops at the deadline instead of attempting again", async () => {
    await expect(
      runSerializable(database().pool, { deadlineAt: Date.now() - 1 }, (tx) =>
        tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "deadline_exceeded" });
  });

  it("surfaces a constraint violation as a categorized, value-free error", async () => {
    await expect(
      runSerializable(database().pool, deadline(), (tx) =>
        tx.query(
          `INSERT INTO public.towns
             (id, invite_token_hash, content_version, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, 'bell-mystery-v1', 'paused', now(), now())`,
          [Buffer.alloc(32, 5)],
        ),
      ),
    ).rejects.toMatchObject({
      category: "check_violation",
      constraintName: "ck_towns__status",
    });
  });
});
