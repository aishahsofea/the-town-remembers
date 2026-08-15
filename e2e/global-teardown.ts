/**
 * Drops the disposable database `playwright.config.ts` created, after every
 * test and the `webServer` it fed have both finished with it.
 *
 * Reconnects independently rather than reusing anything from that config
 * module (its own pool is already closed by the time this runs) — the only
 * thing carried across is the database's name, read back from the same
 * OS-temp path (`disposable-db-state.ts`), and validated by
 * `assertDisposableName` before it can reach a `DROP DATABASE` statement
 * (`P3-19`'s own module list: "cleanup that reuses `DISPOSABLE_NAME_PATTERN`,
 * so it cannot target a non-disposable database").
 */

import { readFileSync, rmSync } from "node:fs";

import { loadTestConfig } from "@the-town-remembers/runtime-config/test";
import { assertDisposableName } from "@the-town-remembers/test-support/database";
import { Pool } from "pg";

import { release } from "../scripts/db-suite-lock.mjs";
import { applyLocalDefaults } from "../scripts/local-env.mjs";
import {
  DISPOSABLE_DB_STATE_FILE,
  type DisposableDbState,
} from "./disposable-db-state.js";

export default async function globalTeardown(): Promise<void> {
  applyLocalDefaults();

  const state = JSON.parse(
    readFileSync(DISPOSABLE_DB_STATE_FILE, "utf8"),
  ) as DisposableDbState;
  assertDisposableName(state.name);

  const { testDatabaseUrl } = loadTestConfig(process.env);
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    await pool.query(`DROP DATABASE IF EXISTS ${state.name} CASCADE`);
  } finally {
    await pool.end();
    if (state.lock !== undefined) release(state.lock);
  }

  rmSync(DISPOSABLE_DB_STATE_FILE, { force: true });
}
