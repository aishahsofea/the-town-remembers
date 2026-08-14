import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareToBaseline,
  evaluateAll,
  reducedCostDialogueAllowed,
} from "./prompts-eval.mjs";

test("every checked-in phase-04 prompt-evaluation fixture passes deterministically", async () => {
  const evaluation = await evaluateAll();
  const failures = evaluation.results.filter((result) => !result.pass);
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [],
    `expected no fixture failures, got: ${JSON.stringify(failures, null, 2)}`,
  );
  assert.ok(evaluation.results.length > 0, "expected at least one fixture to run");
});

test("every table cell from Decision 010's evaluation gate has coverage across the three families", async () => {
  const evaluation = await evaluateAll();
  const categoriesByFamily = new Map();
  for (const result of evaluation.results) {
    const categories = categoriesByFamily.get(result.family) ?? new Set();
    categories.add(result.category);
    categoriesByFamily.set(result.family, categories);
  }
  for (const family of ["normalization", "dialogue", "repair"]) {
    const categories = categoriesByFamily.get(family);
    assert.ok(categories, `expected fixtures for the "${family}" family`);
    assert.ok(categories.has("control"), `expected a control fixture for "${family}"`);
    assert.ok(
      categories.has("known_failure") || categories.has("boundary"),
      `expected a known-failure or boundary fixture for "${family}"`,
    );
  }
});

test("reducedCostDialogueAllowed requires every dialogue fixture in the baseline to pass", () => {
  assert.equal(reducedCostDialogueAllowed(undefined), false);
  assert.equal(
    reducedCostDialogueAllowed({
      results: [
        { family: "dialogue", pass: true },
        { family: "dialogue", pass: true },
        { family: "normalization", pass: false },
      ],
    }),
    true,
  );
  assert.equal(
    reducedCostDialogueAllowed({
      results: [
        { family: "dialogue", pass: true },
        { family: "dialogue", pass: false },
      ],
    }),
    false,
  );
  assert.equal(reducedCostDialogueAllowed({ results: [] }), false);
});

test("compareToBaseline flags a fixture that passed in the baseline and now fails", () => {
  const baseline = {
    results: [
      { id: "n-control-was_at-positive", pass: true },
      { id: "n-known-unknown-alias", pass: false },
    ],
  };
  const evaluation = {
    results: [
      { id: "n-control-was_at-positive", pass: false },
      { id: "n-known-unknown-alias", pass: false },
    ],
  };
  const { regressions } = compareToBaseline(evaluation, baseline);
  assert.deepEqual(regressions, ["n-control-was_at-positive"]);
});

test("compareToBaseline reports no regressions with no prior baseline", () => {
  const evaluation = { results: [{ id: "n-control-was_at-positive", pass: false }] };
  const { regressions } = compareToBaseline(evaluation, undefined);
  assert.deepEqual(regressions, []);
});
