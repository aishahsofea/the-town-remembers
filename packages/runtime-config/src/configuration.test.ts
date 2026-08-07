import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadAmbientConfig } from "./ambient.js";
import { loadDeploymentConfig } from "./deployment.js";
import { DEFAULT_API_PORT, loadGameConfig } from "./game.js";
import { loadDatabaseConfig, readSslMode } from "./database.js";
import { loadOperatorConfig } from "./operator.js";
import { loadRecoveryConfig } from "./recovery.js";
import {
  AMBIENT_QUEUE,
  AMBIENT_WORKER_TIMING,
  DATABASE,
  PLAYER_API_TIMING,
} from "./reliability.js";
import { ConfigurationError, SECRET_VARIABLE_PATTERN } from "./shared.js";
import { DEFAULT_TEST_DB_PORT, DEFAULT_WEB_PORT, loadTestConfig } from "./test.js";

const PRODUCTION = {
  TTR_ENV: "production",
  TTR_BUILD_ID: "a1b2c3d",
  TTR_LOG_LEVEL: "warn",
  TTR_APP_ORIGIN: "https://town.example",
  TTR_AWS_REGION: "eu-west-1",
} as const;

function expectConfigurationError(load: () => unknown): ConfigurationError {
  try {
    load();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    return error as ConfigurationError;
  }
  throw new Error("Expected the loader to fail closed");
}

describe("game runtime configuration", () => {
  it("reads a complete production environment", () => {
    expect(loadGameConfig(PRODUCTION)).toStrictEqual({
      environment: "production",
      buildId: "a1b2c3d",
      logLevel: "warn",
      appOrigin: "https://town.example",
      apiPort: DEFAULT_API_PORT,
    });
  });

  it("defaults build identity and origin only for the local environment", () => {
    expect(loadGameConfig({ TTR_ENV: "local" })).toStrictEqual({
      environment: "local",
      buildId: "unknown",
      logLevel: "info",
      appOrigin: "http://localhost:5173",
      apiPort: DEFAULT_API_PORT,
    });
  });

  it("fails closed when a deployed environment omits its build identity", () => {
    const error = expectConfigurationError(() =>
      loadGameConfig({ ...PRODUCTION, TTR_BUILD_ID: undefined }),
    );
    expect(error.category).toBe("game-runtime");
    expect(error.issues).toStrictEqual([
      { variable: "TTR_BUILD_ID", category: "game-runtime", code: "missing" },
    ]);
  });

  it("fails closed when the environment name is absent", () => {
    const error = expectConfigurationError(() => loadGameConfig({}));
    expect(error.issues.map((issue) => issue.variable)).toContain("TTR_ENV");
  });

  it("reports every offending variable at once", () => {
    const error = expectConfigurationError(() =>
      loadGameConfig({ TTR_ENV: "production", TTR_LOG_LEVEL: "chatty" }),
    );
    expect(error.issues.map((issue) => issue.variable).toSorted()).toStrictEqual([
      "TTR_APP_ORIGIN",
      "TTR_BUILD_ID",
      "TTR_LOG_LEVEL",
    ]);
  });

  it("never echoes a submitted value in the failure", () => {
    const leaked = "postgresql://admin:hunter2@db.example:26257/defaultdb";
    const error = expectConfigurationError(() =>
      loadGameConfig({ ...PRODUCTION, TTR_APP_ORIGIN: leaked, TTR_LOG_LEVEL: leaked }),
    );
    expect(error.message).not.toContain("hunter2");
    expect(error.message).not.toContain(leaked);
    expect(JSON.stringify(error.issues)).not.toContain("hunter2");
  });

  it("distinguishes a malformed value from an absent one", () => {
    const error = expectConfigurationError(() =>
      loadGameConfig({ ...PRODUCTION, TTR_LOG_LEVEL: "chatty" }),
    );
    expect(error.issues).toStrictEqual([
      { variable: "TTR_LOG_LEVEL", category: "game-runtime", code: "invalid" },
    ]);
  });

  it("ignores unrelated variables present in the same process", () => {
    expect(
      loadGameConfig({ ...PRODUCTION, TTR_MIGRATION_DATABASE_URL: "postgresql://x" })
        .buildId,
    ).toBe("a1b2c3d");
  });
});

