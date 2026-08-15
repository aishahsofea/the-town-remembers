#!/usr/bin/env node

/**
 * Inter-process ownership for local CockroachDB integration runs.
 *
 * `pnpm test:db`, the database project inside `pnpm test`, and Playwright's
 * database setup all migrate against the same local node. Running two of
 * them at once does not fail loudly — it serializes schema changes until one
 * side times out, which the profiling audit hit directly (a three-case file
 * took 180s under contention). An atomic lock file turns that silent stall
 * into an immediate, actionable refusal.
 *
 * The lock is a single file written with the `wx` flag, so creation itself is
 * the atomic compare-and-set: two processes racing to create it can never
 * both succeed. A crashed owner cannot strand later runs because every check
 * verifies the recorded PID is still alive before treating the lock as live.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { REPOSITORY_ROOT } from "./local-env.mjs";

export const LOCK_PATH = path.join(REPOSITORY_ROOT, ".cache", "db-suite-owner.lock");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by someone else — still alive.
    return error.code === "EPERM";
  }
}

export function readOwner(lockPath = LOCK_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Removes the lock if its owner's PID is no longer running. Returns the live owner, if any. */
function clearStaleOwner(lockPath) {
  const owner = readOwner(lockPath);
  if (owner === undefined) return undefined;
  if (isAlive(owner.pid)) return owner;
  fs.rmSync(lockPath, { force: true });
  return undefined;
}

export class DbSuiteOwnershipError extends Error {
  constructor(owner, lockPath) {
    const startedAt = Date.parse(owner.startedAt);
    const elapsedSeconds = Number.isNaN(startedAt)
      ? "an unknown time"
      : `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s`;
    super(
      `Another database suite is already running: "${owner.kind}" (pid ${owner.pid}, ` +
        `run ${owner.runId}), started ${elapsedSeconds} ago. Wait for it to finish. ` +
        `If it crashed without cleaning up, confirm pid ${owner.pid} is not running, ` +
        `then remove ${lockPath}.`,
    );
    this.name = "DbSuiteOwnershipError";
    this.owner = owner;
  }
}

/** Throws DbSuiteOwnershipError if a live owner holds the lock; does not acquire it. */
export function assertNoActiveOwner(lockPath = LOCK_PATH) {
  const owner = clearStaleOwner(lockPath);
  if (owner !== undefined) throw new DbSuiteOwnershipError(owner, lockPath);
}

/**
 * Atomically claims the lock for `kind` (e.g. "test:db", "test", "e2e").
 * Returns a handle to pass to `release`. Throws DbSuiteOwnershipError if a
 * live owner already holds it.
 */
export function acquire(kind, { lockPath = LOCK_PATH, pid = process.pid } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const record = {
    pid,
    kind,
    runId: `${pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
  };

  for (;;) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify(record), { flag: "wx" });
      return record;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = clearStaleOwner(lockPath);
      if (owner !== undefined) throw new DbSuiteOwnershipError(owner, lockPath);
      // The stale owner was just cleared; retry the atomic create.
    }
  }
}

/** Releases the lock only if it is still ours (matching runId), so a stale release can never steal a newer owner's lock. */
export function release(record, { lockPath = LOCK_PATH } = {}) {
  const current = readOwner(lockPath);
  if (current !== undefined && current.runId === record.runId) {
    fs.rmSync(lockPath, { force: true });
  }
}
