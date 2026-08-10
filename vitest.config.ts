import { defineConfig } from "vitest/config";

/**
 * Test projects mirror the verification matrix in the Phase 0 plan: executable
 * contracts, configuration boundaries, and runtime shells are separate
 * concerns and fail separately. The browser project lives in `apps/web` so it
 * resolves its own React and DOM tooling.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "contracts",
          environment: "node",
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
          include: ["packages/rules/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "database",
          environment: "node",
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
          include: ["packages/game-server/src/**/*.test.ts"],
          exclude: ["packages/game-server/src/**/*.db.test.ts"],
        },
      },
      {
        test: {
          name: "runtime-shells",
          environment: "node",
          include: [
            "apps/{game-api,ambient-worker,recovery-worker}/src/**/*.test.ts",
            "infrastructure/src/**/*.test.ts",
          ],
        },
      },
      "apps/web",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "packages/test-support/**"],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
