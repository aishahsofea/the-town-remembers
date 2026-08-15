import process from "node:process";

import { defineConfig, type TestProjectConfiguration } from "vitest/config";

/**
 * Test projects mirror the verification matrix in the Phase 0 plan: executable
 * contracts, configuration boundaries, and runtime shells are separate
 * concerns and fail separately. The browser project lives in `apps/web` so it
 * resolves its own React and DOM tooling.
 *
 * Every project below (except `model-live`) gets
 * `scripts/vitest-network-trap.mjs` as a `setupFiles` entry (`D4-U`, `P4-06`
 * acceptance 2): it blocks any non-loopback `fetch()`, so `pnpm test` cannot
 * silently make a real network call. `model-live` is the one deliberate
 * exception — it needs real network access to Bedrock.
 */
const NETWORK_TRAP = "./scripts/vitest-network-trap.mjs";

const projects: TestProjectConfiguration[] = [
  {
    test: {
      name: "contracts",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      include: [
        "packages/http-contracts/src/**/*.test.ts",
        "packages/model-contracts/src/**/*.test.ts",
        "packages/serialization/src/**/*.test.ts",
      ],
    },
  },
  {
    test: {
      name: "config",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      include: [
        "packages/content/src/**/*.test.ts",
        "packages/runtime-config/src/**/*.test.ts",
        "packages/browser-config/src/**/*.test.ts",
      ],
    },
  },
  {
    test: {
      name: "rules",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      include: ["packages/rules/src/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "model-runtime",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      include: ["packages/model-runtime/src/**/*.test.ts"],
      exclude: ["packages/model-runtime/src/**/*.live.test.ts"],
    },
  },
  {
    test: {
      name: "database",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      globalSetup: ["./scripts/vitest-database-setup.mjs"],
      // One file at a time. Each file migrates its own disposable
      // database, CockroachDB serializes schema changes anyway, and a
      // single local node under six concurrent migration runs turns a
      // fast suite into a timeout.
      fileParallelism: false,
      include: [
        "packages/database/src/**/*.test.ts",
        "packages/database-admin/src/**/*.test.ts",
        "packages/town-seed/src/**/*.test.ts",
        "packages/game-server/src/**/*.db.test.ts",
      ],
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  },
  {
    test: {
      name: "api",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      include: ["packages/game-server/src/**/*.test.ts"],
      exclude: ["packages/game-server/src/**/*.db.test.ts"],
    },
  },
  {
    test: {
      name: "runtime-shells",
      environment: "node",
      setupFiles: [NETWORK_TRAP],
      include: [
        "apps/{game-api,ambient-worker,recovery-worker}/src/**/*.test.ts",
        "infrastructure/src/**/*.test.ts",
      ],
    },
  },
  "apps/web",
];

// Opt-in only (`D4-U`): absent from `projects` — and so absent from `pnpm
// test` — unless the same flag its own tests gate on is already set. No
// network trap here; this project's whole purpose is a real Bedrock call.
if (process.env["TTR_MODEL_LIVE_TESTS"] === "1") {
  projects.push({
    test: {
      name: "model-live",
      environment: "node",
      globalSetup: ["./scripts/vitest-model-live-setup.mjs"],
      include: ["packages/model-runtime/src/**/*.live.test.ts"],
      testTimeout: 30_000,
    },
  });
}

export default defineConfig({
  test: {
    projects,
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "packages/test-support/**"],
      thresholds: {
        // Coverage is a regression floor, not an incentive to add assertions
        // that merely execute implementation branches. Behavioural,
        // integration, security, and browser tests remain mandatory in the
        // aggregate gate; these thresholds catch material coverage loss while
        // leaving room to prefer meaningful scenarios over line chasing.
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
