#!/usr/bin/env node

/**
 * Replays a named `packages/rules` scenario and prints its ordered plan and
 * digest as JSON. No server, no persistence, no database — a CLI in the
 * same family as `db-doctor.mjs`/`db-seed.mjs` (`D2-M`).
 *
 * Deterministic by construction: running the same scenario twice, in this
 * process or a clean child process, prints byte-identical output.
 */

import process from "node:process";

async function main() {
  const { SCENARIO_NAMES, computeScenarioDigest, runScenario } =
    await import("@the-town-remembers/rules");

  const requested = process.argv[2];
  const names = requested ? [requested] : SCENARIO_NAMES;

  for (const name of names) {
    if (!SCENARIO_NAMES.includes(name)) {
      console.error(
        `Unknown scenario "${name}". Known scenarios: ${SCENARIO_NAMES.join(", ")}.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const output = names.map((name) => ({
    name,
    steps: runScenario(name),
    digest: computeScenarioDigest(name),
  }));

  console.log(JSON.stringify(output, null, 2));
}

if (process.argv[1]?.endsWith("rules-scenario.mjs")) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
