#!/usr/bin/env node

/**
 * Finds and drops orphaned scratch/disposable CockroachDB databases left
 * behind when a test run, `db:doctor` run, or `pnpm validate` is killed
 * (SIGTERM/SIGKILL) before its own cleanup — `dispose()` in
 * packages/test-support/src/database/harness.ts, or db-doctor.mjs's own
 * scratch drop — gets to run. A killed process cannot run its own
 * `finally` block, so nothing else in this repo notices until the local
 * cluster has accumulated dozens of never-dropped databases and every
 * schema-touching operation slows down cluster-wide (catalog/range
 * overhead scales with database count, not with how much of that data
 * anyone still needs).
 *
 * Only ever targets names matching a known scratch/disposable prefix
 * (`ttr_test_`, `ttr_doctor_`, `ttr_explain_`) — the same discipline
 * harness.ts's `assertDisposableName` uses before its own `DROP DATABASE`.
 * `defaultdb`, `postgres`, `system`, and any real application database are
 * structurally impossible to match.
 */

import process from "node:process";
import pg from "pg";
import { applyLocalDefaults } from "./local-env.mjs";

export const ORPHAN_NAME_PATTERN =
  /^(ttr_test_[a-z0-9]{12}|ttr_doctor_[a-z0-9]+|ttr_explain_[a-z0-9_]+)$/;

export function isOrphanDatabaseName(name) {
  return ORPHAN_NAME_PATTERN.test(name);
}

export function selectOrphanNames(allDatabaseNames) {
  return allDatabaseNames.filter(isOrphanDatabaseName).sort();
}

export async function listDatabaseNames(pool) {
  const result = await pool.query("SHOW DATABASES");
  return result.rows.map((row) => row.database_name);
}

/** Drops each name, skipping (never throwing on) any name that fails the
 * orphan-name check — the same guard harness.ts's dispose() applies before
 * its own DROP DATABASE, kept here too so a caller can never widen this
 * script's blast radius by passing in an unrelated name. */
export async function dropOrphanDatabases(pool, names) {
  const dropped = [];
  const skipped = [];
  for (const name of names) {
    if (!isOrphanDatabaseName(name)) {
      skipped.push(name);
      continue;
    }
    await pool.query(`DROP DATABASE IF EXISTS "${name}" CASCADE`);
    dropped.push(name);
  }
  return { dropped, skipped };
}

async function runCli() {
  const shouldDrop = process.argv.includes("--drop");

  applyLocalDefaults();
  const { loadTestConfig } = await import("@the-town-remembers/runtime-config/test");
  const adminUrl = loadTestConfig(process.env).testDatabaseUrl;
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });

  try {
    const allNames = await listDatabaseNames(pool);
    const orphans = selectOrphanNames(allNames);

    if (orphans.length === 0) {
      console.log("No orphaned scratch/disposable databases found.");
      return;
    }

    if (!shouldDrop) {
      console.log(
        `${orphans.length} orphaned database(s) found (dry run, pass --drop to remove):`,
      );
      for (const name of orphans) {
        console.log(`- ${name}`);
      }
      return;
    }

    console.log(`Dropping ${orphans.length} orphaned database(s)...`);
    const { dropped } = await dropOrphanDatabases(pool, orphans);
    console.log(`Dropped ${dropped.length} database(s).`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
