#!/usr/bin/env node

/**
 * Inspects the built browser bundle for anything that must never ship to a
 * player.
 *
 * The workspace boundary check already stops the web package from depending on
 * a server package, and its TypeScript project has no Node types. This checks
 * the artifact those rules are supposed to produce, because the thing a player
 * downloads is the only thing that actually matters.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_BUNDLE_DIRECTORY = "apps/web/dist";

/** Substrings that would mean a server concern reached the browser. */
const FORBIDDEN_SUBSTRINGS = [
  "TTR_MIGRATION_DATABASE_URL",
  "TTR_APP_ORIGIN",
  "postgresql://",
  "node:crypto",
  "node:child_process",
  "@the-town-remembers/runtime-config",
  "@the-town-remembers/serialization",
  "aws-lambda",
  "aws-cdk-lib",
];

/** Patterns for credential-shaped names, matched case-insensitively. */
const FORBIDDEN_PATTERNS = [
  /\bJUDGE_CODE\b/i,
  /\bSESSION_SECRET\b/i,
  /\bSIGNING_KEY\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

/** The only browser-public variable names the bundle may mention. */
const ALLOWED_PUBLIC_VARIABLES = ["VITE_TTR_ENV", "VITE_TTR_BUILD_ID"];

function collectBundleFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectBundleFiles(entryPath));
    else if (entry.isFile() && /\.(js|css|html)$/.test(entry.name))
      files.push(entryPath);
  }
  return files;
}

export function findBundleViolations(directory = DEFAULT_BUNDLE_DIRECTORY) {
  const files = collectBundleFiles(directory);
  if (files.length === 0) {
    return [{ code: "missing_bundle", path: directory, detail: "no built output" }];
  }

  const violations = [];
  for (const filePath of files) {
    const contents = fs.readFileSync(filePath, "utf8");

    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      if (contents.includes(forbidden)) {
        violations.push({ code: "server_concern", path: filePath, detail: forbidden });
      }
    }

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(contents)) {
        // The match itself is never reported: printing it would move the value
        // into the log this check exists to keep clean.
        violations.push({
          code: "credential_shaped",
          path: filePath,
          detail: String(pattern),
        });
      }
    }

    for (const match of contents.matchAll(/\bVITE_[A-Z0-9_]+\b/g)) {
      if (!ALLOWED_PUBLIC_VARIABLES.includes(match[0])) {
        violations.push({
          code: "unexpected_public_variable",
          path: filePath,
          detail: match[0],
        });
      }
    }
  }

  return violations;
}

function runCli() {
  const directory = process.argv[2] ?? DEFAULT_BUNDLE_DIRECTORY;
  const violations = findBundleViolations(directory);

  if (violations.length === 0) {
    console.log("Browser bundle carries no server concern.");
    return;
  }

  console.error(`Browser bundle failed ${violations.length} safety check(s):`);
  for (const violation of violations) {
    console.error(`- [${violation.code}] ${violation.detail} (${violation.path})`);
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
