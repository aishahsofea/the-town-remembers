import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * `DEFERRED_KEY_CONSTRAINTS` (packages/test-support/src/database/harness.ts)
 * is a hand-reviewed list of the cyclic foreign keys
 * `0009_deferred_keys.sql` adds, dropped once in the suite-owned database so
 * `resetSharedDatabase` has a linear delete order to work with. This checks
 * it against the real migration so a future constraint added there can't
 * silently reintroduce an FK cycle `resetSharedDatabase` has no way to
 * satisfy.
 */

const MIGRATION_PATH = path.resolve(
  import.meta.dirname,
  "../packages/database-admin/migrations/0009_deferred_keys.sql",
);

function constraintsInMigration() {
  const contents = fs.readFileSync(MIGRATION_PATH, "utf8");
  const pairs = [];
  for (const match of contents.matchAll(
    /ALTER TABLE public\.(\w+)\s+ADD CONSTRAINT (\w+)/g,
  )) {
    pairs.push(`${match[1]}.${match[2]}`);
  }
  return new Set(pairs);
}

test("DEFERRED_KEY_CONSTRAINTS matches every constraint 0009_deferred_keys.sql adds", async () => {
  const { DEFERRED_KEY_CONSTRAINTS } =
    await import("../packages/test-support/src/database/harness.ts");
  const listed = new Set(
    DEFERRED_KEY_CONSTRAINTS.map(({ table, constraint }) => `${table}.${constraint}`),
  );
  const actual = constraintsInMigration();

  const missing = [...actual].filter((pair) => !listed.has(pair));
  const stale = [...listed].filter((pair) => !actual.has(pair));

  assert.deepEqual(
    missing,
    [],
    `0009_deferred_keys.sql adds constraint(s) not in DEFERRED_KEY_CONSTRAINTS: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    stale,
    [],
    `DEFERRED_KEY_CONSTRAINTS lists constraint(s) 0009_deferred_keys.sql doesn't add: ${stale.join(", ")}`,
  );
});
