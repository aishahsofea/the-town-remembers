import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { validateAllScenarios, validateScenario } from "./test-policy-evals.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function baseScenario(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "control-example",
    category: "control",
    title: "Example",
    context: "Some repository context.",
    request: "Do a thing.",
    expected: {
      action: "add",
      rationale: "Because reasons.",
    },
    ...overrides,
  };
}

function createCorpus(scenarios) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-test-policy-evals-"));
  temporaryDirectories.push(rootDir);
  const fileNames = [];
  for (const [index, scenario] of scenarios.entries()) {
    const fileName = `${scenario.id ?? `scenario-${index}`}.json`;
    fs.writeFileSync(path.join(rootDir, fileName), JSON.stringify(scenario));
    fileNames.push(fileName);
  }
  fs.writeFileSync(
    path.join(rootDir, "index.json"),
    JSON.stringify({ schemaVersion: 1, scenarios: fileNames }),
  );
  return rootDir;
}

test("accepts a well-formed scenario", () => {
  assert.deepEqual(validateScenario(baseScenario()), []);
});

test("rejects an unknown category", () => {
  const errors = validateScenario(baseScenario({ category: "vibes" }));
  assert.ok(errors.some((e) => e.includes("category")));
});

test("rejects an id whose prefix does not match its category", () => {
  const errors = validateScenario(
    baseScenario({ id: "boundary-example", category: "control" }),
  );
  assert.ok(errors.some((e) => e.includes("id prefix")));
});

test("rejects an unknown expected.action", () => {
  const errors = validateScenario(
    baseScenario({ expected: { action: "delete", rationale: "x" } }),
  );
  assert.ok(errors.some((e) => e.includes("expected.action")));
});

test("rejects an unknown expected.boundary", () => {
  const errors = validateScenario(
    baseScenario({
      expected: { action: "add", boundary: "vibes", rationale: "x" },
    }),
  );
  assert.ok(errors.some((e) => e.includes("expected.boundary")));
});

test("rejects a malformed violatedRules entry", () => {
  const errors = validateScenario(
    baseScenario({
      expected: { action: "ask", violatedRules: ["not-a-rule"], rationale: "x" },
    }),
  );
  assert.ok(errors.some((e) => e.includes("violatedRules")));
});

test("rejects a missing rationale", () => {
  const errors = validateScenario(
    baseScenario({ expected: { action: "add", rationale: "" } }),
  );
  assert.ok(errors.some((e) => e.includes("rationale")));
});

test("validateAllScenarios accepts a corpus covering every category", () => {
  const rootDir = createCorpus([
    baseScenario({ id: "control-a" }),
    baseScenario({ id: "known-failure-a", category: "known-failure" }),
    baseScenario({ id: "boundary-a", category: "boundary" }),
  ]);
  assert.deepEqual(validateAllScenarios(rootDir), []);
});

test("validateAllScenarios reports a category with zero scenarios", () => {
  const rootDir = createCorpus([baseScenario({ id: "control-a" })]);
  const errors = validateAllScenarios(rootDir);
  assert.ok(errors.some((e) => e.includes('category "known-failure"')));
  assert.ok(errors.some((e) => e.includes('category "boundary"')));
});

test("validateAllScenarios reports a duplicate scenario id", () => {
  const rootDir = createCorpus([
    baseScenario({ id: "control-a" }),
    baseScenario({ id: "control-a" }),
    baseScenario({ id: "known-failure-a", category: "known-failure" }),
    baseScenario({ id: "boundary-a", category: "boundary" }),
  ]);
  const errors = validateAllScenarios(rootDir);
  assert.ok(errors.some((e) => e.includes("duplicate scenario id")));
});

// The real verification/test-policy-evals/ corpus is validated by
// `pnpm check:test-policy`, which scripts/check-test-policy.mjs runs once as
// part of `pnpm validate` — not repeated here against synthetic fixtures.
