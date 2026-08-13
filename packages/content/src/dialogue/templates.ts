/**
 * The rendering-template corpus for `bell-mystery-v1` (`D4-I`, `P4-03a`).
 *
 * §1.1 of the Phase 4 execution plan found that no earlier phase authored
 * any of this: `packages/content/src` had disclosures and a fallback matrix
 * in prose (Decision 009) but zero rendering templates. This module is that
 * missing corpus — the "safe voiced alternatives" Decision 010 says a
 * versioned authored template generates, which Sonnet then selects and
 * orders but never writes itself.
 *
 * Every template is closed prose: no placeholder appears anywhere in this
 * file (the closed grammar — `{claim}`, `{entity}`, `{actor}`, `{item}`,
 * `{clue}` — exists for future authored lines that need to bind canonical
 * values, but this fixed-canon mystery's disclosures don't vary per player
 * or session, so hardcoded prose is both the most faithful transcription of
 * Decision 009's authored facts and the safest — nothing to bind wrong).
 * `content/validate.ts` checks the placeholder set is closed regardless.
 *
 * `DISCLOSURE_TIER_TABLE` is the authorization allowlist Decision 009's own
 * "Disclosure tiers" section states, transcribed once. Every disclosure
 * template's `(npcKey, claimKey)` must appear in it — this is what makes
 * "Mara's corpus contains no chapel location" and "Nessa's corpus contains
 * no cart-load truth" checkable by construction (Mara's and Nessa's rows
 * never include Corin's final-truth claims) rather than by hoping a
 * keyword scan catches every phrasing.
 */

export type DialogueTier =
  "public" | "guarded" | "confidential" | "cover_story" | "final_truth";

export interface DisclosureTierBinding {
  readonly npcKey: string;
  readonly claimKey: string;
  readonly tier: DialogueTier;
  /** Decision 009's own framing note, when one (npc, claim) pair is authored at two tiers under different framing. */
  readonly framing?: string;
}

export const DISCLOSURE_TIER_TABLE: readonly DisclosureTierBinding[] = Object.freeze([
  { npcKey: "mara_venn", claimKey: "bell_not_at_square", tier: "public" },
  { npcKey: "mara_venn", claimKey: "corin_was_at_inn", tier: "guarded" },
  {
    npcKey: "mara_venn",
    claimKey: "corin_protected_lark",
    tier: "guarded",
    framing: "an incomplete offer of help",
  },
  { npcKey: "mara_venn", claimKey: "lark_damaged_bell", tier: "confidential" },
  {
    npcKey: "mara_venn",
    claimKey: "corin_protected_lark",
    tier: "confidential",
    framing: "Lark's protection motive",
  },
  { npcKey: "nessa_reed", claimKey: "bell_not_at_square", tier: "public" },
  { npcKey: "nessa_reed", claimKey: "corin_was_at_chapel", tier: "guarded" },
  {
    npcKey: "nessa_reed",
    claimKey: "corin_acted_for_safety",
    tier: "guarded",
    framing: "explicitly framed as interpretation",
  },
  { npcKey: "corin_hale", claimKey: "bell_not_at_square", tier: "public" },
  { npcKey: "corin_hale", claimKey: "corin_acted_for_safety", tier: "cover_story" },
  { npcKey: "corin_hale", claimKey: "lark_damaged_bell", tier: "final_truth" },
  { npcKey: "corin_hale", claimKey: "corin_moved_bell", tier: "final_truth" },
  { npcKey: "corin_hale", claimKey: "bell_at_chapel", tier: "final_truth" },
  { npcKey: "corin_hale", claimKey: "corin_protected_lark", tier: "final_truth" },
] as const);

export interface DisclosureTemplate {
  readonly templateKey: string;
  readonly npcKey: string;
  readonly claimKey: string;
  readonly tier: DialogueTier;
  readonly responseKind: string;
  readonly text: string;
  readonly styleTags: readonly string[];
}

