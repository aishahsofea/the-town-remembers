#!/usr/bin/env node

/**
 * Deterministically scores a captured coding-agent decision against the
 * test-policy-eval corpus (verification/test-policy-evals/). Model
 * invocation itself stays outside this script and outside the default
 * `pnpm validate` gate — an agent's run is captured manually or by an
 * opt-in command elsewhere into the JSON shape `loadRun` reads, and this
 * script only scores that capture. The same captured file always produces
 * the same score.
 *
 * Hard fields (action, claim ID, boundary, setup class, and whether a
 * required exception field is present at all) are scored by code. Whether a
 * free-text `uniqueProof`/`isolationReason` actually describes a distinct
 * failure surface is flagged `needsHumanReview` rather than guessed at —
 * fluent prose is never treated as evidence that a hard field passed.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { REPOSITORY_ROOT } from "./local-env.mjs";
import { loadScenarios } from "./test-policy-evals.mjs";
import { computeChecksum, extractCoreBlock } from "./sync-agent-test-policy.mjs";

export function currentPolicyChecksum(rootDir = REPOSITORY_ROOT) {
  const policyMarkdown = fs.readFileSync(
    path.join(rootDir, "docs/agents/testing-policy.md"),
    "utf8",
  );
  return computeChecksum(extractCoreBlock(policyMarkdown));
}

function fieldMismatch(field, expected, actual) {
  return { field, expected, actual };
}

/** Scores one scenario's expected fields against one captured decision.
 * Returns null mismatches only for fields the scenario actually constrains
 * (a null `expected.boundary`, for instance, imposes no requirement). */
export function scoreDecision(scenario, decision = {}) {
  const expected = scenario.expected;
  const mismatches = [];

  if (decision.action !== expected.action) {
    mismatches.push(fieldMismatch("action", expected.action, decision.action));
  }
  if (
    expected.claimId !== undefined &&
    expected.claimId !== null &&
    decision.claimId !== expected.claimId
  ) {
    mismatches.push(
      fieldMismatch("claimId", expected.claimId, decision.claimId ?? null),
    );
  }
  if (
    expected.boundary !== undefined &&
    expected.boundary !== null &&
    decision.boundary !== expected.boundary
  ) {
    mismatches.push(
      fieldMismatch("boundary", expected.boundary, decision.boundary ?? null),
    );
  }
  if (
    expected.setup !== undefined &&
    expected.setup !== null &&
    decision.setup !== expected.setup
  ) {
    mismatches.push(fieldMismatch("setup", expected.setup, decision.setup ?? null));
  }

  const uniqueProofPresent =
    typeof decision.uniqueProof === "string" && decision.uniqueProof.length > 0;
  if (expected.uniqueProofRequired && !uniqueProofPresent) {
    mismatches.push(fieldMismatch("uniqueProof", "present", "missing"));
  }

  const isolationReasonPresent =
    typeof decision.isolationReason === "string" && decision.isolationReason.length > 0;
  if (expected.isolationReasonRequired && !isolationReasonPresent) {
    mismatches.push(fieldMismatch("isolationReason", "present", "missing"));
  }

  return {
    scenarioId: scenario.id,
    category: scenario.category,
    hardPass: mismatches.length === 0,
    mismatches,
    needsHumanReview: Boolean(expected.uniqueProofRequired) && uniqueProofPresent,
  };
}

export function scoreRun(run, scenarios) {
  const results = scenarios.map(({ scenario }) =>
    scoreDecision(scenario, run.decisions?.[scenario.id]),
  );
  const summary = {
    total: results.length,
    hardPass: results.filter((r) => r.hardPass).length,
    hardFail: results.filter((r) => !r.hardPass).length,
    needsHumanReview: results.filter((r) => r.needsHumanReview).length,
  };
  return {
    agent: run.agent ?? null,
    model: run.model ?? null,
    policyChecksum: run.policyChecksum ?? null,
    results,
    summary,
  };
}

export function loadRun(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatReport(scored, currentChecksum) {
  const lines = [];
  lines.push(
    `Agent: ${scored.agent ?? "(unrecorded)"}  Model: ${scored.model ?? "(unrecorded)"}`,
  );
  if (
    scored.policyChecksum &&
    currentChecksum &&
    scored.policyChecksum !== currentChecksum
  ) {
    lines.push(
      `WARNING: run was captured against policy checksum ${scored.policyChecksum}, ` +
        `current policy is ${currentChecksum}. Re-capture before trusting this score.`,
    );
  }
  for (const result of scored.results) {
    const status = result.hardPass ? "PASS" : "FAIL";
    const review = result.needsHumanReview
      ? " [needs human review of uniqueProof]"
      : "";
    lines.push(`${status} ${result.scenarioId} (${result.category})${review}`);
    for (const mismatch of result.mismatches) {
      lines.push(
        `  - ${mismatch.field}: expected ${JSON.stringify(mismatch.expected)}, got ${JSON.stringify(mismatch.actual)}`,
      );
    }
  }
  lines.push(
    `${scored.summary.hardPass}/${scored.summary.total} hard-passed, ` +
      `${scored.summary.needsHumanReview} need human review of uniqueProof.`,
  );
  return lines.join("\n");
}

function runCli() {
  const runPath = process.argv[2];
  if (!runPath) {
    console.error("Usage: test-policy-eval.mjs <captured-run.json>");
    process.exitCode = 2;
    return;
  }
  const run = loadRun(path.resolve(runPath));
  const scenarios = loadScenarios();
  const scored = scoreRun(run, scenarios);
  console.log(formatReport(scored, currentPolicyChecksum()));
  if (scored.summary.hardFail > 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
