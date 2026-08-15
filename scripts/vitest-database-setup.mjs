/**
 * Global setup for the `database` vitest project.
 *
 * The suite needs a real CockroachDB node, so it starts the pinned one rather
 * than asking a developer to remember. Starting is idempotent: an already
 * running node is reused, and CI gets the same behavior as a laptop.
 *
 * Opting out is possible and deliberate — a contributor without the binary can
 * still run the rest of the suite — but the flag is refused when the exit gate
 * declares the database suite required, so `pnpm validate` cannot pass by
 * skipping the part of Phase 1 that matters most.
 *
 * This also claims the database-suite ownership lock (`db-suite-lock.mjs`)
 * for the lifetime of the run, so `pnpm test:db` and the database project
 * inside `pnpm test` cannot silently migrate against the same local node at
 * once — one of them now fails fast with a diagnostic instead of both
 * stalling into a timeout.
 */

import process from "node:process";

import { start } from "./cockroach.mjs";
import { acquire, release } from "./db-suite-lock.mjs";
import { applyLocalDefaults } from "./local-env.mjs";

export default async function setup() {
  applyLocalDefaults();

  const skip = process.env.TTR_SKIP_DB_TESTS === "1";
  const required = process.env.TTR_REQUIRE_DB_TESTS === "1";

  if (skip && required) {
    throw new Error(
      "TTR_SKIP_DB_TESTS is set while the database suite is required by the gate.",
    );
  }
  if (skip) {
    console.warn("Skipping database tests: TTR_SKIP_DB_TESTS=1");
    return;
  }

  const owner = acquire(process.env.npm_lifecycle_event ?? "vitest:database");
  try {
    await start({ log: () => undefined });
  } catch (error) {
    release(owner);
    throw error;
  }

  return () => {
    release(owner);
  };
}