export const DISCLOSURE_TEMPLATES: readonly DisclosureTemplate[] = Object.freeze([
  // --- Mara: public — bell_not_at_square ------------------------------
  {
    templateKey: "mara_public_bell_not_at_square_1",
    npcKey: "mara_venn",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "The bell's gone from the square, plain as that. Lark's resting — she's not seeing anyone just now.",
    styleTags: ["plain"],
  },
  {
    templateKey: "mara_public_bell_not_at_square_2",
    npcKey: "mara_venn",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "There's no bell at the frame this morning, and no music either. Lark needs her rest, so I'll speak for the inn today.",
    styleTags: ["warm"],
  },
  {
    templateKey: "mara_public_bell_not_at_square_3",
    npcKey: "mara_venn",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "You can see for yourself — the square's bell-less. Lark's indoors, resting, and I'd rather she stayed that way.",
    styleTags: ["protective"],
  },
  // --- Mara: guarded — corin_was_at_inn -------------------------------
  {
    templateKey: "mara_guarded_corin_was_at_inn_1",
    npcKey: "mara_venn",
    claimKey: "corin_was_at_inn",
    tier: "guarded",
    responseKind: "answer",
    text: "Corin came through before dawn, quiet about it. He asked me to keep Lark inside while he sorted the bell out himself.",
    styleTags: ["plain"],
  },
  {
    templateKey: "mara_guarded_corin_was_at_inn_2",
    npcKey: "mara_venn",
    claimKey: "corin_was_at_inn",
    tier: "guarded",
    responseKind: "answer",
    text: "Yes, he was here — slipped in before first light, said he'd handle the bell, and asked me to keep my sister indoors.",
    styleTags: ["quick"],
  },
  {
    templateKey: "mara_guarded_corin_was_at_inn_3",
    npcKey: "mara_venn",
    claimKey: "corin_was_at_inn",
    tier: "guarded",
    responseKind: "answer",
    text: "He stopped at the inn early, before the square woke up. Wanted Lark kept in, and said the bell was his to manage.",
    styleTags: ["observant"],
  },
  // --- Mara: guarded — corin_protected_lark, framed as an incomplete offer of help
  {
    templateKey: "mara_guarded_corin_protected_lark_1",
    npcKey: "mara_venn",
    claimKey: "corin_protected_lark",
    tier: "guarded",
    responseKind: "answer",
    text: "He said he'd see that Lark wasn't blamed for anything. He wouldn't say more than that, not to me, not then.",
    styleTags: ["guarded"],
  },
  {
    templateKey: "mara_guarded_corin_protected_lark_2",
    npcKey: "mara_venn",
    claimKey: "corin_protected_lark",
    tier: "guarded",
    responseKind: "answer",
    text: "Corin told me he'd keep trouble off my sister. That's as far as the guarded version goes, and I'm not pushing it further here.",
    styleTags: ["unfinished"],
  },
  // --- Mara: confidential — lark_damaged_bell -------------------------
  {
    templateKey: "mara_confidential_lark_damaged_bell_1",
    npcKey: "mara_venn",
    claimKey: "lark_damaged_bell",
    tier: "confidential",
    responseKind: "answer",
    text: "It was Lark. The clapper pin, the rope — she was fixing it alone and the bell swung wrong. I need you to hold that quietly.",
    styleTags: ["confidential"],
  },
  {
    templateKey: "mara_confidential_lark_damaged_bell_2",
    npcKey: "mara_venn",
    claimKey: "lark_damaged_bell",
    tier: "confidential",
    responseKind: "answer",
    text: "My sister damaged it, working the repair by herself before anyone else was up. Corin knows. I'm trusting you with this.",
    styleTags: ["personal"],
  },
  {
    templateKey: "mara_confidential_lark_damaged_bell_3",
    npcKey: "mara_venn",
    claimKey: "lark_damaged_bell",
    tier: "confidential",
    responseKind: "answer",
    text: "The truth is Lark's hands were on that bell when it cracked. She didn't mean it. I'm asking you to carry that carefully.",
    styleTags: ["nervous"],
  },
  // --- Mara: confidential — corin_protected_lark, framed as Lark's protection motive
  {
    templateKey: "mara_confidential_corin_protected_lark_1",
    npcKey: "mara_venn",
    claimKey: "corin_protected_lark",
    tier: "confidential",
    responseKind: "answer",
    text: "Corin did what he did to protect her — that's the whole of his reason, not some tale about public safety.",
    styleTags: ["confidential"],
  },
  {
    templateKey: "mara_confidential_corin_protected_lark_2",
    npcKey: "mara_venn",
    claimKey: "corin_protected_lark",
    tier: "confidential",
    responseKind: "answer",
    text: "Whatever story is going around, Corin's real motive was Lark. Protecting her, nothing grander.",
    styleTags: ["plain"],
  },
  // --- Nessa: public — bell_not_at_square ------------------------------
  {
    templateKey: "nessa_public_bell_not_at_square_1",
    npcKey: "nessa_reed",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "The bell's missing from the square, that much I saw myself. I still hold the chapel key, and the door stays locked.",
    styleTags: ["exact"],
  },
  {
    templateKey: "nessa_public_bell_not_at_square_2",
    npcKey: "nessa_reed",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "No bell at the frame — I confirmed that with my own eyes. I lost my field lens near the square benches, if you're wondering.",
    styleTags: ["sensory"],
  },
  {
    templateKey: "nessa_public_bell_not_at_square_3",
    npcKey: "nessa_reed",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "The square's empty of its bell. I keep the chapel key close, and the chapel door hasn't opened for anyone.",
    styleTags: ["measured"],
  },
  // --- Nessa: guarded — corin_was_at_chapel ----------------------------
  {
    templateKey: "nessa_guarded_corin_was_at_chapel_1",
    npcKey: "nessa_reed",
    claimKey: "corin_was_at_chapel",
    tier: "guarded",
    responseKind: "answer",
    text: "I saw Corin's cart go through the chapel gate, covered over. He returned my key to me after.",
    styleTags: ["observed"],
  },
  {
    templateKey: "nessa_guarded_corin_was_at_chapel_2",
    npcKey: "nessa_reed",
    claimKey: "corin_was_at_chapel",
    tier: "guarded",
    responseKind: "answer",
    text: "He came through with the guard cart, something under a cover, and passed the chapel gate. My key came back to me later that morning.",
    styleTags: ["exact"],
  },
  {
    templateKey: "nessa_guarded_corin_was_at_chapel_3",
    npcKey: "nessa_reed",
    claimKey: "corin_was_at_chapel",
    tier: "guarded",
    responseKind: "answer",
    text: "What I observed: Corin, the handcart, a covering I couldn't see under, and the chapel gate. The key was returned to me afterward.",
    styleTags: ["sensory"],
  },
  // --- Nessa: guarded — corin_acted_for_safety, explicitly interpretation
  {
    templateKey: "nessa_guarded_corin_acted_for_safety_1",
    npcKey: "nessa_reed",
    claimKey: "corin_acted_for_safety",
    tier: "guarded",
    responseKind: "answer",
    text: "He told me he needed the chapel open for public safety — that's what he said, and I lean toward believing it, though I didn't see the reason myself.",
    styleTags: ["self-correcting"],
  },
  {
    templateKey: "nessa_guarded_corin_acted_for_safety_2",
    npcKey: "nessa_reed",
    claimKey: "corin_acted_for_safety",
    tier: "guarded",
    responseKind: "answer",
    text: "Corin's word was that something dangerous needed moving before the festival. I'm inclined to accept that, but it's his account, not my observation.",
    styleTags: ["measured"],
  },
  {
    templateKey: "nessa_guarded_corin_acted_for_safety_3",
    npcKey: "nessa_reed",
    claimKey: "corin_acted_for_safety",
    tier: "guarded",
    responseKind: "answer",
    text: "By his own account, it was a safety matter. I find that plausible, but I want to be clear — that's interpretation on my part, not something I witnessed.",
    styleTags: ["self-correcting"],
  },
  // --- Corin: public — bell_not_at_square ------------------------------
  {
    templateKey: "corin_public_bell_not_at_square_1",
    npcKey: "corin_hale",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "The bell is gone from its frame, and the festival is suspended until the inquiry concludes.",
    styleTags: ["formal"],
  },
  {
    templateKey: "corin_public_bell_not_at_square_2",
    npcKey: "corin_hale",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "You can see the frame is empty. The festival stays paused while this is investigated.",
    styleTags: ["economical"],
  },
  {
    templateKey: "corin_public_bell_not_at_square_3",
    npcKey: "corin_hale",
    claimKey: "bell_not_at_square",
    tier: "public",
    responseKind: "answer",
    text: "The bell is missing, and by my authority the festival does not resume until that changes.",
    styleTags: ["precise"],
  },
  // --- Corin: cover_story — corin_acted_for_safety ---------------------
  {
    templateKey: "corin_cover_story_corin_acted_for_safety_1",
    npcKey: "corin_hale",
    claimKey: "corin_acted_for_safety",
    tier: "cover_story",
    responseKind: "answer",
    text: "I acted to prevent a public accident. The bell has been secured — I will not say where, only that it is safe.",
    styleTags: ["formal"],
  },
  {
    templateKey: "corin_cover_story_corin_acted_for_safety_2",
    npcKey: "corin_hale",
    claimKey: "corin_acted_for_safety",
    tier: "cover_story",
    responseKind: "answer",
    text: "A dangerous bell before a crowded festival is a hazard I would not permit. I secured it. Its location is not yet for public record.",
    styleTags: ["precise"],
  },
  {
    templateKey: "corin_cover_story_corin_acted_for_safety_3",
    npcKey: "corin_hale",
    claimKey: "corin_acted_for_safety",
    tier: "cover_story",
    responseKind: "answer",
    text: "I judged the bell unsafe to remain where it was, so I moved to secure it. That is the whole of what I will confirm today.",
    styleTags: ["economical"],
  },
] as const);

