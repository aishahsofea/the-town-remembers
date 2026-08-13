#!/usr/bin/env node

/**
 * Fails on control bytes that make a source file stop behaving like text.
 *
 * A single NUL inside a template literal once reached `main` unnoticed: tsc,
 * eslint, prettier, and the full test suite all passed, but git reclassified
 * the file as binary and `git diff`, `grep`, and code review silently stopped
 * showing its contents. No other gate in this repo looks at bytes, so this
 * one does.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".sql",
  ".yaml",
  ".yml",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  // Each entry under here is a separate git worktree (a separate checkout
  // with its own history), not source this repository owns.
  ".claude",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "cdk.out",
  "test-results",
  "playwright-report",
]);

/**
 * Tab, line feed, and carriage return are the only C0 bytes that legitimately
 * appear in text. Everything else in that range — NUL above all — is a
 * mistake that no higher-level tool will report.
 */
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);

function isForbiddenControlByte(byte) {
  return (byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) || byte === 0x7f;
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      yield* walk(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    yield path.join(directory, entry.name);
  }
}

/**
 * One offending byte, located by 1-indexed line and byte column. The column
 * counts bytes rather than characters, which is what an editor jumping to a
 * raw byte needs and what a multibyte line would otherwise misreport.
 */
export function findControlBytes(contents) {
  const findings = [];
  let line = 1;
  let column = 1;
  for (const byte of contents) {
    if (isForbiddenControlByte(byte)) {
      findings.push({ line, column, byte });
    }
    if (byte === 0x0a) {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }
  return findings;
}

export function checkSourceText(rootDir = process.cwd()) {
  const violations = [];
  for (const filePath of walk(rootDir)) {
    for (const finding of findControlBytes(fs.readFileSync(filePath))) {
      violations.push({ path: filePath, ...finding });
    }
  }
  return violations.sort((left, right) =>
    `${left.path}:${left.line}:${left.column}`.localeCompare(
      `${right.path}:${right.line}:${right.column}`,
    ),
  );
}

function runCli() {
  const rootDir = process.argv[2] ?? process.cwd();
  const violations = checkSourceText(rootDir);
  if (violations.length === 0) {
    console.log("Source files contain no forbidden control bytes.");
    return;
  }

  console.error(`Source text check failed with ${violations.length} violation(s):`);
  for (const violation of violations) {
    const location = path.relative(rootDir, violation.path);
    const byte = `0x${violation.byte.toString(16).padStart(2, "0")}`;
    console.error(`- ${location}:${violation.line}:${violation.column} has ${byte}`);
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
