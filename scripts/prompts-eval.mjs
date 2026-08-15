#!/usr/bin/env node

/**
 * Deterministic prompt-evaluation runner (Decision 010's "Prompt evaluation
 * gate"; `P4-21`). Every fixture under `evals/phase-04/{normalization,
 * dialogue,repair}/*.json` is a recorded model output (or repair scenario)
 * run through the real semantic validators from
 * `@the-town-remembers/model-runtime` -- this file makes no Bedrock call.
 *
 * A fixture's `expect` is checked against schema validity, semantic
 * validator outcome, and stable error codes/IDs only -- never fuzzy prose
 * equality, matching Decision 010's release gate.
 *
 * `evals/phase-04/baseline.json` pins each fixture's pass/fail to the
 * prompt/schema/validator versions in effect when it was last accepted. A
 * fixture that regressed (passed in the baseline, fails now) fails the run
 * even under `--update-baseline`.
 *
 * `TTR_PROMPTS_EVAL_LIVE=1` (`pnpm prompts:eval:live`) additionally runs the
 * real Bedrock warmup smoke (the same four `WARMUP_PAIRS` calls
 * `model:prewarm` makes) after the deterministic fixtures, to prove the live
 * schema/model pairings are still accepted by Bedrock. Expected cost is well
 * under $0.01 total -- four small structured-output calls at Haiku/Sonnet
 * rates (`packages/model-runtime/src/cost/price-catalog.ts`), each capped at
 * a few hundred output tokens. Needs real AWS credentials and the
 * `TTR_BEDROCK_*`/`TTR_AWS_REGION` `.env` variables `model-prewarm.mjs`
 * documents.
 *
 * Usage:
 *   node scripts/prompts-eval.mjs [--update-baseline]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyLocalDefaults } from "./local-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVALS_ROOT = path.resolve(__dirname, "../evals/phase-04");
const BASELINE_PATH = path.join(EVALS_ROOT, "baseline.json");
const FAMILIES = ["normalization", "dialogue", "repair"];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveContext(contexts, ref) {
  if (typeof ref === "string") {
    const base = contexts[ref];
    if (!base) throw new Error(`Unknown trusted context "${ref}"`);
    return base;
  }
  if (ref && typeof ref === "object" && "$base" in ref) {
    const { $base, ...overrides } = ref;
    const base = contexts[$base];
    if (!base) throw new Error(`Unknown trusted context "${$base}"`);
    return { ...base, ...overrides };
  }
  return ref;
}

export function loadFixtures(familyDir) {
  const contextsPath = path.join(familyDir, "_contexts.json");
  const contexts = fs.existsSync(contextsPath) ? loadJson(contextsPath) : {};
  const files = fs
    .readdirSync(familyDir)
    .filter((name) => name.endsWith(".json") && name !== "_contexts.json")
    .sort();
  const cases = [];
  for (const file of files) {
    const data = loadJson(path.join(familyDir, file));
    for (const testCase of data.cases) {
      cases.push({ ...testCase, sourceFile: file, promptFamily: data.promptFamily });
    }
  }
  return { contexts, cases };
}

function errorCodesOf(result) {
  return result.valid ? [] : result.errors.map((error) => error.code);
}

function sameCodes(actual, expected) {
  if (!expected) return true;
  const left = [...actual].sort();
  const right = [...expected].sort();
  return (
    left.length === right.length && left.every((code, index) => code === right[index])
  );
}

function sameIds(actual, expected) {
  if (expected === undefined) return true;
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function runNormalizationCase(runtime, contexts, testCase) {
  const trustedContext = resolveContext(contexts, testCase.trustedContext);
  const schemaCheck = runtime.ClaimNormalizationV1Schema.safeParse(testCase.output);
  const expect = testCase.expect;
  if (!schemaCheck.success) {
    const actual = { valid: false, errorCodes: ["schema_mismatch"] };
    return { pass: expect.valid === false, actual };
  }

  const result = runtime.validateClaimNormalization(schemaCheck.data, trustedContext);
  const actual = {
    valid: result.valid,
    errorCodes: errorCodesOf(result),
    normalizedKeyNotNull: result.valid ? result.normalizedKey !== null : undefined,
  };
  let pass =
    actual.valid === expect.valid && sameCodes(actual.errorCodes, expect.errorCodes);
  if (pass && expect.normalizedKeyNotNull !== undefined) {
    pass = actual.normalizedKeyNotNull === expect.normalizedKeyNotNull;
  }
  return { pass, actual };
}

export function runDialogueCase(runtime, contexts, testCase) {
  const trustedContext = resolveContext(contexts, testCase.trustedContext);
  const schemaCheck = runtime.NpcDialogueV1Schema.safeParse(testCase.output);
  const expect = testCase.expect;
  if (!schemaCheck.success) {
    const actual = { valid: false, errorCodes: ["schema_mismatch"] };
    return { pass: expect.valid === false, actual };
  }

  const result = runtime.validateNpcDialogueSelection(schemaCheck.data, trustedContext);
  const actual = {
    valid: result.valid,
    errorCodes: errorCodesOf(result),
    concatenatedText: result.valid ? result.concatenatedText : undefined,
    expressedDisclosureIds: result.valid ? result.expressedDisclosureIds : undefined,
    expressedOutcomeIds: result.valid ? result.expressedOutcomeIds : undefined,
  };
  let pass =
    actual.valid === expect.valid && sameCodes(actual.errorCodes, expect.errorCodes);
  if (pass && expect.concatenatedText !== undefined) {
    pass = actual.concatenatedText === expect.concatenatedText;
  }
  if (pass)
    pass = sameIds(actual.expressedDisclosureIds ?? [], expect.expressedDisclosureIds);
  if (pass)
    pass = sameIds(actual.expressedOutcomeIds ?? [], expect.expressedOutcomeIds);
  return { pass, actual };
}

function errorConstructorName(error) {
  return error && error.constructor ? error.constructor.name : String(error);
}

function runRepairInputCase(runtime, contexts, testCase) {
  const expect = testCase.expect;
  const trustedContext = resolveContext(contexts, testCase.trustedContext);
  const validationErrors = testCase.validationErrorCodes.map((code) =>
    runtime.buildValidationError(code, "$"),
  );
  const builder =
    testCase.task === "claim_normalization"
      ? runtime.buildClaimNormalizationRepairFromFailure
      : runtime.buildNpcDialogueRepairFromFailure;

  try {
    const repairInput = builder({
      failedAttemptKind: testCase.failedAttemptKind,
      trustedContext,
      rawInvalidOutput: testCase.rawInvalidOutput,
      validationErrors,
    });
    if (expect.throws) return { pass: false, actual: { threw: null } };
    let pass = true;
    if (expect.untrustedInvalidOutputEquals) {
      pass = pass && repairInput.untrusted_invalid_output === testCase.rawInvalidOutput;
    }
    if (expect.playerTextOmittedWhenUndefined) {
      pass = pass && !("untrusted_player_text" in repairInput);
    }
    return { pass, actual: { threw: null, repairInput } };
  } catch (error) {
    const name = errorConstructorName(error);
    return { pass: expect.throws === name, actual: { threw: name } };
  }
}

function runRepairRevalidateCase(runtime, contexts, testCase) {
  const expect = testCase.expect;
  const trustedContext = resolveContext(contexts, testCase.trustedContext);
  const result =
    testCase.task === "claim_normalization"
      ? runtime.validateClaimNormalization(testCase.repairedOutput, trustedContext)
      : runtime.validateNpcDialogueSelection(testCase.repairedOutput, trustedContext);
  const actual = { valid: result.valid, errorCodes: errorCodesOf(result) };
  const pass =
    actual.valid === expect.valid && sameCodes(actual.errorCodes, expect.errorCodes);
  return { pass, actual };
}

function runRepairFallbackCase(runtime, content, testCase) {
  const expect = testCase.expect;
  const registry = content.contentFor(testCase.contentVersion);
  try {
    const resolved = runtime.resolveFallbackLine(registry, testCase.lookup);
    if (expect.throws) return { pass: false, actual: { threw: null } };
    let pass = true;
    if (expect.textNotEmpty) {
      pass = pass && typeof resolved.text === "string" && resolved.text.length > 0;
    }
    return { pass, actual: { threw: null, text: resolved.text } };
  } catch (error) {
    const name = errorConstructorName(error);
    return { pass: expect.throws === name, actual: { threw: name } };
  }
}

export function runRepairCase(runtime, content, contexts, testCase) {
  if (testCase.mode === "repair_input")
    return runRepairInputCase(runtime, contexts, testCase);
  if (testCase.mode === "revalidate")
    return runRepairRevalidateCase(runtime, contexts, testCase);
  if (testCase.mode === "fallback")
    return runRepairFallbackCase(runtime, content, testCase);
  throw new Error(`Unknown repair fixture mode "${testCase.mode}"`);
}

export async function evaluateAll() {
  const [runtime, content] = await Promise.all([
    import("@the-town-remembers/model-runtime"),
    import("@the-town-remembers/content"),
  ]);

  const results = [];
  for (const family of FAMILIES) {
    const familyDir = path.join(EVALS_ROOT, family);
    const { contexts, cases } = loadFixtures(familyDir);
    for (const testCase of cases) {
      const outcome =
        family === "normalization"
          ? runNormalizationCase(runtime, contexts, testCase)
          : family === "dialogue"
            ? runDialogueCase(runtime, contexts, testCase)
            : runRepairCase(runtime, content, contexts, testCase);
      results.push({
        id: testCase.id,
        family,
        category: testCase.category,
        sourceFile: testCase.sourceFile,
        description: testCase.description,
        ...outcome,
      });
    }
  }
  return {
    results,
    versions: {
      promptVersions: runtime.PROMPT_VERSIONS,
      validationPolicyVersions: runtime.VALIDATION_POLICY_VERSIONS,
    },
  };
}

/**
 * Corpus-shape assertions -- every family present, every family carrying
 * both a control fixture and a known-failure/boundary fixture -- used to
 * live as a second real-corpus traversal in `prompts-eval.test.mjs`
 * (`VPR-04`). Folded into the runner's own single `evaluateAll()` result
 * instead, so the real fixture directory is only ever read once per
 * `pnpm validate` run, by `pnpm prompts:eval` itself.
 */