/**
 * Corin's final-truth confession. Docs/009 states this covers all four
 * approved final-truth disclosures (`lark_damaged_bell`, `corin_moved_bell`,
 * `bell_at_chapel`, `corin_protected_lark`) as one combined event, not four
 * separate one-claim lines — a distinct shape from `DisclosureTemplate`.
 */
export interface ConfessionTemplate {
  readonly templateKey: string;
  readonly npcKey: "corin_hale";
  readonly claimKeys: readonly [
    "lark_damaged_bell",
    "corin_moved_bell",
    "bell_at_chapel",
    "corin_protected_lark",
  ];
  readonly responseKind: string;
  readonly text: string;
  readonly styleTags: readonly string[];
}

const FINAL_TRUTH_CLAIM_KEYS = [
  "lark_damaged_bell",
  "corin_moved_bell",
  "bell_at_chapel",
  "corin_protected_lark",
] as const;

export const CONFESSION_TEMPLATES: readonly ConfessionTemplate[] = Object.freeze([
  {
    templateKey: "corin_final_truth_confession_1",
    npcKey: "corin_hale",
    claimKeys: FINAL_TRUTH_CLAIM_KEYS,
    responseKind: "answer",
    text:
      "Lark damaged the bell by accident, and I moved it to the Old Chapel before the " +
      "council could see it because I meant to protect her. I told myself I was " +
      "preserving order. I was hiding the truth.",
    styleTags: ["formal", "confessional"],
  },
  {
    templateKey: "corin_final_truth_confession_2",
    npcKey: "corin_hale",
    claimKeys: FINAL_TRUTH_CLAIM_KEYS,
    responseKind: "answer",
    text:
      "It was Lark — an accident at the rope, nothing more. I moved the bell to the Old " +
      "Chapel myself, before dawn, because I would not let her carry the blame. I " +
      "called it order. It was concealment.",
    styleTags: ["economical", "confessional"],
  },
  {
    templateKey: "corin_final_truth_confession_3",
    npcKey: "corin_hale",
    claimKeys: FINAL_TRUTH_CLAIM_KEYS,
    responseKind: "answer",
    text:
      "My apprentice, Lark, cracked the bell by accident while she worked alone. I " +
      "carried it to the Old Chapel under cover, meaning to protect her from the " +
      "inquiry. I dressed that choice up as duty. It was a cover-up, and it was mine.",
    styleTags: ["precise", "confessional"],
  },
] as const);

