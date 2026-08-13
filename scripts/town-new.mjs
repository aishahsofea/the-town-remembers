#!/usr/bin/env node

/**
 * Creates one joinable town through the real API and prints its invite URL.
 *
 * A convenience for playing the Phase 3 slice by hand: every other step of
 * that journey happens in the browser, but town creation is judge-authenticated
 * and deliberately has no screen (`apps/web` has eight routes, all of them
 * player-facing), so without this a contributor has to hand-assemble a curl
 * with four headers.
 *
 * It goes through `POST /api/v1/towns` rather than around it, so the creation
 * ledger, the rate limiter, and the versioned HMAC invite derivation all run
 * exactly as they do for a judge. That is what makes the printed invite
 * joinable, and it is the difference between this and `db-seed.mjs`, which
 * materializes a town directly with a random invite hash no plaintext maps to.
 *
 * Needs the pair from `pnpm dev` (or `pnpm dev --api-only`) already running.
 * Pass an idempotency key to replay an earlier creation: the same key returns
 * the same town instead of making a second one.
 */

import { randomUUID } from "node:crypto";
import process from "node:process";

import { applyLocalDefaults } from "./local-env.mjs";

/** Reads a variable that has no safe default, or explains where it comes from. */
function requireEnv(name) {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;

  throw new Error(
    `${name} is not set. Local work needs a real .env (copy .env.example); ` +
      `the security variables have no committed defaults on purpose.`,
  );
}

/** The problem body's own words, never a stack trace or a raw dependency message. */
function describeFailure(status, body) {
  try {
    const problem = JSON.parse(body);
    if (typeof problem.code === "string" && typeof problem.detail === "string") {
      return `${status} ${problem.code}: ${problem.detail}`;
    }
  } catch {
    // Not a problem document; fall through to the raw body.
  }
  return `${status}: ${body}`;
}

async function main() {
  applyLocalDefaults();

  const { loadTestConfig } = await import("@the-town-remembers/runtime-config/test");

  // Ports come from configuration rather than a literal, so this cannot
  // disagree with the adapter `pnpm dev` started.
  const { apiBaseUrl } = loadTestConfig(process.env);
  const appOrigin = requireEnv("TTR_APP_ORIGIN");
  const judgeCode = requireEnv("TTR_JUDGE_CODE");
  const idempotencyKey = process.argv[2] ?? randomUUID();

  let response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/towns`, {
      method: "POST",
      headers: {
        // The judge code authenticates this request and must never be
        // printed, logged, or echoed back into the terminal.
        authorization: `Bearer ${judgeCode}`,
        origin: appOrigin,
        "idempotency-key": idempotencyKey,
        "content-type": "application/json",
      },
      body: "{}",
    });
  } catch (cause) {
    throw new Error(
      `No API is listening on ${apiBaseUrl}. Start the pair with \`pnpm dev\` first.`,
      { cause },
    );
  }

  const body = await response.text();
  if (!response.ok) throw new Error(describeFailure(response.status, body));

  const { townId, status, inviteUrl } = JSON.parse(body);
  console.log(`town:    ${townId}`);
  console.log(`status:  ${status}`);
  console.log(`invite:  ${inviteUrl}`);
  console.log(`key:     ${idempotencyKey}`);
  console.log("");
  console.log("Open the invite in a browser to join as a player.");
  console.log(
    `Re-run with that key to replay this creation: pnpm town:new ${idempotencyKey}`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
