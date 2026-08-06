#!/usr/bin/env node

/**
 * Applies the committed local defaults in `.env.defaults`, then any values in
 * a developer's ignored `.env`.
 *
 * Only repository tooling calls this. The runtime configuration loaders never
 * read a file, so a deployed Lambda whose variables are missing still fails
 * closed rather than inheriting a local default.
 *
 * An existing environment value always wins, so CI and CDK stay authoritative.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Ordered from lowest to highest precedence. */
const ENV_FILES = [".env.defaults", ".env"];

export function parseEnvFile(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (name !== "") values[name] = value;
  }
  return values;
}

/** Returns the merged defaults without mutating anything. */
export function readLocalDefaults(rootDir = REPOSITORY_ROOT) {
  const merged = {};
  for (const fileName of ENV_FILES) {
    const filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    Object.assign(merged, parseEnvFile(fs.readFileSync(filePath, "utf8")));
  }
  return merged;
}

/** Fills only the variables the caller has not already set. */
export function applyLocalDefaults(env = process.env, rootDir = REPOSITORY_ROOT) {
  for (const [name, value] of Object.entries(readLocalDefaults(rootDir))) {
    if (env[name] === undefined || env[name] === "") env[name] = value;
  }
  return env;
}
