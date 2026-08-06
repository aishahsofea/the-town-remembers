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
            "packages/runtime-config/src/**/*.test.ts",
            "packages/browser-config/src/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "runtime-shells",
          environment: "node",
          include: ["apps/{game-api,ambient-worker,recovery-worker}/src/**/*.test.ts"],
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
