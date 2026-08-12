import { readFileSync, writeFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { loadTestConfig } from "@the-town-remembers/runtime-config/test";
import {
  createDisposableDatabase,
  withUser,
} from "@the-town-remembers/test-support/database";

import { applyLocalDefaults } from "./scripts/local-env.mjs";
import {
  DISPOSABLE_DB_STATE_FILE,
  type DisposableDbState,
} from "./e2e/disposable-db-state.js";
import { E2E_SECURITY_ENV } from "./e2e/security-fixtures.js";

applyLocalDefaults();

/**
 * Ports come from configuration rather than literals so the API adapter, the
 * Vite proxy, and this journey cannot disagree about where the API listens.
 * Retries are disabled: a foundation gate that passes on a second attempt has
 * not proved the thing it claims to prove.
 */
const { apiPort, webPort, webBaseUrl } = loadTestConfig(process.env);

/**
 * `P3-19`'s `phase-03-first-playable` journey needs a real disposable
 * database the API server actually writes to, not the shared local dev
 * database `.env` points at — created here, at config-evaluation time,
 * rather than in a `globalSetup` file: Playwright's own runner starts every
 * configured `webServer` as a "plugin setup" step that runs *before* the
 * user's `globalSetup` (confirmed by reading
 * `playwright/lib/runner/index.js#createGlobalSetupTasks`, which orders
 * plugin setup ahead of `config2.globalSetups`), so a `TTR_DATABASE_URL`
 * mutation made from `globalSetup` would always be one step too late to
 * reach the server this config's own `webServer` entry spawns. Read at
 * config-load time instead, it can go straight into that entry's own `env`.
 *
 * The database's identity is also written to a fixed OS-temp path so
 * `e2e/global-teardown.ts` (which *does* run at the right time — after
 * every test and every `webServer` have both finished) can drop it, and so
 * `phase-03-first-playable.spec.ts` can open its own connection for the
 * verification queries `P3-19` acceptance 2 needs.
 *
 * This module also gets re-required inside every Playwright *worker*
 * process (each test worker needs its own copy of `use`/`projects`), which
 * would otherwise re-run this same top-level `await` and create a second,
 * never-seeded, empty disposable database — clobbering the state file the
 * *webServer-spawning* process (which has no `TEST_WORKER_INDEX`) already
 * wrote, and leaving the spec reading a database the running server never
 * touched. Only that first, worker-less evaluation actually creates one;
 * every worker just reads the same file back.
 */
const isWorkerProcess = process.env["TEST_WORKER_INDEX"] !== undefined;

const disposableDbState: DisposableDbState = isWorkerProcess
  ? (JSON.parse(readFileSync(DISPOSABLE_DB_STATE_FILE, "utf8")) as DisposableDbState)
  : await (async () => {
      const disposableDb = await createDisposableDatabase();
      const state: DisposableDbState = {
        name: disposableDb.name,
        adminUrl: disposableDb.url,
      };
      writeFileSync(DISPOSABLE_DB_STATE_FILE, JSON.stringify(state), "utf8");
      await disposableDb.pool.end();
      return state;
    })();

const disposableDbAppRuntimeUrl = withUser(disposableDbState.adminUrl, "app_runtime");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalTeardown: "./e2e/global-teardown.ts",
  forbidOnly: Boolean(process.env["CI"]),
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node scripts/dev.mjs --api-only",
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        // The journey's own throwaway secrets rather than whatever a
        // developer's ignored `.env` happens to hold — CI has no `.env` at
        // all, and `loadSecurityConfig` fails closed, so without these the
        // server never starts there.
        ...E2E_SECURITY_ENV,
        TTR_DATABASE_URL: disposableDbAppRuntimeUrl,
        // A real browser navigating to `webBaseUrl` presents that exact
        // origin on every same-origin request; `requireExactOrigin` does a
        // literal string comparison, so this must match `webBaseUrl`
        // exactly (`http://127.0.0.1:{port}`) rather than `.env`'s
        // committed `http://localhost:5173` default.
        TTR_APP_ORIGIN: webBaseUrl,
      },
    },
    {
      command: `node apps/web/node_modules/vite/bin/vite.js --config apps/web/vite.config.ts --port ${webPort} --strictPort`,
      url: webBaseUrl,
      reuseExistingServer: !process.env["CI"],
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
