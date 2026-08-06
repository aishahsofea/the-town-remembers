import { describe, expect, it } from "vitest";

import { BrowserConfigurationError, loadBrowserConfig } from "./index.js";

function expectFailure(load: () => unknown): BrowserConfigurationError {
  try {
    load();
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserConfigurationError);
    return error as BrowserConfigurationError;
  }
  throw new Error("Expected the browser loader to fail closed");
}

describe("browser-public configuration", () => {
  it("reads the two public values", () => {
    expect(
      loadBrowserConfig({ VITE_TTR_ENV: "production", VITE_TTR_BUILD_ID: "a1b2c3d" }),
    ).toStrictEqual({ environment: "production", buildId: "a1b2c3d" });
  });

  it("defaults the build identity when the bundle was built without one", () => {
    expect(loadBrowserConfig({ VITE_TTR_ENV: "local" }).buildId).toBe("unknown");
  });

  it("fails closed on a missing environment", () => {
    expect(expectFailure(() => loadBrowserConfig({})).code).toBe("invalid_value");
  });

  it.each([
    "VITE_TTR_JUDGE_CODE",
    "VITE_APP_SECRET",
    "VITE_SESSION_TOKEN",
    "VITE_DATABASE_URL",
    "VITE_TTR_SIGNING_KEY",
    "VITE_TTR_API_KEY",
  ])("refuses to build when %s is browser-exposed", (name) => {
    const error = expectFailure(() =>
      loadBrowserConfig({ VITE_TTR_ENV: "local", [name]: "value" }),
    );
    expect(error.code).toBe("forbidden_secret_name");
    expect(error.variables).toContain(name);
  });

  it("never echoes the forbidden value", () => {
    const error = expectFailure(() =>
      loadBrowserConfig({ VITE_TTR_ENV: "local", VITE_APP_SECRET: "hunter2" }),
    );
    expect(error.message).not.toContain("hunter2");
  });

  it("ignores server variables present in the same process", () => {
    expect(
      loadBrowserConfig({
        VITE_TTR_ENV: "local",
        TTR_MIGRATION_DATABASE_URL: "postgresql://migration_admin:x@host/db",
        TTR_APP_ORIGIN: "https://town.example",
      }),
    ).toStrictEqual({ environment: "local", buildId: "unknown" });
  });

  it("does not fail on an unprefixed server secret it will never read", () => {
    expect(
      loadBrowserConfig({ VITE_TTR_ENV: "local", JUDGE_CODE: "secret" }).environment,
    ).toBe("local");
  });

  it("rejects an environment value outside the accepted enum", () => {
    expect(
      expectFailure(() => loadBrowserConfig({ VITE_TTR_ENV: "staging" })).code,
    ).toBe("invalid_value");
  });
});
