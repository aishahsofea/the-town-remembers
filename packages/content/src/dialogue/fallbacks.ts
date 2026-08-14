/**
 * The authored fallback matrix for `bell-mystery-v1` (`D4-I`), transcribed
 * verbatim from Decision 009's "Authored fallback dialogue" and "Final
 * confrontation" sections.
 *
 * `FallbackLine`'s shape is structurally compatible with
 * `@the-town-remembers/rules`' `AuthoredFallbackLine` (`content-validation/
 * fallback-coverage.ts`), but this package cannot import that type —
 * `rules` depends on `content`, never the reverse. `gateResult` values here
 * must stay the exact strings `rules/kernel/gate-results.ts#GATE_RESULTS`
 * declares; `content/validate.ts` checks that membership statically.
 *
 * `actionKind`/`responseKind`/`gateResult` keying below is this session's
 * best-effort mapping of Decision 009's prose onto Decision 010's lookup
 * shape — Decision 009 predates that shape and never assigns it. `P4-09`
 * (whoever builds the real per-action requirement matrix from
 * `NpcContextBuilder`) should reconcile these keys against what actually
 * gets requested at runtime, using `assertFallbackCoverage`'s own missing-
 * requirement output as the guide, not by re-deriving this file from
 * scratch.
 */

import type { MechanicalOutcomeKind } from "./outcomes.js";

export interface FallbackLine {
  readonly npcKey: string;
  readonly actionKind: string;
  readonly responseKind: string;
  readonly gateResult: string;
  readonly outcomeIds: readonly MechanicalOutcomeKind[];
  readonly text: string;
}

/**
 * One generic line per NPC per action group, used when selection and repair
 * both fail but the deterministic gate itself raised no denial. Decision
 * 009's "Give or promise" column covers both the `give` and `accept_promise`
 * action kinds with the same authored line.
 */
export const GENERIC_ACTION_FALLBACKS: readonly FallbackLine[] = Object.freeze([
  {
    npcKey: "mara_venn",
    actionKind: "ask",
    responseKind: "deflect",
    gateResult: "passed",
    outcomeIds: [],
    text: "There is too much frightened talk already. Ask me about one thing at a time, and I will tell you what I can.",
  },
  {
    npcKey: "mara_venn",
    actionKind: "tell",
    responseKind: "acknowledge",
    gateResult: "passed",
    outcomeIds: [],
    text: "I heard you. I am not ready to say what I make of it.",
  },
  {
    npcKey: "mara_venn",
    actionKind: "show",
    responseKind: "acknowledge",
    gateResult: "passed",
    outcomeIds: [],
    text: "I can see why you brought that to me. Give me a moment before I answer.",
  },
  {
    npcKey: "mara_venn",
    actionKind: "give",
    responseKind: "refuse",
    gateResult: "passed",
    outcomeIds: [],
    text: "Keep hold of that for now. A promise or a possession should go to the right hands.",
  },
  {
    npcKey: "mara_venn",
    actionKind: "accept_promise",
    responseKind: "refuse",
    gateResult: "passed",
    outcomeIds: [],
    text: "Keep hold of that for now. A promise or a possession should go to the right hands.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "ask",
    responseKind: "deflect",
    gateResult: "passed",
    outcomeIds: [],
    text: "State the question plainly. I will answer what the inquiry permits.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "tell",
    responseKind: "acknowledge",
    gateResult: "passed",
    outcomeIds: [],
    text: "Your statement is heard. It is not yet proof.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "show",
    responseKind: "acknowledge",
    gateResult: "passed",
    outcomeIds: [],
    text: "I acknowledge the evidence. Do not mistake that for a conclusion.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "give",
    responseKind: "refuse",
    gateResult: "passed",
    outcomeIds: [],
    text: "Retain it until its owner and terms are clear.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "accept_promise",
    responseKind: "refuse",
    gateResult: "passed",
    outcomeIds: [],
    text: "Retain it until its owner and terms are clear.",
  },
  {
    npcKey: "nessa_reed",
    actionKind: "ask",
    responseKind: "deflect",
    gateResult: "passed",
    outcomeIds: [],
    text: "I will not guess. Ask for what I saw, what I heard, or what I concluded.",
  },
  {
    npcKey: "nessa_reed",
    actionKind: "tell",
    responseKind: "acknowledge",
    gateResult: "passed",
    outcomeIds: [],
    text: "I have heard the claim. Hearing is not the same as knowing.",
  },
  {
    npcKey: "nessa_reed",
    actionKind: "show",
    responseKind: "acknowledge",
    gateResult: "passed",
    outcomeIds: [],
    text: "That is evidence. I will weigh it against what I observed.",
  },
  {
    npcKey: "nessa_reed",
    actionKind: "give",
    responseKind: "refuse",
    gateResult: "passed",
    outcomeIds: [],
    text: "I will take it only if it belongs with me and the terms are exact.",
  },
  {
    npcKey: "nessa_reed",
    actionKind: "accept_promise",
    responseKind: "refuse",
    gateResult: "passed",
    outcomeIds: [],
    text: "I will take it only if it belongs with me and the terms are exact.",
  },
] as const);

