import { defineConfig, devices } from "@playwright/test";

import { loadTestConfig } from "@the-town-remembers/runtime-config/test";

import { applyLocalDefaults } from "./scripts/local-env.mjs";

applyLocalDefaults();

/**
 * Ports come from configuration rather than literals so the API adapter, the
 * Vite proxy, and this journey cannot disagree about where the API listens.
 * Retries are disabled: a foundation gate that passes on a second attempt has
 * not proved the thing it claims to prove.
 */
const { apiPort, webPort, webBaseUrl } = loadTestConfig(process.env);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
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
