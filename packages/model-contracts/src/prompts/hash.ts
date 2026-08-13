/**
 * `D4-T` prompt hashing.
 *
 * A non-repair run hashes the exact system text alone. A repair run's system
 * message is two blocks — the exact target-task prompt, then the exact repair
 * overlay — so its hash must bind both, in order, without ambiguity. The
 * canonical form for that pair is `["<target>","<overlay>"]`: for a flat
 * two-string array there is no object-key ordering to disambiguate, so
 * `JSON.stringify` already produces the same bytes
 * `@the-town-remembers/serialization#canonicalJson` would. This module stays
 * dependency-free apart from `zod` (`D4-B`) by relying on that equivalence
 * instead of importing the shared helper.
 */

import { createHash } from "node:crypto";

/** SHA-256 of the exact system prompt text, in UTF-8. Matches `ck_agent_runs__prompt_sha256_length` (32 bytes). */
export function promptHash(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/**
 * SHA-256 over the canonical JSON array `[targetText, overlayText]`, target
 * prompt first. Differs from both `promptHash(targetText)`/
 * `promptHash(overlayText)` and from `promptHash(targetText + overlayText)`.
 */
export function repairPromptHash(targetText: string, overlayText: string): Buffer {
  const canonicalPair = JSON.stringify([targetText, overlayText]);
  return createHash("sha256").update(canonicalPair, "utf8").digest();
}