export function checkCorpusShape(evaluation) {
  const categoriesByFamily = new Map();
  for (const result of evaluation.results) {
    const categories = categoriesByFamily.get(result.family) ?? new Set();
    categories.add(result.category);
    categoriesByFamily.set(result.family, categories);
  }

  const problems = [];
  for (const family of FAMILIES) {
    const categories = categoriesByFamily.get(family);
    if (!categories) {
      problems.push(`expected at least one fixture for the "${family}" family`);
      continue;
    }
    if (!categories.has("control")) {
      problems.push(`expected a "control" category fixture for the "${family}" family`);
    }
    if (!categories.has("known_failure") && !categories.has("boundary")) {
      problems.push(
        `expected a "known_failure" or "boundary" category fixture for the "${family}" family`,
      );
    }
  }
  return problems;
}

/**
 * Reduced-cost (Haiku) dialogue may be selected only once every dialogue
 * fixture in the baseline passes -- structural/semantic validation is
 * model-agnostic, so "Haiku passes the same suite" means the baseline
 * carries no dialogue failure, not a second Haiku-specific fixture set.
 */
export function reducedCostDialogueAllowed(baseline) {
  if (!baseline) return false;
  const dialogueResults = baseline.results.filter(
    (result) => result.family === "dialogue",
  );
  return dialogueResults.length > 0 && dialogueResults.every((result) => result.pass);
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return undefined;
  return loadJson(BASELINE_PATH);
}

