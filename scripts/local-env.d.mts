/** Types for the plain-JavaScript local environment loader. */

export declare const REPOSITORY_ROOT: string;

export declare function parseEnvFile(contents: string): Record<string, string>;

export declare function readLocalDefaults(rootDir?: string): Record<string, string>;

export declare function applyLocalDefaults(
  env?: Record<string, string | undefined>,
  rootDir?: string,
): Record<string, string | undefined>;
