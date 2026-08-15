#!/usr/bin/env node

/**
 * Classifies every file the `database` and `database-unit` vitest projects
 * cover by what its setup and assertions actually mutate, not by which
 * package it lives in (`VPR-06`).
 *
 *   pure                  -- no live database; asserts against fakes,
 *                            mocks, or pure functions. Runs in the
 *                            `database-unit` project, parallel with the
 *                            other pure projects.
 *   isolated-schema       -- changes or verifies migrations, grants, roles,
 *                            schema identity, or other database-global
 *                            state a shared reset cannot safely reproduce
 *                            around neighboring files.
 *   isolated-concurrency  -- exercises lock/failure behavior whose outcome
 *                            depends on being the only writer against its
 *                            database while it runs.
 *   shared-migrated       -- everything else: ordinary per-town runtime
 *                            data, scoped by that test's own unique
 *                            identifiers, safe to run against a reset
 *                            already-migrated shared fixture (`VPR-07`).
 *
 * `shared-migrated` has no per-file reason recorded below because it is the
 * default outcome, not a judgment call: any file the `database`/
 * `database-unit` globs match that is not explicitly named `pure` or
 * `isolated-*` is `shared-migrated`.
 */

import fs from "node:fs";
import path from "node:path";

import { REPOSITORY_ROOT } from "./local-env.mjs";

export const DATABASE_TEST_GLOBS = Object.freeze([
  "packages/database/src",
  "packages/database-admin/src",
  "packages/town-seed/src",
]);

export const PURE_FILES = Object.freeze({
  "packages/database/src/domains.test.ts":
    "Domain-record shaping over plain in-memory objects; never imports a database client.",
  "packages/database/src/runtime.test.ts":
    "Exercises the runtime query builder against a fake driver, not a live connection.",
  "packages/database/src/schema.test.ts":
    "Asserts the generated schema module's shape and drift detection against fixtures, not a live database.",
  "packages/database/src/transaction.test.ts":
    "Exercises the transaction helper's retry/wrapping logic against a fake client.",
  "packages/database-admin/src/introspection.test.ts":
    "Parses introspection query results from fixture data, not a live connection.",
  "packages/database-admin/src/operator-client.test.ts":
    "Exercises the operator client's request-shaping logic against a fake transport.",
});

export const ISOLATED_FILES = Object.freeze({
  "packages/database-admin/src/grants.test.ts":
    "isolated-schema -- creates and exercises real database roles and grants; role membership is database-global state a shared reset cannot safely reproduce around neighboring files.",
  "packages/database-admin/src/runner.test.ts":
    "isolated-schema -- exercises the migration runner itself (file discovery, SQL rendering, applying migrations), which is the schema-global work a shared already-migrated fixture exists to avoid repeating.",
  "packages/database-admin/src/schema-audit.test.ts":
    "isolated-schema -- audits the live schema's structure against the migration source; needs to see the schema exactly as migrations left it, not a reset runtime-data snapshot.",
  "packages/database-admin/src/schema-identity.test.ts":
    "isolated-schema -- verifies primary/foreign key and generated-identity behavior, which is schema-global rather than per-row runtime data.",
  "packages/database-admin/src/transaction-integration.test.ts":
    "isolated-concurrency -- proves the transaction helper's serialization/retry behavior against real engine contention; a shared fixture's resets from other files would confound the timing this suite depends on.",
  "packages/database-admin/src/vector-concurrency.test.ts":
    "isolated-concurrency -- proves at-most-one-writer-wins outcomes (town resolution, item custodianship) under real concurrent transactions; needs to be the only writer against its database while it runs.",
});

function listTestFiles(rootDir) {
  const files = [];
  for (const dir of DATABASE_TEST_GLOBS) {
    walk(path.join(rootDir, dir), rootDir, files);
  }
  walk(
    path.join(rootDir, "packages/game-server/src"),
    rootDir,
    files,
    /\.db\.test\.ts$/,
  );
  return files.sort();
}

function walk(dir, rootDir, out, suffixPattern = /\.test\.ts$/) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, rootDir, out, suffixPattern);
    } else if (suffixPattern.test(entry.name)) {
      out.push(path.relative(rootDir, fullPath).split(path.sep).join("/"));
    }
  }
}

/**
 * `createDisposableDatabase()` is how an isolated-schema/isolated-concurrency
 * file gets its own database; `useSharedTestDatabase()` is how a
 * shared-migrated file gets the one suite-owned database instead (`VPR-07`).
 * Either one is evidence a file actually talks to a live database.
 */
function touchesLiveDatabase(rootDir, relativePath) {
  const contents = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  return (
    contents.includes("createDisposableDatabase(") ||
    contents.includes("useSharedTestDatabase(")
  );
}

/**
 * The default `pnpm validate` gate's total database creation/migration
 * count (`VPR-08`): every `createDisposableDatabase()` call the isolated
 * files still make, plus the one suite-owned database
 * `scripts/vitest-database-setup.mjs`'s globalSetup creates for every
 * `shared-migrated` file to share (`VPR-07`). Down from 53 before VPR-06
 * through VPR-08 (49 files each creating their own database, 4 of them
 * twice) -- comfortably inside the "no more than 10" exit target without
 * grouping any isolated file merely to hit the number.
 */
export function countDatabaseCreations(rootDir = REPOSITORY_ROOT) {
  const SUITE_OWNED_DATABASE_COUNT = 1;
  let isolatedCreations = 0;
  for (const file of Object.keys(ISOLATED_FILES)) {
    const contents = fs.readFileSync(path.join(rootDir, file), "utf8");
    isolatedCreations += (contents.match(/createDisposableDatabase\(/g) ?? []).length;
  }
  return isolatedCreations + SUITE_OWNED_DATABASE_COUNT;
}

/**
 * Classifies every database-project test file found on disk, and checks
 * that classification against what the file's source actually does:
 * `pure` files must never call `createDisposableDatabase()` or
 * `useSharedTestDatabase()`, and every `isolated-*`/`shared-migrated` file
 * must call one of them.
 */
export function classifyDatabaseTests(rootDir = REPOSITORY_ROOT) {
  const files = listTestFiles(rootDir);
  const classified = [];
  const problems = [];

  for (const file of files) {
    const touchesDatabase = touchesLiveDatabase(rootDir, file);
    if (file in PURE_FILES) {
      if (touchesDatabase) {
        problems.push(
          `${file} is classified "pure" but calls createDisposableDatabase().`,
        );
      }
      classified.push({ file, class: "pure", reason: PURE_FILES[file] });
      continue;
    }
    if (file in ISOLATED_FILES) {
      if (!touchesDatabase) {
        problems.push(
          `${file} is classified isolated but never calls createDisposableDatabase().`,
        );
      }
      const reason = ISOLATED_FILES[file];
      classified.push({ file, class: reason.split(" -- ")[0], reason });
      continue;
    }
    if (!touchesDatabase) {
      problems.push(
        `${file} is unclassified and never calls createDisposableDatabase() -- ` +
          `it must be added to PURE_FILES with a reason.`,
      );
    }
    classified.push({ file, class: "shared-migrated", reason: undefined });
  }

  return { classified, problems };
}
