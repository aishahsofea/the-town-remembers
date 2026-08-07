/**
 * Local test-harness configuration.
 *
 * Ports are configuration rather than literals so the browser journey, the
 * Vite proxy, and the local API adapter cannot disagree about where the API
 * listens.
 */

import { z } from "zod";

import { DEFAULT_API_PORT } from "./game.js";
import {
  PortSchema,
  parseEnvironment,
  withDefault,
  type EnvironmentRecord,
} from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";

export { DEFAULT_API_PORT } from "./game.js";
export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_TEST_DB_PORT = 26257;

/**
 * The disposable target the database suite migrates, seeds, and drops. It
 * defaults to the pinned local node so a clean checkout needs no variable, but
 * it stays overridable: the phase plan accepts a remote disposable database as
 * long as its credential is isolated from the runtime and operator categories.
 */
function defaultTestDatabaseUrl(port: number): string {
  return `postgresql://root@127.0.0.1:${port}/defaultdb?sslmode=disable`;
}

const TestConfigSchema = z.strictObject({
  TTR_API_PORT: PortSchema,
  TTR_WEB_PORT: PortSchema,
  TTR_TEST_DB_PORT: PortSchema,
  TTR_TEST_DATABASE_URL: z
    .string()
    .refine((value) => value.startsWith("postgresql://"), "must be a PostgreSQL URL"),
});

export interface TestConfig {
  readonly apiPort: number;
  readonly webPort: number;
  readonly apiBaseUrl: string;
  readonly webBaseUrl: string;
  readonly testDatabasePort: number;
  /** Administrative DSN for the disposable target; never a production cluster. */
  readonly testDatabaseUrl: string;
}

export function loadTestConfig(source: EnvironmentRecord): TestConfig {
  const testDatabasePort = withDefault(
    source,
    "TTR_TEST_DB_PORT",
    String(DEFAULT_TEST_DB_PORT),
  );

  const parsed = parseEnvironment(
    "test",
    TestConfigSchema,
    {
      TTR_API_PORT: withDefault(source, "TTR_API_PORT", String(DEFAULT_API_PORT)),
      TTR_WEB_PORT: withDefault(source, "TTR_WEB_PORT", String(DEFAULT_WEB_PORT)),
      TTR_TEST_DB_PORT: testDatabasePort,
      TTR_TEST_DATABASE_URL: withDefault(
        source,
        "TTR_TEST_DATABASE_URL",
        defaultTestDatabaseUrl(Number(testDatabasePort)),
      ),
    },
    source,
  );

  return {
    apiPort: parsed.TTR_API_PORT,
    webPort: parsed.TTR_WEB_PORT,
    apiBaseUrl: `http://127.0.0.1:${parsed.TTR_API_PORT}`,
    webBaseUrl: `http://127.0.0.1:${parsed.TTR_WEB_PORT}`,
    testDatabasePort: parsed.TTR_TEST_DB_PORT,
    testDatabaseUrl: parsed.TTR_TEST_DATABASE_URL,
  };
}
