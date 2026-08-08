#!/usr/bin/env node

/**
 * Creates one `bell-mystery-v1` town for local inspection.
 *
 * Test-only, and deliberately unable to become anything else: it stores a
 * random 32-byte invite hash that no plaintext maps to, so the town it makes
 * cannot be joined. Production and demo towns come from the Phase 3
 * town-creation ledger, which derives a real invite from the application
 * security secret.
 *
 * The output is the opaque town ID and a safe summary — counts, sequence
 * boundaries, and belief labels. Nothing printed here authenticates anyone.
 */

import { randomBytes } from "node:crypto";
import process from "node:process";

import { applyLocalDefaults } from "./local-env.mjs";

async function main() {
  applyLocalDefaults();

  const { createOperatorPool } = await import("@the-town-remembers/database-admin");
  const { materializeTown, summarizeTown } =
    await import("@the-town-remembers/town-seed");

  const pool = createOperatorPool(process.env, { applicationName: "ttr-seed" });
  try {
    const result = await materializeTown(pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: randomBytes(32),
    });

    if (result.outcome !== "committed") {
      console.error(
        "The seed transaction was acknowledged ambiguously. Read the towns table " +
          "before running this again.",
      );
      process.exitCode = 1;
      return;
    }

    const summary = await summarizeTown(pool, result.value.townId);
    console.log(`town: ${summary.townId}`);
    console.log(`content: ${summary.contentVersion}`);
    console.log(
      `events: ${summary.lastEventSequence} ` +
        `(ambient scheduled through ${summary.ambientScheduledThroughSequence})`,
    );
    for (const [table, count] of Object.entries(summary.counts)) {
      if (count > 0) console.log(`  ${table}: ${count}`);
    }
    console.log("beliefs:");
    for (const belief of summary.beliefs) console.log(`  ${belief}`);
  } finally {
    await pool.end();
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
