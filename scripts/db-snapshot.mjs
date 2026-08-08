#!/usr/bin/env node

/**
 * Regenerates the committed schema snapshot.
 *
 * The audit compares a freshly migrated database against
 * `packages/database-admin/schema-snapshot.json`. That file is the reviewable
 * record of what the migrations actually produce, so it is regenerated
 * deliberately by this command and never by a test: a drift test that could
 * rewrite its own expectation proves nothing.
 *
 * Run it after intentionally changing a migration, and read the diff.
 */

import { writeFile } from "node:fs/promises";
import process from "node:process";

import pg from "pg";

import { applyLocalDefaults } from "./local-env.mjs";

const SNAPSHOT_PATH = new URL(
  "../packages/database-admin/schema-snapshot.json",
  import.meta.url,
);

async function main() {
  applyLocalDefaults();

  const { loadTestConfig } = await import("@the-town-remembers/runtime-config/test");
  const { applyMigrations, readSchemaSnapshot } =
    await import("@the-town-remembers/database-admin");

  const adminUrl = loadTestConfig(process.env).testDatabaseUrl;
  const name = `ttr_snapshot_${Math.floor(Math.random() * 1e12).toString(36)}`;
  const serverPool = new pg.Pool({ connectionString: adminUrl, max: 1 });

  try {
    await serverPool.query(`CREATE DATABASE ${name}`);
    const target = new URL(adminUrl);
    target.pathname = `/${name}`;

    const pool = new pg.Pool({ connectionString: target.toString(), max: 1 });
    try {
      await applyMigrations(pool);
      const snapshot = await readSchemaSnapshot(pool);
      await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      console.log(
        `Wrote ${Object.keys(snapshot.tables).length} tables and ` +
          `${snapshot.views.length} views to schema-snapshot.json`,
      );
    } finally {
      await pool.end();
    }
  } finally {
    await serverPool.query(`DROP DATABASE IF EXISTS ${name} CASCADE`);
    await serverPool.end();
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
