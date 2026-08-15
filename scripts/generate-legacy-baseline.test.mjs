import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { buildBaseline, extractDeclarations } from "./generate-legacy-baseline.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("extractDeclarations finds test() and it() names, including modifiers", () => {
  const source = [
    `test("plain test", () => {});`,
    `it("plain it", () => {});`,
    `it.only("focused", () => {});`,
    `test.skip('single quoted', () => {});`,
  ].join("\n");
  assert.deepEqual(extractDeclarations(source), [
    "plain test",
    "plain it",
    "focused",
    "single quoted",
  ]);
});

test("extractDeclarations ignores describe() and unrelated calls", () => {
  const source = `describe("a group", () => { test("inner", () => {}); });`;
  assert.deepEqual(extractDeclarations(source), ["inner"]);
});

test("extractDeclarations does not see parameterized .each names", () => {
  const source = `it.each([1, 2])("case %s", (n) => {});`;
  assert.deepEqual(extractDeclarations(source), []);
});

function createFixtureRepo({ testFiles, claims }) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-legacy-baseline-"));
  temporaryDirectories.push(rootDir);
  for (const [relativePath, contents] of Object.entries(testFiles)) {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  const claimsPath = path.join(rootDir, "test-claims.json");
  fs.writeFileSync(claimsPath, JSON.stringify(claims));
  return { rootDir, claimsPath };
}

test("buildBaseline excludes declarations already owned by the claim ledger", () => {
  const { rootDir, claimsPath } = createFixtureRepo({
    testFiles: {
      "packages/a/src/foo.test.ts": [
        `test("governed behavior", () => {});`,
        `test("legacy behavior", () => {});`,
      ].join("\n"),
    },
    claims: {
      schemaVersion: 1,
      claims: [
        {
          id: "V-EXAMPLE",
          requirement: "x",
          primary: { file: "packages/a/src/foo.test.ts", test: "governed behavior", boundary: "pure function" },
          cases: ["x"],
          setup: "none",
          source: "test",
        },
      ],
    },
  });

  const baseline = buildBaseline(rootDir, claimsPath);
  assert.equal(baseline.declarationCount, 1);
  assert.deepEqual(baseline.declarations, [
    { file: "packages/a/src/foo.test.ts", test: "legacy behavior" },
  ]);
});

test("buildBaseline also excludes declarations owned as a secondary claim", () => {
  const { rootDir, claimsPath } = createFixtureRepo({
    testFiles: {
      "e2e/example.spec.ts": [`test("secondary journey", () => {});`].join("\n"),
    },
    claims: {
      schemaVersion: 1,
      claims: [
        {
          id: "V-EXAMPLE",
          requirement: "x",
          primary: { file: "a.test.ts", test: "primary", boundary: "pure function" },
          cases: ["x"],
          secondary: [
            {
              file: "e2e/example.spec.ts",
              test: "secondary journey",
              boundary: "browser",
              uniqueProof: "x",
            },
          ],
          setup: "none",
          source: "test",
        },
      ],
    },
  });

  const baseline = buildBaseline(rootDir, claimsPath);
  assert.deepEqual(baseline.declarations, []);
});

test("buildBaseline output is sorted for a stable diff", () => {
  const { rootDir, claimsPath } = createFixtureRepo({
    testFiles: {
      "b.test.ts": `test("zebra", () => {});\ntest("alpha", () => {});`,
      "a.test.ts": `test("middle", () => {});`,
    },
    claims: { schemaVersion: 1, claims: [] },
  });

  const baseline = buildBaseline(rootDir, claimsPath);
  assert.deepEqual(baseline.declarations, [
    { file: "a.test.ts", test: "middle" },
    { file: "b.test.ts", test: "alpha" },
    { file: "b.test.ts", test: "zebra" },
  ]);
});
