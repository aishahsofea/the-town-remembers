#!/usr/bin/env node

/**
 * Refuses to publish a diagnostic bundle that could carry a secret.
 *
 * CI runs this before uploading test output. It fails the publication rather
 * than uploading an unreviewed bundle, which is the accepted fallback in the
 * Phase 0 risk table. It runs today, before any credential exists, so the
 * check is already in place when one does.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** File names that must never appear inside an uploaded artifact. */
const FORBIDDEN_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\.(?!example$|defaults$).+/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /^id_(rsa|ed25519)$/,
  /credentials$/,
];

/** Content markers that indicate a credential leaked into a report. */
const FORBIDDEN_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /postgresql:\/\/[^\s"']*:[^\s"'@]+@/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
];

/** Extensions worth scanning for content. Binaries are checked by name only. */
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".json",
  ".md",
  ".html",
  ".xml",
  ".log",
  ".yml",
  ".yaml",
]);

const MAXIMUM_SCANNED_BYTES = 2 * 1024 * 1024;

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

export function findArtifactViolations(directories) {
  const violations = [];

  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;

    for (const filePath of walk(directory)) {
      const name = path.basename(filePath);
      if (FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
        violations.push({ code: "forbidden_file", path: filePath });
        continue;
      }

      if (!TEXT_EXTENSIONS.has(path.extname(filePath))) continue;
      if (fs.statSync(filePath).size > MAXIMUM_SCANNED_BYTES) continue;

      const contents = fs.readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
        if (pattern.test(contents)) {
          // The matched text is deliberately not reported: printing it would
          // move the secret into the CI log this check exists to protect.
          violations.push({ code: "forbidden_content", path: filePath });
          break;
        }
      }
    }
  }

  return violations;
}

function runCli() {
  const directories = process.argv.slice(2);
  const violations = findArtifactViolations(
    directories.length > 0 ? directories : ["playwright-report", "test-results"],
  );

  if (violations.length === 0) {
    console.log("Artifacts are safe to publish.");
    return;
  }

  console.error(`Refusing to publish ${violations.length} unsafe artifact(s):`);
  for (const violation of violations) {
    console.error(`- [${violation.code}] ${violation.path}`);
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