/**
 * Situation-specific denials. The first three are content-specific to one
 * NPC; the last three are phrased NPC-neutrally in Decision 009, so each
 * gets one entry per NPC rather than an invented per-NPC variation the
 * source never wrote.
 */
export const SITUATIONAL_DENIALS: readonly FallbackLine[] = Object.freeze([
  ...(
    [
      [
        "mara_venn",
        "There is too much frightened talk already. Ask me about one thing at a time, and I will tell you what I can.",
      ],
      [
        "corin_hale",
        "State the question plainly. I will answer what the inquiry permits.",
      ],
      [
        "nessa_reed",
        "I will not guess. Ask for what I saw, what I heard, or what I concluded.",
      ],
    ] as const
  ).map(([npcKey, text]): FallbackLine => ({
    npcKey,
    actionKind: "ask",
    responseKind: "deflect",
    gateResult: "no_disclosure_available",
    outcomeIds: [],
    text,
  })),
  {
    npcKey: "nessa_reed",
    actionKind: "accept_promise",
    responseKind: "refuse",
    // Insufficient trust/suspicion to extend the offer at all — distinct
    // from OUTCOME_FALLBACKS' "promise offer became stale" (a previously
    // valid offer whose context changed before acceptance), which uses
    // denied_promise_context; keeping the two gate results different avoids
    // colliding on the same (npc, action, responseKind, gateResult) key.
    gateResult: "denied_access",
    outcomeIds: [],
    text: "I do not lend the chapel key on urgency alone.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "show",
    responseKind: "refuse",
    gateResult: "denied_access",
    outcomeIds: [],
    text: "You have not shown me enough to justify opening a sealed place.",
  },
  {
    npcKey: "mara_venn",
    actionKind: "ask",
    responseKind: "refuse",
    gateResult: "denied_disclosure_tier",
    outcomeIds: [],
    text: "Some matters are not mine to scatter through the town.",
  },
  ...(["mara_venn", "corin_hale", "nessa_reed"] as const).map(
    (npcKey): FallbackLine => ({
      npcKey,
      actionKind: "give",
      responseKind: "refuse",
      gateResult: "denied_custody",
      outcomeIds: [],
      text: "That item should remain with its present keeper.",
    }),
  ),
  ...(["mara_venn", "corin_hale", "nessa_reed"] as const).map(
    (npcKey): FallbackLine => ({
      npcKey,
      actionKind: "accept_promise",
      responseKind: "refuse",
      gateResult: "denied_promise_context",
      outcomeIds: [],
      text: "The circumstances have changed; I cannot ask that promise of you now.",
    }),
  ),
  ...(["mara_venn", "corin_hale", "nessa_reed"] as const).map(
    (npcKey): FallbackLine => ({
      npcKey,
      actionKind: "ask",
      responseKind: "refuse",
      gateResult: "town_frozen",
      outcomeIds: [],
      text: "The evidence is assembled. Nothing more changes until the town chooses.",
    }),
  ),
] as const);

/** Successful mechanical outcomes use an exact outcome-specific line rather than a generic one. */
export const OUTCOME_FALLBACKS: readonly FallbackLine[] = Object.freeze([
  ...(["mara_venn", "corin_hale", "nessa_reed"] as const).map(
    (npcKey): FallbackLine => ({
      npcKey,
      actionKind: "give",
      responseKind: "acknowledge",
      gateResult: "passed",
      outcomeIds: ["requested_item_received"],
      text: "I have it now.",
    }),
  ),
  {
    npcKey: "nessa_reed",
    actionKind: "accept_promise",
    responseKind: "answer",
    gateResult: "passed",
    outcomeIds: ["chapel_key_lent"],
    text: "Take the chapel key. Bring it back when the inquiry is settled.",
  },
  {
    npcKey: "corin_hale",
    actionKind: "show",
    responseKind: "answer",
    gateResult: "passed",
    outcomeIds: ["chapel_access_granted"],
    text: "You have shown enough. The chapel is open to you.",
  },
  {
    npcKey: "mara_venn",
    actionKind: "accept_promise",
    responseKind: "answer",
    gateResult: "passed",
    outcomeIds: ["keep_secret_promise_accepted"],
    text: "Your promise is recorded.",
  },
] as const);

/**
 * Corin's authored fallback confession, used when all four final-truth
 * disclosures (`lark_damaged_bell`, `corin_moved_bell`, `bell_at_chapel`,
 * `corin_protected_lark`) are required at once. Transcribed verbatim from
 * Decision 009's "Final confrontation" section.
 */
export const CORIN_FALLBACK_CONFESSION: FallbackLine = Object.freeze({
  npcKey: "corin_hale",
  actionKind: "ask",
  responseKind: "answer",
  gateResult: "passed",
  outcomeIds: [],
  text:
    "Lark damaged the bell by accident, and I moved it to the Old Chapel before the " +
    "council could see it because I meant to protect her. I told myself I was " +
    "preserving order. I was hiding the truth.",
});

export const ALL_FALLBACK_LINES: readonly FallbackLine[] = Object.freeze([
  ...GENERIC_ACTION_FALLBACKS,
  ...SITUATIONAL_DENIALS,
  ...OUTCOME_FALLBACKS,
  CORIN_FALLBACK_CONFESSION,
]);