export interface OutcomeTemplate {
  readonly templateKey: string;
  readonly npcKey: string;
  readonly outcomeKind: string;
  readonly responseKind: string;
  readonly text: string;
  readonly styleTags: readonly string[];
}

export const OUTCOME_TEMPLATES: readonly OutcomeTemplate[] = Object.freeze([
  {
    templateKey: "corin_requested_item_received_1",
    npcKey: "corin_hale",
    outcomeKind: "requested_item_received",
    responseKind: "acknowledge",
    text: "The seal, back where it belongs. I'll set this against the dispatch record myself.",
    styleTags: ["formal"],
  },
  {
    templateKey: "corin_requested_item_received_2",
    npcKey: "corin_hale",
    outcomeKind: "requested_item_received",
    responseKind: "acknowledge",
    text: "That's the dispatch seal accounted for. My thanks — carelessness with that item costs more than most people realize.",
    styleTags: ["precise"],
  },
  {
    templateKey: "nessa_requested_item_received_1",
    npcKey: "nessa_reed",
    outcomeKind: "requested_item_received",
    responseKind: "acknowledge",
    text: "My lens — thank you. I see clearer with it than without, in more ways than one.",
    styleTags: ["sensory"],
  },
  {
    templateKey: "nessa_requested_item_received_2",
    npcKey: "nessa_reed",
    outcomeKind: "requested_item_received",
    responseKind: "acknowledge",
    text: "You found it. I dropped that near the square without noticing, and I've missed it since.",
    styleTags: ["measured"],
  },
  {
    templateKey: "nessa_chapel_key_lent_1",
    npcKey: "nessa_reed",
    outcomeKind: "chapel_key_lent",
    responseKind: "answer",
    text: "Take the chapel key. Bring it back when the inquiry is settled.",
    styleTags: ["exact"],
  },
  {
    templateKey: "nessa_chapel_key_lent_2",
    npcKey: "nessa_reed",
    outcomeKind: "chapel_key_lent",
    responseKind: "answer",
    text: "Here — the chapel key. I am trusting you with it, and I expect it returned once this is resolved.",
    styleTags: ["measured"],
  },
  {
    templateKey: "nessa_chapel_key_lent_3",
    npcKey: "nessa_reed",
    outcomeKind: "chapel_key_lent",
    responseKind: "answer",
    text: "The key is yours to carry for now. Return it when the town has its answer.",
    styleTags: ["sensory"],
  },
  {
    templateKey: "corin_chapel_access_granted_1",
    npcKey: "corin_hale",
    outcomeKind: "chapel_access_granted",
    responseKind: "answer",
    text: "You have enough evidence to search the chapel. I will authorize the door, but I will not tell you what conclusion to draw.",
    styleTags: ["formal"],
  },
  {
    templateKey: "corin_chapel_access_granted_2",
    npcKey: "corin_hale",
    outcomeKind: "chapel_access_granted",
    responseKind: "answer",
    text: "The evidence you've shown me is sufficient. I will open the chapel to you — what you find there, you will judge for yourself.",
    styleTags: ["precise"],
  },
  {
    templateKey: "mara_keep_secret_promise_accepted_1",
    npcKey: "mara_venn",
    outcomeKind: "keep_secret_promise_accepted",
    responseKind: "acknowledge",
    text: "Your promise is recorded.",
    styleTags: ["plain"],
  },
  {
    templateKey: "mara_keep_secret_promise_accepted_2",
    npcKey: "mara_venn",
    outcomeKind: "keep_secret_promise_accepted",
    responseKind: "acknowledge",
    text: "I'm holding you to that promise now. Thank you for making it.",
    styleTags: ["warm"],
  },
] as const);

