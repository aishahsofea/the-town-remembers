#!/usr/bin/env node

/**
 * Loads and validates verification/test-policy-evals/*.json against
 * scenario.schema.json's constraints. Hand-written rather than a generic
 * JSON Schema interpreter, matching this repo's other check scripts — the
 * schema file stays the documented interchange format, this is its
 * enforcement.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { REPOSITORY_ROOT } from "./local-env.mjs";

export const EVALS_DIR = path.join(REPOSITORY_ROOT, "verification/test-policy-evals");

const CATEGORIES = new Set(["control", "known-failure", "boundary"]);
const ACTIONS = new Set(["add", "extend", "reuse", "ask"]);
const BOUNDARIES = new Set([
  "typecheck",
  "pure function",
  "component/hook",
  "API/application",
  "database",
  "real socket",
  "browser",
  "deployed/live",
]);
const SETUPS = new Set([
  "none",
  "typecheck",
  "filesystem",
  "dom",
  "socket",
  "db-shared",
  "db-isolated",
  "browser",
  "model-live",
  "cloud-live",
]);
const ID_PATTERN = /^(control|known-failure|boundary)-[a-z0-9-]+$/;
const CLAIM_ID_PATTERN = /^V-[A-Z0-9-]+$/;
const RULE_ID_PATTERN = /^TG-\d{2}$/;

function fail(errors, message) {
  errors.push(message);
}

export function validateScenario(scenario, source = "<scenario>") {
  const errors = [];
  if (scenario.schemaVersion !== 1) {
    fail(errors, `${source}: schemaVersion must be 1`);
  }
  if (typeof scenario.id !== "string" || !ID_PATTERN.test(scenario.id)) {
    fail(errors, `${source}: id must match ${ID_PATTERN}`);
  }
  if (!CATEGORIES.has(scenario.category)) {
    fail(errors, `${source}: category must be one of ${[...CATEGORIES].join(", ")}`);
  }
  if (typeof scenario.id === "string" && !scenario.id.startsWith(`${scenario.category}-`)) {
    fail(errors, `${source}: id prefix must match category "${scenario.category}"`);
  }
  if (typeof scenario.title !== "string" || scenario.title.length === 0) {
    fail(errors, `${source}: title must be a non-empty string`);
  }
  if (typeof scenario.context !== "string" || scenario.context.length === 0) {
    fail(errors, `${source}: context must be a non-empty string`);
  }
  if (typeof scenario.request !== "string" || scenario.request.length === 0) {
    fail(errors, `${source}: request must be a non-empty string`);
  }

  const expected = scenario.expected;
  if (typeof expected !== "object" || expected === null) {
    fail(errors, `${source}: expected must be an object`);
    return errors;
  }
  if (!ACTIONS.has(expected.action)) {
    fail(errors, `${source}: expected.action must be one of ${[...ACTIONS].join(", ")}`);
  }
  if (
    expected.claimId !== undefined &&
    expected.claimId !== null &&
    !CLAIM_ID_PATTERN.test(expected.claimId)
  ) {
    fail(errors, `${source}: expected.claimId must match ${CLAIM_ID_PATTERN}`);
  }
  if (
    expected.boundary !== undefined &&
    expected.boundary !== null &&
    !BOUNDARIES.has(expected.boundary)
  ) {
    fail(errors, `${source}: expected.boundary must be one of ${[...BOUNDARIES].join(", ")}`);
  }
  if (
    expected.setup !== undefined &&
    expected.setup !== null &&
    !SETUPS.has(expected.setup)
  ) {
    fail(errors, `${source}: expected.setup must be one of ${[...SETUPS].join(", ")}`);
  }
  if (
    expected.uniqueProofRequired !== undefined &&
    typeof expected.uniqueProofRequired !== "boolean"
  ) {
    fail(errors, `${source}: expected.uniqueProofRequired must be a boolean`);
  }
  if (
    expected.isolationReasonRequired !== undefined &&
    typeof expected.isolationReasonRequired !== "boolean"
  ) {
    fail(errors, `${source}: expected.isolationReasonRequired must be a boolean`);
  }
  if (expected.violatedRules !== undefined) {
    if (!Array.isArray(expected.violatedRules)) {
      fail(errors, `${source}: expected.violatedRules must be an array`);
    } else {
      for (const ruleId of expected.violatedRules) {
        if (typeof ruleId !== "string" || !RULE_ID_PATTERN.test(ruleId)) {
          fail(errors, `${source}: expected.violatedRules entries must match ${RULE_ID_PATTERN}`);
        }
      }
    }
  }
  if (typeof expected.rationale !== "string" || expected.rationale.length === 0) {
    fail(errors, `${source}: expected.rationale must be a non-empty string`);
  }

  return errors;
}

export function loadScenarios(evalsDir = EVALS_DIR) {
  const indexPath = path.join(evalsDir, "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  return index.scenarios.map((fileName) => {
    const filePath = path.join(evalsDir, fileName);
    const scenario = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { fileName, filePath, scenario };
  });
}

export function validateAllScenarios(evalsDir = EVALS_DIR) {
  const entries = loadScenarios(evalsDir);
  const errors = [];
  const seenIds = new Set();
  const seenCategories = new Set();

  for (const { fileName, scenario } of entries) {
    for (const error of validateScenario(scenario, fileName)) {
      errors.push(error);
    }
    if (typeof scenario.id === "string") {
      if (seenIds.has(scenario.id)) {
        errors.push(`${fileName}: duplicate scenario id "${scenario.id}"`);
      }
      seenIds.add(scenario.id);
    }
    if (typeof scenario.category === "string") {
      seenCategories.add(scenario.category);
    }
  }

  for (const category of CATEGORIES) {
    if (!seenCategories.has(category)) {
      errors.push(`corpus is missing every scenario in category "${category}"`);
    }
  }

  return errors;
}

function runCli() {
  const errors = validateAllScenarios();
  if (errors.length === 0) {
    const entries = loadScenarios();
    console.log(`${entries.length} test-policy-eval scenario(s) pass schema validation.`);
    return;
  }
  console.error(`Test-policy-eval corpus failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