describe("worker and deployment configuration", () => {
  it("loads the ambient and recovery categories", () => {
    expect(loadAmbientConfig(PRODUCTION).environment).toBe("production");
    expect(loadRecoveryConfig(PRODUCTION).logLevel).toBe("warn");
  });

  it("labels a failure with the category that failed", () => {
    expect(expectConfigurationError(() => loadAmbientConfig({})).category).toBe(
      "ambient-runtime",
    );
    expect(expectConfigurationError(() => loadRecoveryConfig({})).category).toBe(
      "recovery-runtime",
    );
    expect(expectConfigurationError(() => loadDeploymentConfig({})).category).toBe(
      "deployment",
    );
  });

  it("accepts deployment placement with an optional account", () => {
    expect(loadDeploymentConfig(PRODUCTION)).toStrictEqual({
      environment: "production",
      buildId: "a1b2c3d",
      awsRegion: "eu-west-1",
      awsAccount: undefined,
    });
    expect(
      loadDeploymentConfig({ ...PRODUCTION, TTR_AWS_ACCOUNT: "123456789012" })
        .awsAccount,
    ).toBe("123456789012");
  });

  it("rejects a malformed account without echoing it", () => {
    const error = expectConfigurationError(() =>
      loadDeploymentConfig({ ...PRODUCTION, TTR_AWS_ACCOUNT: "not-an-account" }),
    );
    expect(error.message).not.toContain("not-an-account");
  });
});

describe("test harness configuration", () => {
  it("uses deterministic default ports and the pinned local database", () => {
    expect(loadTestConfig({})).toStrictEqual({
      apiPort: DEFAULT_API_PORT,
      webPort: DEFAULT_WEB_PORT,
      apiBaseUrl: `http://127.0.0.1:${DEFAULT_API_PORT}`,
      webBaseUrl: `http://127.0.0.1:${DEFAULT_WEB_PORT}`,
      testDatabasePort: DEFAULT_TEST_DB_PORT,
      testDatabaseUrl: `postgresql://root@127.0.0.1:${DEFAULT_TEST_DB_PORT}/defaultdb?sslmode=disable`,
    });
  });

  it("follows the configured port when no explicit URL is supplied", () => {
    expect(loadTestConfig({ TTR_TEST_DB_PORT: "26300" }).testDatabaseUrl).toContain(
      ":26300/",
    );
  });

  it("accepts an explicit remote disposable target", () => {
    expect(
      loadTestConfig({
        TTR_TEST_DATABASE_URL: "postgresql://tester@remote:26257/scratch",
      }).testDatabaseUrl,
    ).toBe("postgresql://tester@remote:26257/scratch");
  });

  it("rejects a port outside the valid range", () => {
    expect(
      expectConfigurationError(() => loadTestConfig({ TTR_API_PORT: "70000" }))
        .issues[0]?.variable,
    ).toBe("TTR_API_PORT");
  });
});

describe("database runtime configuration", () => {
  const PRODUCTION_DATABASE_URL =
    "postgresql://app_runtime:x@cluster.example:26257/town?sslmode=verify-full";

  it("reads a verified production credential", () => {
    expect(
      loadDatabaseConfig({
        TTR_ENV: "production",
        TTR_DATABASE_URL: PRODUCTION_DATABASE_URL,
      }),
    ).toStrictEqual({
      environment: "production",
      databaseUrl: PRODUCTION_DATABASE_URL,
    });
  });

  it.each(["development", "production"])(
    "refuses a %s credential that does not request verify-full",
    (environment) => {
      const error = expectConfigurationError(() =>
        loadDatabaseConfig({
          TTR_ENV: environment,
          TTR_DATABASE_URL:
            "postgresql://app_runtime:hunter2@cluster.example:26257/town?sslmode=require",
        }),
      );
      expect(error.category).toBe("database-runtime");
      expect(error.issues[0]?.variable).toBe("TTR_DATABASE_URL");
      expect(error.message).not.toContain("hunter2");
    },
  );

  it("permits the pinned insecure node only in a local environment", () => {
    expect(
      loadDatabaseConfig({
        TTR_ENV: "local",
        TTR_DATABASE_URL: "postgresql://root@127.0.0.1:26257/town?sslmode=disable",
      }).environment,
    ).toBe("local");
  });

  it("fails closed when the credential is absent", () => {
    expect(
      expectConfigurationError(() => loadDatabaseConfig({ TTR_ENV: "production" }))
        .issues[0],
    ).toStrictEqual({
      variable: "TTR_DATABASE_URL",
      category: "database-runtime",
      code: "missing",
    });
  });

  it("does not leak the runtime credential into the game category", () => {
    const runtime = loadGameConfig({
      ...PRODUCTION,
      TTR_DATABASE_URL: PRODUCTION_DATABASE_URL,
    });
    expect(JSON.stringify(runtime)).not.toContain("app_runtime");
  });

  it.each([
    ["postgresql://h/d", undefined],
    ["postgresql://h/d?sslmode=verify-full", "verify-full"],
    ["postgresql://h/d?application_name=a&sslmode=require", "require"],
    ["postgresql://h/d?sslmode=", ""],
    ["postgresql://h/d?bare&sslmode=require", "require"],
    ["postgresql://h/d?application_name=a", undefined],
  ])("reads sslmode from %s", (url, expected) => {
    expect(readSslMode(url)).toBe(expected);
  });
});

