/**
 * Stable mechanical-outcome-kind identifiers for `bell-mystery-v1`'s NPC
 * dialogue (`D4-I`). Decision 010's `approved_outcomes`/`required_outcome_ids`
 * are ephemeral, bundle-local IDs assigned at runtime (`D4-H`) — these are a
 * separate, small, content-level vocabulary naming *which kind* of already
 * committed-or-predicted mechanical result a template or fallback line
 * expresses, so `fallbacks.ts` and `templates.ts` can agree on one spelling
 * per outcome without either depending on a runtime bundle to exist.
 */

export const MECHANICAL_OUTCOME_KINDS = [
  "requested_item_received",
  "chapel_key_lent",
  "chapel_access_granted",
  "keep_secret_promise_accepted",
] as const;

export type MechanicalOutcomeKind = (typeof MECHANICAL_OUTCOME_KINDS)[number];
