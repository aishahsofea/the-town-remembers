import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreDecision, scoreRun } from "./test-policy-eval.mjs";

function scenario({ id = "example", category = "control", ...expectedOverrides } = {}) {
  return {
    id,
    category,
    expected: {
      action: "add",
      claimId: null,
      boundary: "pure function",
      setup: "none",
      rationale: "x",
      ...expectedOverrides,
    },
  };
}

test("scoreDecision passes when every constrained field matches", () => {
  const result = scoreDecision(scenario(), {
    action: "add",
    boundary: "pure function",
    setup: "none",
  });
  assert.equal(result.hardPass, true);
  assert.deepEqual(result.mismatches, []);
});

test("scoreDecision fails on a wrong action even with plausible prose elsewhere", () => {
  const result = scoreDecision(scenario(), {
    action: "extend",
    boundary: "pure function",
    setup: "none",
    rationale: "This is definitely correct and well-reasoned.",
  });
  assert.equal(result.hardPass, false);
  assert.ok(result.mismatches.some((m) => m.field === "action"));
});

test("scoreDecision does not constrain a field the scenario leaves null", () => {
  const result = scoreDecision(scenario({ boundary: null, setup: null }), {
    action: "add",
    boundary: "database",
    setup: "db-shared",
  });
  assert.equal(result.hardPass, true);
});

test("scoreDecision requires a matching claimId when the scenario names one", () => {
  const result = scoreDecision(scenario({ action: "extend", claimId: "V-EXAMPLE" }), {
    action: "extend",
    claimId: "V-WRONG",
  });
  assert.equal(result.hardPass, false);
  assert.ok(result.mismatches.some((m) => m.field === "claimId"));
});

test("scoreDecision fails when uniqueProof is required but missing", () => {
  const result = scoreDecision(scenario({ uniqueProofRequired: true }), {
    action: "add",
    boundary: "pure function",
    setup: "none",
  });
  assert.equal(result.hardPass, false);
  assert.ok(result.mismatches.some((m) => m.field === "uniqueProof"));
  assert.equal(result.needsHumanReview, false);
});

test("scoreDecision hard-passes and flags human review when uniqueProof is present", () => {
  const result = scoreDecision(scenario({ uniqueProofRequired: true }), {
    action: "add",
    boundary: "pure function",
    setup: "none",
    uniqueProof: "Checks the address bar and cookies, not just the DOM.",
  });
  assert.equal(result.hardPass, true);
  assert.equal(result.needsHumanReview, true);
});

test("scoreDecision does not require uniqueProof from an 'ask' decision", () => {
  const result = scoreDecision(
    scenario({ action: "ask", boundary: null, setup: null, uniqueProofRequired: true }),
    { action: "ask" },
  );
  assert.equal(result.hardPass, true);
});

test("scoreDecision does not require isolationReason from an 'ask' decision", () => {
  const result = scoreDecision(
    scenario({
      action: "ask",
      boundary: null,
      setup: null,
      isolationReasonRequired: true,
    }),
    { action: "ask" },
  );
  assert.equal(result.hardPass, true);
});

test("scoreDecision fails when isolationReason is required but missing", () => {
  const result = scoreDecision(scenario({ isolationReasonRequired: true }), {
    action: "add",
    boundary: "pure function",
    setup: "none",
  });
  assert.equal(result.hardPass, false);
  assert.ok(result.mismatches.some((m) => m.field === "isolationReason"));
});

test("scoreDecision treats a missing decision as failing every constrained field", () => {
  const result = scoreDecision(scenario(), undefined);
  assert.equal(result.hardPass, false);
  assert.ok(result.mismatches.some((m) => m.field === "action"));
});

test("scoreRun is deterministic across repeated calls on the same input", () => {
  const scenarios = [
    { scenario: scenario({ id: "a" }) },
    { scenario: scenario({ id: "b" }) },
  ];
  const run = {
    agent: "test-agent",
    model: "test-model",
    decisions: {
      a: { action: "add", boundary: "pure function", setup: "none" },
      b: { action: "reuse" },
    },
  };
  const first = scoreRun(run, scenarios);
  const second = scoreRun(run, scenarios);
  assert.deepEqual(first, second);
  assert.equal(first.summary.total, 2);
  assert.equal(first.summary.hardPass, 1);
  assert.equal(first.summary.hardFail, 1);
});
