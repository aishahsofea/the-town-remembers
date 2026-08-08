/**
 * Frozen version identities.
 *
 * A town stores `content_version`, and that one string identifies both the
 * authored seed and the rules the town plays by. Numerical ledger rows still
 * store `rule_version` separately because Decision 008 requires every
 * contribution to name the rules that produced it.
 */

export const CONTENT_VERSION = "bell-mystery-v1";
export const RULES_VERSION = "mvp-rules-v1";

/**
 * Promise terms are versioned independently of content, because a retained
 * offer or an active promise must keep resolving under the terms it was
 * accepted under. Content cleanup may not remove an evaluator while either
 * still references its version.
 */
export const PROMISE_TERMS = Object.freeze({
  keepLarkAccidentSecret: Object.freeze({
    termsVersion: "keep-lark-accident-secret-v1",
    kind: "keep_secret" as const,
    npcKey: "mara_venn",
    subjectClaimKey: "lark_damaged_bell",
    summary: "Promise Mara you will not repeat that Lark damaged the bell.",
  }),
  returnChapelKey: Object.freeze({
    termsVersion: "return-chapel-key-v1",
    kind: "return_item" as const,
    npcKey: "nessa_reed",
    subjectItemKey: "old_chapel_key",
    summary: "I will lend you the Old Chapel key if you promise to return it to me.",
  }),
});

/**
 * The claims whose ambient NPC-to-NPC propagation the epilogue counts. Player
 * testimony and seeded pre-story conversation deliberately do not count.
 */
export const ENDING_FALSE_CLAIM_KEYS: readonly string[] = Object.freeze([
  "corin_acted_for_safety",
  "bell_at_reeds_garden",
  "lark_did_not_damage_bell",
]);