export interface DenialTemplate {
  readonly templateKey: string;
  readonly npcKey: string;
  readonly gateResult: string;
  readonly responseKind: string;
  readonly text: string;
  readonly styleTags: readonly string[];
}

export const DENIAL_TEMPLATES: readonly DenialTemplate[] = Object.freeze([
  {
    templateKey: "nessa_denied_key_1",
    npcKey: "nessa_reed",
    gateResult: "denied_access",
    responseKind: "refuse",
    text: "I do not lend the chapel key on urgency alone.",
    styleTags: ["exact"],
  },
  {
    templateKey: "nessa_denied_key_2",
    npcKey: "nessa_reed",
    gateResult: "denied_access",
    responseKind: "refuse",
    text: "Trust is not built by asking twice in the same breath. I'll need more than urgency.",
    styleTags: ["measured"],
  },
  {
    templateKey: "corin_denied_chapel_access_1",
    npcKey: "corin_hale",
    gateResult: "denied_access",
    responseKind: "refuse",
    text: "You have not shown me enough to justify opening a sealed place.",
    styleTags: ["formal"],
  },
  {
    templateKey: "corin_denied_chapel_access_2",
    npcKey: "corin_hale",
    gateResult: "denied_access",
    responseKind: "refuse",
    text: "A locked door stays locked until the evidence, not the request, changes my judgment.",
    styleTags: ["precise"],
  },
  {
    templateKey: "mara_denied_confidential_1",
    npcKey: "mara_venn",
    gateResult: "denied_disclosure_tier",
    responseKind: "refuse",
    text: "Some matters are not mine to scatter through the town.",
    styleTags: ["guarded"],
  },
  {
    templateKey: "mara_denied_confidential_2",
    npcKey: "mara_venn",
    gateResult: "denied_disclosure_tier",
    responseKind: "refuse",
    text: "I keep some things close until I'm sure of the hands they're going into.",
    styleTags: ["nervous"],
  },
] as const);
