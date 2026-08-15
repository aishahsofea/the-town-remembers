import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { classifyDatabaseTests } from "./database-test-classification.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-db-classify-"));
  temporaryDirectories.push(rootDir);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return rootDir;
}

test("classifies a file that calls createDisposableDatabase as shared-migrated by default", () => {
  const rootDir = createFixture({
    "packages/game-server/src/persistence/widgets.db.test.ts":
      "createDisposableDatabase();\n",
  });
  const { classified, problems } = classifyDatabaseTests(rootDir);
  assert.deepEqual(problems, []);
  assert.equal(classified.length, 1);
  assert.equal(classified[0].class, "shared-migrated");
});

test("flags a shared-migrated-looking file that never touches a live database", () => {
  const rootDir = createFixture({
    "packages/game-server/src/persistence/widgets.db.test.ts": "assert.equal(1, 1);\n",
  });
  const { problems } = classifyDatabaseTests(rootDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /must be added to PURE_FILES/);
});

test("every real PURE_FILES entry never calls createDisposableDatabase", () => {
  const { classified, problems } = classifyDatabaseTests();
  const pureProblems = problems.filter((problem) =>
    problem.includes('classified "pure"'),
  );
  assert.deepEqual(pureProblems, []);
  const pureCount = classified.filter((entry) => entry.class === "pure").length;
  assert.equal(pureCount, 6);
});

test("every real ISOLATED_FILES entry does call createDisposableDatabase", () => {
  const { classified, problems } = classifyDatabaseTests();
  const isolatedProblems = problems.filter((problem) => problem.includes("isolated"));
  assert.deepEqual(isolatedProblems, []);
  const isolatedCount = classified.filter((entry) =>
    entry.class.startsWith("isolated"),
  ).length;
  assert.equal(isolatedCount, 6);
});

test("no real database test file is unclassified", () => {
  const { classified, problems } = classifyDatabaseTests();
  const unclassifiedProblems = problems.filter((problem) =>
    problem.includes("must be added to PURE_FILES"),
  );
  assert.deepEqual(
    unclassifiedProblems,
    [],
    "a new database test file appeared that never calls createDisposableDatabase() " +
      "and has no PURE_FILES entry explaining why",
  );
  assert.ok(
    classified.length >= 55,
    `expected at least 55 files, got ${classified.length}`,
  );
});
