#!/usr/bin/env node

/**
 * Stage-level timing for `pnpm validate`.
 *
 * `validate` is one long `&&` chain, so today the only way to know which
 * stage is slow is to guess or add throwaway `time` calls. This runs the
 * same stages, in the same order, and records monotonic elapsed time and
 * exit status for each one — so later work removing duplication
 * (`VPR-03`–`VPR-13`) has a real before/after number instead of a feeling.
 *
 * It does not replace `pnpm validate`; it mirrors it. Keep the stage list
 * below in sync with `package.json#validate` by hand — a config test cannot
 * parse a shell `&&` chain reliably, and the two are meant to be reviewed
 * together whenever either changes.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { assertNoActiveOwner } from "./db-suite-lock.mjs";
import { REPOSITORY_ROOT, applyLocalDefaults } from "./local-env.mjs";

export const STAGES = Object.freeze([
  { name: "format:check", script: "format:check" },
  { name: "check:source-text", script: "check:source-text" },
  { name: "check:boundaries", script: "check:boundaries" },
  { name: "check:assets", script: "check:assets" },
  { name: "typecheck", script: "typecheck" },
  { name: "test:tooling", script: "test:tooling" },
  { name: "lint", script: "lint" },
  {
    name: "test",
    script: "test",
    env: { TTR_REQUIRE_DB_TESTS: "1" },
    touchesDatabase: true,
  },
  { name: "prompts:eval", script: "prompts:eval" },
  { name: "build", script: "build" },
  { name: "check:bundle", script: "check:bundle" },
  { name: "cdk:synth", script: "cdk:synth" },
  { name: "test:e2e", script: "test:e2e", touchesDatabase: true },
]);

const OUTPUT_DIR = path.join(REPOSITORY_ROOT, ".cache");

function defaultSpawn(script, env) {
  return spawnSync("pnpm", ["run", script], {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
    env,
    shell: false,
  });
}

/**
 * Runs every stage in order, stopping at the first failure (fail-fast, same
 * as the `&&` chain it mirrors). `spawnFn` and `checkNoActiveOwner` are
 * injectable so this can be unit-tested without ever shelling out.
 */
export function runProfile({
  stages = STAGES,
  env = process.env,
  spawnFn = defaultSpawn,
  checkNoActiveOwner = assertNoActiveOwner,
  now = () => process.hrtime.bigint(),
} = {}) {
  const results = [];
  let exitCode = 0;

  for (const stage of stages) {
    if (stage.touchesDatabase) {
      try {
        checkNoActiveOwner();
      } catch (error) {
        results.push({
          name: stage.name,
          status: "blocked",
          exitCode: null,
          durationMs: 0,
          message: error instanceof Error ? error.message : String(error),
        });
        exitCode = 1;
        break;
      }
    }

    const start = now();
    const result = spawnFn(stage.script, { ...env, ...stage.env });
    const durationMs = Number(now() - start) / 1_000_000;
    const stageExitCode = result.status ?? (result.signal ? 1 : 0);
    const status = stageExitCode === 0 ? "passed" : "failed";
    results.push({ name: stage.name, status, exitCode: stageExitCode, durationMs });

    if (stageExitCode !== 0) {
      exitCode = stageExitCode;
      break;
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    ok: exitCode === 0,
    stages: results,
    totalDurationMs: results.reduce((sum, stage) => sum + stage.durationMs, 0),
  };

  return { summary, exitCode };
}

export function formatTable(summary) {
  const nameWidth = Math.max(4, ...summary.stages.map((stage) => stage.name.length));
  const lines = [
    `${"stage".padEnd(nameWidth)}  status   duration`,
    `${"-".repeat(nameWidth)}  ------   --------`,
  ];
  for (const stage of summary.stages) {
    const seconds = (stage.durationMs / 1000).toFixed(2);
    lines.push(
      `${stage.name.padEnd(nameWidth)}  ${stage.status.padEnd(7)}  ${seconds}s`,
    );
  }
  lines.push(`${"-".repeat(nameWidth)}  ------   --------`);
  lines.push(
    `${"total".padEnd(nameWidth)}  ${summary.ok ? "passed " : "failed "}  ${(summary.totalDurationMs / 1000).toFixed(2)}s`,
  );
  return lines.join("\n");
}

export function writeSummary(summary, { outDir = OUTPUT_DIR, label } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const suffix = label ? `-${label}` : "";
  const fileName = `validate-profile${suffix}-${summary.generatedAt.replace(/[:.]/g, "-")}.json`;
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify({ ...summary, label }, null, 2)}\n`);
  return filePath;
}

function parseArgs(argv) {
  const label = argv.includes("--label")
    ? argv[argv.indexOf("--label") + 1]
    : undefined;
  if (label !== undefined && label !== "cold" && label !== "warm") {
    throw new Error(`--label must be "cold" or "warm", got ${JSON.stringify(label)}.`);
  }
  return { label };
}

async function main() {
  applyLocalDefaults();
  const { label } = parseArgs(process.argv.slice(2));

  const { summary, exitCode } = runProfile();
  console.log(formatTable(summary));

  const filePath = writeSummary(summary, { label });
  console.log(`\nWrote ${path.relative(REPOSITORY_ROOT, filePath)}`);

  process.exitCode = exitCode;
}

if (process.argv[1]?.endsWith("validate-profile.mjs")) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
