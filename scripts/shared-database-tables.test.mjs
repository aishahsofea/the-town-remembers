import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * `SHARED_DATABASE_MUTABLE_TABLES` (packages/test-support/src/database/
 * harness.ts) is a hand-reviewed list, deliberately not discovered at
 * runtime (`VPR-07`). This checks it against the real migrations so a new
 * migration's table can't silently go unreset between shared-migrated test
 * files without anyone noticing -- the only other way to catch that is a
 * live database, which this file, running under `pnpm test:tooling`,
 * intentionally does not use.
 */

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  "../packages/database-admin/migrations",
);

function tablesCreatedByMigrations() {
  const tables = new Set();
  for (const fileName of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!fileName.endsWith(".sql")) continue;
    const contents = fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
    for (const match of contents.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)? (?:public\.)?([a-z_]+)/gi,
    )) {
      tables.add(match[1]);
    }
  }
  // Migration-tracking metadata, deliberately never reset between files.
  tables.delete("schema_migrations");
  return tables;
}

test("SHARED_DATABASE_MUTABLE_TABLES matches every table the migrations create", async () => {
  const { SHARED_DATABASE_MUTABLE_TABLES } =
    await import("../packages/test-support/src/database/harness.ts");
  const listed = new Set(SHARED_DATABASE_MUTABLE_TABLES);
  const actual = tablesCreatedByMigrations();

  const missing = [...actual].filter((table) => !listed.has(table));
  const stale = [...listed].filter((table) => !actual.has(table));

  assert.deepEqual(
    missing,
    [],
    `migrations create table(s) not in SHARED_DATABASE_MUTABLE_TABLES: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    stale,
    [],
    `SHARED_DATABASE_MUTABLE_TABLES lists table(s) no migration creates: ${stale.join(", ")}`,
  );
});
