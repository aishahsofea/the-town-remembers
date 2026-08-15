import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, test } from "node:test";

import {
  DbSuiteOwnershipError,
  acquire,
  assertNoActiveOwner,
  readOwner,
  release,
} from "./db-suite-lock.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function lockPathFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-db-lock-"));
  temporaryDirectories.push(rootDir);
  return path.join(rootDir, "nested", "db-suite-owner.lock");
}

test("acquire creates a lock recording pid, kind, run id, and start time", () => {
  const lockPath = lockPathFixture();
  const record = acquire("test:db", { lockPath });

  assert.equal(record.pid, process.pid);
  assert.equal(record.kind, "test:db");
  assert.match(record.runId, /^\d+-/);
  assert.equal(readOwner(lockPath).runId, record.runId);
});

test("a second acquire refuses while the first owner is alive", () => {
  const lockPath = lockPathFixture();
  acquire("test:db", { lockPath });

  assert.throws(() => acquire("test", { lockPath }), DbSuiteOwnershipError);
});

test("assertNoActiveOwner throws with the owner's kind and pid in the message", () => {
  const lockPath = lockPathFixture();
  acquire("test:e2e", { lockPath });

  assert.throws(
    () => assertNoActiveOwner(lockPath),
    (error) => {
      assert.ok(error instanceof DbSuiteOwnershipError);
      assert.match(error.message, /test:e2e/);
      assert.match(error.message, new RegExp(String(process.pid)));
      return true;
    },
  );
});

test("assertNoActiveOwner is silent when no lock file exists", () => {
  const lockPath = lockPathFixture();
  assertNoActiveOwner(lockPath);
});

test("a lock left by a dead pid is treated as stale and does not block a new owner", () => {
  const lockPath = lockPathFixture();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: 999_999,
      kind: "test:db",
      runId: "stale-run",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );

  assertNoActiveOwner(lockPath);
  const record = acquire("test:db", { lockPath });
  assert.notEqual(record.runId, "stale-run");
});

test("release removes the lock only when the caller still owns it", () => {
  const lockPath = lockPathFixture();
  const first = acquire("test:db", { lockPath });

  release({ ...first, runId: "someone-elses-run" }, { lockPath });
  assert.notEqual(readOwner(lockPath), undefined);

  release(first, { lockPath });
  assert.equal(readOwner(lockPath), undefined);
});

test("release then acquire lets a new owner take the lock", () => {
  const lockPath = lockPathFixture();
  const first = acquire("test:db", { lockPath });
  release(first, { lockPath });

  const second = acquire("test:e2e", { lockPath });
  assert.equal(second.kind, "test:e2e");
});
