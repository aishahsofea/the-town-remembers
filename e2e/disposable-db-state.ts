/**
 * Shared state for the one disposable database `playwright.config.ts`
 * creates for the whole `phase-03-first-playable` journey (`P3-19`).
 *
 * The database itself is created in `playwright.config.ts`'s own
 * module-level top-level `await`, not by a Playwright `globalSetup` hook —
 * see that file's own comment for why (`webServer` plugin setup runs
 * *before* `globalSetup`, so a `globalSetup`-mutated `TTR_DATABASE_URL`
 * would always be one step too late to reach the server `webServer`
 * spawns). This file exists only so `playwright.config.ts`,
 * `global-teardown.ts`, and `phase-03-first-playable.spec.ts` agree on
 * where the disposable database's identity is written and how to read it
 * back, without importing from the config file itself.
 */

import os from "node:os";
import path from "node:path";

import type { DbSuiteLockRecord } from "../scripts/db-suite-lock.d.mts";

export const DISPOSABLE_DB_STATE_FILE = path.join(
  os.tmpdir(),
  "ttr-e2e-disposable-db.json",
);

export interface DisposableDbState {
  readonly name: string;
  /** Administrative DSN pointing at the disposable database. */
  readonly adminUrl: string;
  /** The db-suite-lock.mjs record held for this journey, released in global-teardown.ts. */
  readonly lock?: DbSuiteLockRecord;
}
