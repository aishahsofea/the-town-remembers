/**
 * Fail-closed environment parsing shared by every configuration category.
 *
 * A configuration failure names the category and the offending variables. It
 * never contains a value, or a substring of a value, because these loaders run
 * where the only observable output is a log line.
 */

import { z } from "zod";

export const CONFIGURATION_CATEGORIES = [
  "browser-public",
  "game-runtime",
  "ambient-runtime",
  "recovery-runtime",
  "database-runtime",
  "deployment",
  "test",
  "operator",
] as const;

export type ConfigurationCategory = (typeof CONFIGURATION_CATEGORIES)[number];

export type ConfigurationIssueCode = "missing" | "invalid" | "forbidden";

export interface ConfigurationIssue {
  readonly variable: string;
  readonly category: ConfigurationCategory;
  readonly code: ConfigurationIssueCode;
}

export class ConfigurationError extends Error {
  readonly category: ConfigurationCategory;
  readonly issues: readonly ConfigurationIssue[];

  constructor(category: ConfigurationCategory, issues: readonly ConfigurationIssue[]) {
    const summary = issues
      .map((issue) => `${issue.variable} (${issue.code})`)
      .toSorted()
      .join(", ");
    super(`Invalid ${category} configuration: ${summary}`);
    this.name = "ConfigurationError";
    this.category = category;
    this.issues = issues;
  }
}

export type EnvironmentRecord = Readonly<Record<string, string | undefined>>;

export const DEPLOYMENT_ENVIRONMENTS = ["local", "development", "production"] as const;

export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * Names that must never reach browser-public configuration. The pattern is
 * matched against the variable name, so a secret cannot be exposed merely by
 * being given a build-time prefix.
 */
export const SECRET_VARIABLE_PATTERN =
  /SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|DATABASE_URL|JUDGE|SESSION|API_KEY|APIKEY|COOKIE|SIGNING/i;

export const DeploymentEnvironmentSchema = z.enum(DEPLOYMENT_ENVIRONMENTS);
export const LogLevelSchema = z.enum(LOG_LEVELS);
export const BuildIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
export const OriginSchema = z.url();
export const PortSchema = z.coerce.number().int().min(1).max(65535);

/**
 * Parses one environment record against a schema and converts every failure
 * into a value-free issue. A variable that was absent reports `missing`;
 * anything else reports `invalid`.
 */
export function parseEnvironment<T>(
  category: ConfigurationCategory,
  schema: z.ZodType<T>,
  candidate: Record<string, unknown>,
  source: EnvironmentRecord,
): T {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((issue) => {
    const variable = String(issue.path[0] ?? "<configuration>");
    const code: ConfigurationIssueCode =
      source[variable] === undefined ? "missing" : "invalid";
    return { variable, category, code };
  });
  throw new ConfigurationError(category, issues);
}

/** Reads one variable, falling back only when the environment is `local`. */
export function withLocalDefault(
  source: EnvironmentRecord,
  variable: string,
  localDefault: string,
): string | undefined {
  const value = source[variable];
  if (value !== undefined && value !== "") return value;
  return source["TTR_ENV"] === "local" ? localDefault : undefined;
}

/** Reads one variable, falling back in every environment. */
export function withDefault(
  source: EnvironmentRecord,
  variable: string,
  fallback: string,
): string {
  const value = source[variable];
  return value === undefined || value === "" ? fallback : value;
}

/** Reads one variable without a fallback, normalizing empty to absent. */
export function required(
  source: EnvironmentRecord,
  variable: string,
): string | undefined {
  const value = source[variable];
  return value === undefined || value === "" ? undefined : value;
}
