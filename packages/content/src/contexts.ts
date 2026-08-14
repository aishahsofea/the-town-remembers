/**
 * The three claim contexts Decision 010 names for claim normalization's
 * `trusted_context.allowed_contexts`: `festival_night` (the default),
 * `festival_morning`, and `current`. A player statement with no temporal
 * phrase normalizes to `defaultContextKey`; one naming an unsupported time
 * is `unsupported_context`, never invented.
 *
 * `displayLabel` is deterministic, non-model presentation copy for
 * `content/claim-sentence.ts` — never sent to or read from Bedrock.
 */

import { normalizeAlias } from "./alias.js";

export interface ClaimContext {
  readonly contextKey: string;
  readonly aliases: readonly string[];
  readonly displayLabel: string;
}

export const DEFAULT_CONTEXT_KEY = "festival_night";

export const CLAIM_CONTEXTS: readonly ClaimContext[] = Object.freeze([
  {
    contextKey: "festival_night",
    aliases: [
      "tonight",
      "festival night",
      "last night",
      "the night of the festival",
    ].map(normalizeAlias),
    displayLabel: "on festival night",
  },
  {
    contextKey: "festival_morning",
    aliases: ["this morning", "festival morning", "dawn", "at dawn"].map(
      normalizeAlias,
    ),
    displayLabel: "on festival morning",
  },
  {
    contextKey: "current",
    aliases: ["now", "currently", "right now", "at present"].map(normalizeAlias),
    displayLabel: "currently",
  },
] as const);
