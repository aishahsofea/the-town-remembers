/**
 * Browser-public configuration.
 *
 * Only `VITE_TTR_*` variables reach the bundle, and only the two named below
 * are read. A supplied `VITE_`-prefixed name that looks like a credential is a
 * hard failure rather than an ignored value, because the mistake to catch is a
 * secret being given a browser prefix, not a secret being read here.
 */

import { z } from "zod";

export const BROWSER_ENV_PREFIX = "VITE_TTR_" as const;

/** Kept in step with the server-side denylist in `runtime-config/shared`. */
const SECRET_VARIABLE_PATTERN =
  /SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|DATABASE_URL|JUDGE|SESSION|API_KEY|APIKEY|COOKIE|SIGNING/i;

const BROWSER_VARIABLE_PREFIX = "VITE_" as const;

export const BROWSER_ENVIRONMENTS = ["local", "development", "production"] as const;

export type BrowserEnvironment = (typeof BROWSER_ENVIRONMENTS)[number];

export class BrowserConfigurationError extends Error {
  readonly variables: readonly string[];
  readonly code: "forbidden_secret_name" | "invalid_value";

  constructor(
    code: "forbidden_secret_name" | "invalid_value",
    variables: readonly string[],
  ) {
    super(
      `Invalid browser-public configuration (${code}): ${[...variables].toSorted().join(", ")}`,
    );
    this.name = "BrowserConfigurationError";
    this.code = code;
    this.variables = variables;
  }
}

const BrowserConfigSchema = z.strictObject({
  VITE_TTR_ENV: z.enum(BROWSER_ENVIRONMENTS),
  VITE_TTR_BUILD_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
});

export interface BrowserConfig {
  readonly environment: BrowserEnvironment;
  readonly buildId: string;
}

export type BrowserEnvironmentRecord = Readonly<Record<string, string | undefined>>;

/**
 * Fails when any browser-exposed name looks like a credential, then reads the
 * two public values. Every other key is ignored, so a server variable present
 * in the same process cannot enter the bundle.
 */
export function loadBrowserConfig(source: BrowserEnvironmentRecord): BrowserConfig {
  const forbidden = Object.keys(source).filter(
    (name) =>
      name.startsWith(BROWSER_VARIABLE_PREFIX) && SECRET_VARIABLE_PATTERN.test(name),
  );
  if (forbidden.length > 0) {
    throw new BrowserConfigurationError("forbidden_secret_name", forbidden);
  }

  const parsed = BrowserConfigSchema.safeParse({
    VITE_TTR_ENV: source["VITE_TTR_ENV"],
    VITE_TTR_BUILD_ID: source["VITE_TTR_BUILD_ID"] ?? "unknown",
  });
  if (!parsed.success) {
    const variables = parsed.error.issues.map((issue) =>
      String(issue.path[0] ?? "<configuration>"),
    );
    throw new BrowserConfigurationError("invalid_value", variables);
  }

  return {
    environment: parsed.data.VITE_TTR_ENV,
    buildId: parsed.data.VITE_TTR_BUILD_ID,
  };
}
