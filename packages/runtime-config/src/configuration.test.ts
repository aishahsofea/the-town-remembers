import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadAmbientConfig } from "./ambient.js";
import { loadDeploymentConfig } from "./deployment.js";
import { DEFAULT_API_PORT, loadGameConfig } from "./game.js";
import { loadDatabaseConfig, readSslMode } from "./database.js";
import { loadModelConfig } from "./model.js";
import { loadOperatorConfig } from "./operator.js";
import { loadRecoveryConfig } from "./recovery.js";
import {
  AMBIENT_QUEUE,
  AMBIENT_WORKER_TIMING,
  DATABASE,
  PLAYER_API_TIMING,
} from "./reliability.js";
import { loadSecurityConfig } from "./security.js";
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
      enableNpcMutations: false,
    });
  });

  it("defaults build identity and origin only for the local environment", () => {
    expect(loadGameConfig({ TTR_ENV: "local" })).toStrictEqual({
      environment: "local",
      buildId: "unknown",
      logLevel: "info",
      appOrigin: "http://localhost:5173",
      apiPort: DEFAULT_API_PORT,
      enableNpcMutations: false,
    });
  });

  it("enables NPC mutations only when TTR_ENABLE_NPC_MUTATIONS is exactly '1'", () => {
    expect(
      loadGameConfig({ TTR_ENV: "local", TTR_ENABLE_NPC_MUTATIONS: "1" })
        .enableNpcMutations,
    ).toBe(true);
    expect(
      loadGameConfig({ TTR_ENV: "local", TTR_ENABLE_NPC_MUTATIONS: "0" })
        .enableNpcMutations,
    ).toBe(false);
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

describe("security configuration", () => {
  const KEY_V1 = "ellozwDF6MjC9aIaV_C3JAm1N0itqbhqINMe21ZurOc";
  const KEY_V2 = "caKGzXEXbrucEppOwWFRCTlJ-1Q0xvy4F65g2pmFIZQ";
  const PEPPER = "0S_sHeUl8wqdysN8AM7JK6SHbjlnkCoCYgeWplF8k8E";
  const IP_HASH_SECRET = "ChUALDNE4I_6Qy0vPTPKExGWmvrACeAmwxbQxUUfLi4";
  const VALID = {
    TTR_JUDGE_CODE: "a-16-char-minimum-code",
    TTR_INVITE_SIGNING_KEYS: `v1:${KEY_V1}`,
    TTR_SESSION_TOKEN_PEPPER: PEPPER,
    TTR_IP_HASH_SECRET: IP_HASH_SECRET,
  };

  it("reads a complete security environment", () => {
    const config = loadSecurityConfig(VALID);
    expect(config.judgeCode).toBe(VALID.TTR_JUDGE_CODE);
    expect(config.sessionTokenPepper).toBe(PEPPER);
    expect(config.ipHashSecret).toBe(IP_HASH_SECRET);
    expect(config.inviteSigningKeys).toHaveLength(1);
    expect(config.inviteSigningKeys[0]?.version).toBe("v1");
    expect(Buffer.from(config.inviteSigningKeys[0]!.key).toString("base64url")).toBe(
      KEY_V1,
    );
  });

  it("keeps the first signing-key entry active and every entry decodable", () => {
    const config = loadSecurityConfig({
      ...VALID,
      TTR_INVITE_SIGNING_KEYS: `v2:${KEY_V2},v1:${KEY_V1}`,
    });
    expect(config.inviteSigningKeys.map((entry) => entry.version)).toStrictEqual([
      "v2",
      "v1",
    ]);
  });

  it("fails closed when a variable is absent", () => {
    const error = expectConfigurationError(() =>
      loadSecurityConfig({ ...VALID, TTR_JUDGE_CODE: undefined }),
    );
    expect(error.category).toBe("security-runtime");
    expect(error.issues).toStrictEqual([
      { variable: "TTR_JUDGE_CODE", category: "security-runtime", code: "missing" },
    ]);
  });

  it("rejects a judge code shorter than 16 characters", () => {
    expect(
      expectConfigurationError(() =>
        loadSecurityConfig({ ...VALID, TTR_JUDGE_CODE: "too-short" }),
      ).issues[0],
    ).toStrictEqual({
      variable: "TTR_JUDGE_CODE",
      category: "security-runtime",
      code: "invalid",
    });
  });

  it.each([
    ["missing version prefix", KEY_V1],
    ["malformed version", `1:${KEY_V1}`],
    ["wrong byte length", "v1:tooshort"],
    ["duplicate versions", `v1:${KEY_V1},v1:${KEY_V2}`],
    ["empty entry", `v1:${KEY_V1},`],
  ])("rejects invite signing keys with %s", (_label, value) => {
    const error = expectConfigurationError(() =>
      loadSecurityConfig({ ...VALID, TTR_INVITE_SIGNING_KEYS: value }),
    );
    expect(error.issues[0]?.variable).toBe("TTR_INVITE_SIGNING_KEYS");
  });

  it("rejects a pepper or IP-hash secret that is not 256 bits of base64url", () => {
    expect(
      expectConfigurationError(() =>
        loadSecurityConfig({ ...VALID, TTR_SESSION_TOKEN_PEPPER: "short" }),
      ).issues[0]?.variable,
    ).toBe("TTR_SESSION_TOKEN_PEPPER");
    expect(
      expectConfigurationError(() =>
        loadSecurityConfig({ ...VALID, TTR_IP_HASH_SECRET: "short" }),
      ).issues[0]?.variable,
    ).toBe("TTR_IP_HASH_SECRET");
  });

  it("never echoes a submitted value in the failure", () => {
    const leaked = "hunter2-leak";
    const error = expectConfigurationError(() =>
      loadSecurityConfig({ ...VALID, TTR_JUDGE_CODE: leaked }),
    );
    expect(error.message).not.toContain(leaked);
    expect(JSON.stringify(error.issues)).not.toContain(leaked);
  });

  it("matches every variable name against the secret-name policy", () => {
    for (const variable of [
      "TTR_JUDGE_CODE",
      "TTR_INVITE_SIGNING_KEYS",
      "TTR_SESSION_TOKEN_PEPPER",
      "TTR_IP_HASH_SECRET",
    ]) {
      expect(SECRET_VARIABLE_PATTERN.test(`VITE_${variable}`)).toBe(true);
    }
  });
});

describe("model-runtime configuration", () => {
  const VALID = {
    TTR_AWS_REGION: "us-east-1",
    TTR_BEDROCK_HAIKU_MODEL_ID: "anthropic.claude-haiku-4-5-20251001-v1:0",
    TTR_BEDROCK_SONNET_MODEL_ID: "anthropic.claude-sonnet-5-20260101-v1:0",
    TTR_BEDROCK_TITAN_MODEL_ID: "amazon.titan-embed-text-v2:0",
    TTR_MODEL_PRICE_CATALOG_VERSION: "bedrock-prices/2026-08-01",
  };

  it("reads a complete environment with no inference profile configured", () => {
    expect(loadModelConfig(VALID)).toStrictEqual({
      region: "us-east-1",
      haikuModelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
      sonnetModelId: "anthropic.claude-sonnet-5-20260101-v1:0",
      titanModelId: "amazon.titan-embed-text-v2:0",
      haikuInferenceProfileArn: undefined,
      sonnetInferenceProfileArn: undefined,
      priceCatalogVersion: "bedrock-prices/2026-08-01",
      reducedCostOverride: false,
      liveTestsEnabled: false,
    });
  });

  it("reads optional inference profile ARNs and the two opt-in flags", () => {
    const config = loadModelConfig({
      ...VALID,
      TTR_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN:
        "arn:aws:bedrock:us-east-1:1:profile/haiku",
      TTR_BEDROCK_SONNET_INFERENCE_PROFILE_ARN:
        "arn:aws:bedrock:us-east-1:1:profile/sonnet",
      TTR_MODEL_REDUCED_COST_OVERRIDE: "1",
      TTR_MODEL_LIVE_TESTS: "1",
    });
    expect(config.haikuInferenceProfileArn).toBe(
      "arn:aws:bedrock:us-east-1:1:profile/haiku",
    );
    expect(config.sonnetInferenceProfileArn).toBe(
      "arn:aws:bedrock:us-east-1:1:profile/sonnet",
    );
    expect(config.reducedCostOverride).toBe(true);
    expect(config.liveTestsEnabled).toBe(true);
  });

  it("fails closed when a required variable is absent", () => {
    const error = expectConfigurationError(() =>
      loadModelConfig({ ...VALID, TTR_BEDROCK_SONNET_MODEL_ID: undefined }),
    );
    expect(error.category).toBe("model-runtime");
    expect(error.issues).toStrictEqual([
      {
        variable: "TTR_BEDROCK_SONNET_MODEL_ID",
        category: "model-runtime",
        code: "missing",
      },
    ]);
  });

  it.each(["TTR_MODEL_REDUCED_COST_OVERRIDE", "TTR_MODEL_LIVE_TESTS"])(
    "rejects a non-flag value for %s",
    (variable) => {
      const error = expectConfigurationError(() =>
        loadModelConfig({ ...VALID, [variable]: "yes" }),
      );
      expect(error.issues[0]?.variable).toBe(variable);
    },
  );

  it("carries no AWS access key or secret in its shape", () => {
    expect(Object.keys(loadModelConfig(VALID))).not.toContain("accessKeyId");
    expect(Object.keys(loadModelConfig(VALID))).not.toContain("secretAccessKey");
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
      "TTR_JUDGE_CODE",
      "TTR_INVITE_SIGNING_KEYS",
      "TTR_SESSION_TOKEN_PEPPER",
      "TTR_IP_HASH_SECRET",
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