describe("operator configuration", () => {
  it("reads the migration credential only when explicitly supplied", () => {
    expect(
      loadOperatorConfig({
        TTR_MIGRATION_DATABASE_URL: "postgresql://migration_admin:x@localhost:26257/db",
      }).migrationDatabaseUrl,
    ).toBe("postgresql://migration_admin:x@localhost:26257/db");
  });

  it("fails closed and does not echo the credential", () => {
    const error = expectConfigurationError(() =>
      loadOperatorConfig({
        TTR_MIGRATION_DATABASE_URL: "mysql://admin:hunter2@host/db",
      }),
    );
    expect(error.category).toBe("operator");
    expect(error.message).not.toContain("hunter2");
  });

  it("is not reachable from a runtime category", () => {
    const runtime = loadGameConfig({
      ...PRODUCTION,
      TTR_MIGRATION_DATABASE_URL: "postgresql://migration_admin:x@host/db",
    });
    expect(JSON.stringify(runtime)).not.toContain("migration_admin");
  });
});

describe("secret-name policy", () => {
  it.each([
    "VITE_TTR_JUDGE_CODE",
    "VITE_APP_SECRET",
    "VITE_SESSION_TOKEN",
    "VITE_DATABASE_URL",
    "VITE_TTR_API_KEY",
  ])("treats %s as a credential name", (name) => {
    expect(SECRET_VARIABLE_PATTERN.test(name)).toBe(true);
  });

  it.each(["VITE_TTR_ENV", "VITE_TTR_BUILD_ID", "TTR_LOG_LEVEL"])(
    "treats %s as a public name",
    (name) => {
      expect(SECRET_VARIABLE_PATTERN.test(name)).toBe(false);
    },
  );
});

describe("accepted reliability parameters", () => {
  it("keeps the player claim longer than the worker that holds it", () => {
    expect(PLAYER_API_TIMING.processingClaimMs).toBeGreaterThan(
      PLAYER_API_TIMING.lambdaHardTimeoutMs,
    );
    expect(AMBIENT_WORKER_TIMING.processingClaimMs).toBeGreaterThan(
      AMBIENT_WORKER_TIMING.lambdaHardTimeoutMs,
    );
  });

  it("keeps queue visibility at least six times the worker timeout", () => {
    expect(AMBIENT_QUEUE.visibilityTimeoutSeconds * 1000).toBeGreaterThanOrEqual(
      6 * AMBIENT_WORKER_TIMING.lambdaHardTimeoutMs,
    );
  });

  it("reserves a commit window inside every application budget", () => {
    expect(PLAYER_API_TIMING.applicationBudgetMs).toBeLessThan(
      PLAYER_API_TIMING.lambdaHardTimeoutMs,
    );
    expect(PLAYER_API_TIMING.reservedCommitWindowMs).toBeLessThan(
      PLAYER_API_TIMING.applicationBudgetMs,
    );
    expect(AMBIENT_WORKER_TIMING.reservedCommitWindowMs).toBeLessThan(
      AMBIENT_WORKER_TIMING.applicationBudgetMs,
    );
  });

  it("records the accepted database retry schedule", () => {
    expect(DATABASE.serializationRetryDelaysMs).toStrictEqual([25, 75, 225]);
    expect(DATABASE.serializationRetryDelaysMs).toHaveLength(
      DATABASE.serializationRetryLimit,
    );
  });
});

describe(".env.example", () => {
  const example = readFileSync(
    fileURLToPath(new URL("../../../.env.example", import.meta.url)),
    "utf8",
  );

  it("documents every variable the loaders read", () => {
    for (const variable of [
      "TTR_ENV",
      "TTR_BUILD_ID",
      "TTR_LOG_LEVEL",
      "TTR_APP_ORIGIN",
      "TTR_AWS_REGION",
      "TTR_AWS_ACCOUNT",
      "TTR_API_PORT",
      "TTR_WEB_PORT",
      "TTR_TEST_DB_PORT",
      "TTR_DATABASE_URL",
      "VITE_TTR_ENV",
      "VITE_TTR_BUILD_ID",
      "TTR_MIGRATION_DATABASE_URL",
    ]) {
      expect(example).toContain(`${variable}=`);
    }
  });

  it("contains placeholders rather than usable credentials", () => {
    const assignments = example
      .split("\n")
      .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"));
    for (const assignment of assignments) {
      expect(assignment).not.toMatch(/=.*(hunter2|AKIA|-----BEGIN)/);
    }
    expect(example).toContain("placeholder@localhost");
  });
});
