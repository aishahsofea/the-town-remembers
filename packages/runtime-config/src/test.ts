/**
 * Local test-harness configuration.
 *
 * Ports are configuration rather than literals so the browser journey, the
 * Vite proxy, and the local API adapter cannot disagree about where the API
 * listens.
 */

import { z } from "zod";

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

export const DEFAULT_API_PORT = 5174;
export const DEFAULT_WEB_PORT = 5173;

const TestConfigSchema = z.strictObject({
  TTR_E2E_API_PORT: PortSchema,
  TTR_E2E_WEB_PORT: PortSchema,
});

export interface TestConfig {
  readonly apiPort: number;
  readonly webPort: number;
  readonly apiBaseUrl: string;
  readonly webBaseUrl: string;
}

export function loadTestConfig(source: EnvironmentRecord): TestConfig {
  const parsed = parseEnvironment(
    "test",
    TestConfigSchema,
    {
      TTR_E2E_API_PORT: withDefault(
        source,
        "TTR_E2E_API_PORT",
        String(DEFAULT_API_PORT),
      ),
      TTR_E2E_WEB_PORT: withDefault(
        source,
        "TTR_E2E_WEB_PORT",
        String(DEFAULT_WEB_PORT),
      ),
    },
    source,
  );

  return {
    apiPort: parsed.TTR_E2E_API_PORT,
    webPort: parsed.TTR_E2E_WEB_PORT,
    apiBaseUrl: `http://127.0.0.1:${parsed.TTR_E2E_API_PORT}`,
    webBaseUrl: `http://127.0.0.1:${parsed.TTR_E2E_WEB_PORT}`,
  };
}
