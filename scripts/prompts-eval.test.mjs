import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkCorpusShape,
  compareToBaseline,
  reducedCostDialogueAllowed,
} from "./prompts-eval.mjs";

/**
 * These tests unit-test `prompts-eval.mjs`'s helpers against small, inline
 * evaluations. They must not call `evaluateAll()` or otherwise traverse the
 * real `evals/phase-04` corpus (`VPR-04`) -- that corpus is evaluated
 * exactly once per `pnpm validate` run, by `pnpm prompts:eval` itself.
 */

function resultsFor(entries) {
  return {
    results: entries.map(([family, category]) => ({ family, category, pass: true })),
  };
}

test("checkCorpusShape passes when every family has a control and a known-failure/boundary fixture", () => {
  const evaluation = resultsFor([
    ["normalization", "control"],
    ["normalization", "known_failure"],
    ["dialogue", "control"],
    ["dialogue", "boundary"],
    ["repair", "control"],
    ["repair", "known_failure"],
  ]);
  assert.deepEqual(checkCorpusShape(evaluation), []);
});

test("checkCorpusShape reports a missing family", () => {
  const evaluation = resultsFor([
    ["normalization", "control"],
    ["normalization", "known_failure"],
    ["repair", "control"],
    ["repair", "boundary"],
  ]);
  const problems = checkCorpusShape(evaluation);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"dialogue"/);
});

test("checkCorpusShape reports a family missing a control fixture", () => {
  const evaluation = resultsFor([
    ["normalization", "known_failure"],
    ["dialogue", "control"],
    ["dialogue", "boundary"],
    ["repair", "control"],
    ["repair", "known_failure"],
  ]);
  const problems = checkCorpusShape(evaluation);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"control".*"normalization"/);
});

test("checkCorpusShape reports a family missing both known-failure and boundary fixtures", () => {
  const evaluation = resultsFor([
    ["normalization", "control"],
    ["dialogue", "control"],
    ["dialogue", "boundary"],
    ["repair", "control"],
    ["repair", "known_failure"],
  ]);
  const problems = checkCorpusShape(evaluation);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"known_failure" or "boundary".*"normalization"/);
});

test("checkCorpusShape reports every missing family when the corpus is empty", () => {
  const problems = checkCorpusShape({ results: [] });
  assert.equal(problems.length, 3);
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
