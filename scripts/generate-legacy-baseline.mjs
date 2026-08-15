#!/usr/bin/env node

/**
 * Generates verification/legacy-test-baseline.json: every statically-named
 * `test(...)`/`it(...)` declaration currently on disk that is not already
 * owned by verification/test-claims.json. This is the "legacy track" from
 * docs/agents/testing-policy.md — grandfathered so the governed-ownership
 * check does not require a manual backfill across the whole suite before it
 * can land.
 *
 * Deliberately explicit, never run automatically: `--write` is a reviewable
 * command a human runs and diffs, not something CI regenerates for you.
 *
 * Known gap: parameterized declarations built with `.each(...)` use a
 * runtime template as their name, not a static string literal, so this
 * scanner cannot see them. Touching a `.each` file still moves it onto the
 * governed track like any other materially changed legacy test — it is just
 * not separately tracked here by individual case name.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { REPOSITORY_ROOT } from "./local-env.mjs";

export const BASELINE_PATH = path.join(
  REPOSITORY_ROOT,
  "verification/legacy-test-baseline.json",
);
export const CLAIMS_PATH = path.join(REPOSITORY_ROOT, "verification/test-claims.json");

const TEST_FILE_PATTERN = /\.(test\.tsx?|test\.mjs|spec\.ts)$/;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".claude",
  ".codegraph",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "cdk.out",
  "test-results",
  "playwright-report",
]);

/** Matches `test(`, `it(`, `test.only(`, `it.skip(`, etc. followed directly
 * by a quoted (not template-interpolated) name — the shape every hand-named
 * declaration in this repo uses. */
const DECLARATION_PATTERN =
  /\b(?:test|it)(?:\.only|\.skip|\.todo|\.concurrent)?\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      yield* walk(path.join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEST_FILE_PATTERN.test(entry.name)) continue;
    yield path.join(directory, entry.name);
  }
}

export function extractDeclarations(source) {
  const names = [];
  for (const match of source.matchAll(DECLARATION_PATTERN)) {
    names.push(match[2]);
  }
  return names;
}

function loadGovernedPairs(claimsPath = CLAIMS_PATH) {
  const ledger = JSON.parse(fs.readFileSync(claimsPath, "utf8"));
  const governed = new Set();
  for (const claim of ledger.claims) {
    governed.add(`${claim.primary.file} ${claim.primary.test}`);
    for (const secondary of claim.secondary ?? []) {
      governed.add(`${secondary.file} ${secondary.test}`);
    }
  }
  return governed;
}

/** Every statically-named declaration on disk, grouped by file, sorted for a
 * stable diff. */
export function scanDeclarations(rootDir = REPOSITORY_ROOT) {
  const byFile = new Map();
  for (const filePath of walk(rootDir)) {
    const relativePath = path.relative(rootDir, filePath).split(path.sep).join("/");
    const source = fs.readFileSync(filePath, "utf8");
    const names = extractDeclarations(source);
    if (names.length > 0) {
      byFile.set(relativePath, names.sort());
    }
  }
  return byFile;
}

export function buildBaseline(rootDir = REPOSITORY_ROOT, claimsPath = CLAIMS_PATH) {
  const governed = loadGovernedPairs(claimsPath);
  const declarations = [];
  for (const [file, names] of scanDeclarations(rootDir)) {
    for (const test of names) {
      if (governed.has(`${file} ${test}`)) continue;
      declarations.push({ file, test });
    }
  }
  declarations.sort((a, b) =>
    `${a.file} ${a.test}`.localeCompare(`${b.file} ${b.test}`),
  );
  return {
    schemaVersion: 1,
    generatedBy: "node scripts/generate-legacy-baseline.mjs --write",
    declarationCount: declarations.length,
    declarations,
  };
}

function runCli() {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--write") {
    console.error("Usage: generate-legacy-baseline.mjs --check|--write");
    process.exitCode = 2;
    return;
  }

  const baseline = buildBaseline();
  const serialized = `${JSON.stringify(baseline, null, 2)}\n`;

  if (mode === "--write") {
    fs.writeFileSync(BASELINE_PATH, serialized);
    console.log(
      `Wrote ${baseline.declarationCount} legacy declaration(s) to ` +
        path.relative(REPOSITORY_ROOT, BASELINE_PATH),
    );
    return;
  }

  const existing = fs.existsSync(BASELINE_PATH)
    ? fs.readFileSync(BASELINE_PATH, "utf8")
    : null;
  if (existing !== serialized) {
    console.error(
      "verification/legacy-test-baseline.json is stale. Run " +
        "`node scripts/generate-legacy-baseline.mjs --write` and review the diff.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `verification/legacy-test-baseline.json matches the ${baseline.declarationCount} declaration(s) on disk.`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
