#!/usr/bin/env node

/**
 * Applies forward migrations with the operator credential.
 *
 * Application startup never migrates. Decision 005 separates
 * `migration_admin` from `app_runtime` precisely so a request path cannot
 * change the schema, and this command is the only place the operator
 * credential is used.
 *
 * `TTR_MIGRATION_DATABASE_URL` selects the target. Nothing here prints it.
 */

import process from "node:process";

import { applyLocalDefaults } from "./local-env.mjs";

async function main() {
  applyLocalDefaults();

  const { applyMigrations, createOperatorPool } =
    await import("@the-town-remembers/database-admin");

  const pool = createOperatorPool(process.env);
  try {
    const outcome = await applyMigrations(pool, { log: (line) => console.log(line) });
    if (outcome.applied.length === 0) {
      console.log(
        `Nothing to apply; ${outcome.alreadyApplied.length} migration(s) already recorded.`,
      );
    } else {
      console.log(`Applied ${outcome.applied.length} migration(s).`);
    }
  } finally {
    await pool.end();
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