function writeBaseline(evaluation) {
  const baseline = {
    generatedAt: new Date().toISOString(),
    versions: evaluation.versions,
    results: evaluation.results.map(({ id, family, category, sourceFile, pass }) => ({
      id,
      family,
      category,
      sourceFile,
      pass,
    })),
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

/** The live warmup smoke `TTR_PROMPTS_EVAL_LIVE=1` runs after the deterministic fixtures. */
export async function runLiveWarmupSmoke() {
  const [{ loadModelConfig }, { createBedrockConverseClient }, { runPrewarmCommand }] =
    await Promise.all([
      import("@the-town-remembers/runtime-config/model"),
      import("@the-town-remembers/model-runtime"),
      import("@the-town-remembers/game-server"),
    ]);

  const config = loadModelConfig(process.env);
  const client = createBedrockConverseClient(config.region);
  return runPrewarmCommand({ client, config });
}

export function compareToBaseline(evaluation, baseline) {
  if (!baseline) return { regressions: [] };
  const byId = new Map(baseline.results.map((result) => [result.id, result]));
  const regressions = [];
  for (const result of evaluation.results) {
    const previous = byId.get(result.id);
    if (previous && previous.pass && !result.pass) regressions.push(result.id);
  }
  return { regressions };
}

async function runCli() {
  applyLocalDefaults();
  const updateBaseline = process.argv.includes("--update-baseline");
  const evaluation = await evaluateAll();
  const failures = evaluation.results.filter((result) => !result.pass);
  const shapeProblems = checkCorpusShape(evaluation);
  const baseline = loadBaseline();
  const { regressions } = compareToBaseline(evaluation, baseline);

  console.log(`Ran ${evaluation.results.length} prompt-evaluation fixture(s).`);
  for (const failure of failures) {
    console.error(
      `FAIL ${failure.family}/${failure.sourceFile} :: ${failure.id} -- ${failure.description}`,
    );
    console.error(`  actual: ${JSON.stringify(failure.actual)}`);
  }
  for (const problem of shapeProblems) {
    console.error(`Corpus shape: ${problem}`);
  }
  if (regressions.length > 0) {
    console.error(
      `Regression against baseline: ${regressions.join(", ")} previously passed and now fail.`,
    );
  }

  if (updateBaseline) {
    if (failures.length > 0 || shapeProblems.length > 0) {
      console.error(
        "Refusing to update the baseline while fixtures or corpus shape fail.",
      );
      process.exitCode = 1;
      return;
    }
    writeBaseline(evaluation);
    console.log(`Baseline written to ${path.relative(process.cwd(), BASELINE_PATH)}.`);
    return;
  }

  if (failures.length > 0 || shapeProblems.length > 0 || regressions.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(
    "All prompt-evaluation fixtures pass with no regression against the baseline.",
  );

  if (process.env["TTR_PROMPTS_EVAL_LIVE"] === "1") {
    console.log("\nRunning the live Bedrock warmup smoke (TTR_PROMPTS_EVAL_LIVE=1)...");
    const { results, allSucceeded } = await runLiveWarmupSmoke();
    for (const result of results) {
      const cost = (result.estimatedCostMicroUsd / 1_000_000).toFixed(6);
      console.log(
        `${result.outcome === "success" ? "ok  " : "FAIL"}  ${result.modelRole.padEnd(6)}  ${result.schema.padEnd(24)}  ${String(result.latencyMs).padStart(6)}ms  $${cost}`,
      );
    }
    if (!allSucceeded) {
      console.error("\nAt least one live warmup pair failed.");
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await runCli();
}
