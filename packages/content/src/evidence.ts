/**
 * Objective truth, inspectables, clues, and their signed claim effects.
 *
 * The three required clues establish damage, mover, and motive; revealing the
 * bell establishes location. Together they open the confrontation gate with no
 * model-selected dialogue involved anywhere, which is the promise that a model
 * failure cannot make the town unsolvable.
 *
 * Every effect weight is exactly ±70 in `mvp-rules-v1`. A different strength
 * would need a new rules version, not an edit here.
 */

export interface WorldFact {
  readonly factKey: string;
  readonly claimKey: string;
  readonly visibility: "hidden" | "discoverable" | "public";
}

/**
 * `bell_at_chapel_current` is deliberately absent: mutable location truth comes
 * from the `items` row, and the claim is only its seed-time conversational
 * projection.
 */
export const WORLD_FACTS: readonly WorldFact[] = Object.freeze([
  {
    factKey: "bell_not_at_square",
    claimKey: "bell_not_at_square",
    visibility: "public",
  },
  {
    factKey: "lark_was_at_square",
    claimKey: "lark_was_at_square",
    visibility: "discoverable",
  },
  {
    factKey: "corin_was_at_inn",
    claimKey: "corin_was_at_inn",
    visibility: "discoverable",
  },
  {
    factKey: "lark_damaged_bell",
    claimKey: "lark_damaged_bell",
    visibility: "discoverable",
  },
  {
    factKey: "corin_moved_bell",
    claimKey: "corin_moved_bell",
    visibility: "discoverable",
  },
  {
    factKey: "corin_was_at_chapel",
    claimKey: "corin_was_at_chapel",
    visibility: "discoverable",
  },
  { factKey: "bell_at_chapel", claimKey: "bell_at_chapel", visibility: "discoverable" },
  {
    factKey: "corin_protected_lark",
    claimKey: "corin_protected_lark",
    visibility: "discoverable",
  },
] as const);

export const CASE_SOLUTION = Object.freeze({
  culpritKey: "corin_hale",
  motiveKey: "protect_lark",
  locationKey: "old_chapel",
  requiredItemKey: "festival_bell",
} as const);

export interface ClueEffect {
  readonly claimKey: string;
  readonly effectKind: "supports" | "contradicts";
  readonly signedWeight: number;
}

export interface AuthoredClue {
  readonly clueKey: string;
  readonly clueKind: "physical_trace" | "document" | "object_state";
  readonly title: string;
  readonly description: string;
  readonly requiredForResolution: boolean;
  readonly effects: readonly ClueEffect[];
}

export interface AuthoredInspectable {
  readonly inspectableKey: string;
  readonly locationKey: string;
  readonly displayName: string;
  readonly contentKey: string;
  /** The portable item this inspection reveals, if any. */
  readonly revealsItemKey?: string;
  readonly clue?: AuthoredClue;
}

export const INSPECTABLES: readonly AuthoredInspectable[] = Object.freeze([
  {
    inspectableKey: "empty_bell_frame",
    locationKey: "festival_square",
    displayName: "Empty Bell Frame",
    contentKey: "inspectable.empty_bell_frame",
    clue: {
      clueKey: "bent_clapper_pin",
      clueKind: "physical_trace",
      title: "Bent Clapper Pin",
      description:
        "A freshly bent pin lies beneath the frame, wrapped in the same green " +
        "repair thread Lark uses at the inn. Brass scoring shows the bell struck " +
        "the timber before it was removed.",
      requiredForResolution: true,
      effects: [
        { claimKey: "lark_damaged_bell", effectKind: "supports", signedWeight: 70 },
        {
          claimKey: "lark_did_not_damage_bell",
          effectKind: "contradicts",
          signedWeight: -70,
        },
      ],
    },
  },
  {
    inspectableKey: "guard_cart_tracks",
    locationKey: "festival_square",
    displayName: "Cart Tracks by the Guard Post",
    contentKey: "inspectable.guard_cart_tracks",
    clue: {
      clueKey: "guard_cart_ruts",
      clueKind: "physical_trace",
      title: "Guard Cart Ruts",
      description:
        "Twin narrow wheels left the bell frame under a heavy load. Their width " +
        "matches Corin's handcart, and the freshest turn leads toward the chapel lane.",
      requiredForResolution: true,
      // The -70 to the garden rumour is derived at play time from the authored
      // location contradiction, not stored as a fourth effect here.
      effects: [
        { claimKey: "corin_moved_bell", effectKind: "supports", signedWeight: 70 },
        { claimKey: "corin_was_at_chapel", effectKind: "supports", signedWeight: 70 },
        { claimKey: "bell_at_chapel", effectKind: "supports", signedWeight: 70 },
      ],
    },
  },
  {
    inspectableKey: "square_bench_glint",
    locationKey: "festival_square",
    displayName: "Glint Beneath the Bench",
    contentKey: "inspectable.square_bench_glint",
    revealsItemKey: "nessas_field_lens",
  },
  {
    inspectableKey: "inn_hearth",
    locationKey: "lantern_inn",
    displayName: "Ash in the Back Hearth",
    contentKey: "inspectable.inn_hearth",
    clue: {
      clueKey: "scorched_guard_note",
      clueKind: "document",
      title: "Scorched Guard Note",
      description:
        "A fragment in Corin's hand reads: “Keep Lark inside. I will put the " +
        "bell beyond the search until I can mend what happened.”",
      requiredForResolution: true,
      effects: [
        { claimKey: "corin_protected_lark", effectKind: "supports", signedWeight: 70 },
        {
          claimKey: "corin_acted_for_safety",
          effectKind: "contradicts",
          signedWeight: -70,
        },
      ],
    },
  },
  {
    inspectableKey: "inn_guest_ledger",
    locationKey: "lantern_inn",
    displayName: "Inn Guest Ledger",
    contentKey: "inspectable.inn_guest_ledger",
    clue: {
      clueKey: "larks_late_entry",
      clueKind: "document",
      title: "Lark's Late Entry",
      description:
        "Mara's ledger records Lark returning from bell practice minutes before " +
        "Corin arrived at the inn.",
      requiredForResolution: false,
      effects: [
        { claimKey: "lark_was_at_square", effectKind: "supports", signedWeight: 70 },
      ],
    },
  },
  {
    inspectableKey: "chapel_lane_hedge",
    locationKey: "reeds_garden",
    displayName: "Thorn Hedge by the Chapel Lane",
    contentKey: "inspectable.chapel_lane_hedge",
    revealsItemKey: "guard_dispatch_seal",
    clue: {
      clueKey: "red_seal_on_thorn",
      clueKind: "physical_trace",
      title: "Red Wax on the Thorn",
      description:
        "A shred of guard-red sealing wax is caught at cart height on the hedge " +
        "beside the chapel lane.",
      requiredForResolution: false,
      effects: [
        { claimKey: "corin_was_at_chapel", effectKind: "supports", signedWeight: 70 },
      ],
    },
  },
  {
    inspectableKey: "chapel_threshold",
    locationKey: "old_chapel",
    displayName: "Chapel Threshold",
    contentKey: "inspectable.chapel_threshold",
    clue: {
      clueKey: "guard_axle_grease",
      clueKind: "physical_trace",
      title: "Guard Axle Grease",
      description:
        "Fresh black grease at the threshold matches the distinctive resin used " +
        "on the town guard's handcart.",
      requiredForResolution: false,
      effects: [
        { claimKey: "corin_moved_bell", effectKind: "supports", signedWeight: 70 },
      ],
    },
  },
  {
    inspectableKey: "shrouded_shape",
    locationKey: "old_chapel",
    displayName: "Shrouded Shape",
    contentKey: "inspectable.shrouded_shape",
    // Revealing the bell sets `revealed_event_id`; it never enters inventory.
    revealsItemKey: "festival_bell",
    clue: {
      clueKey: "cracked_festival_bell",
      clueKind: "object_state",
      title: "The Missing Bell, Found",
      description:
        "The festival bell rests beneath guard oilcloth inside the chapel. Its " +
        "rim is freshly cracked and its clapper pin is missing.",
      requiredForResolution: false,
      effects: [
        { claimKey: "bell_at_chapel", effectKind: "supports", signedWeight: 70 },
        {
          claimKey: "bell_at_chapel_current",
          effectKind: "supports",
          signedWeight: 70,
        },
      ],
    },
  },
] as const);

export const CLUES: readonly AuthoredClue[] = Object.freeze(
  INSPECTABLES.flatMap((inspectable) =>
    inspectable.clue === undefined ? [] : [inspectable.clue],
  ),
);

/** The gate opens on the revealed bell plus these three discoveries. */
export const REQUIRED_CLUE_KEYS: readonly string[] = Object.freeze(
  CLUES.filter((clue) => clue.requiredForResolution).map((clue) => clue.clueKey),
);

export const EVIDENCE_GATE_LOCKED_MESSAGE =
  "The town needs stronger verified evidence before it will confront anyone.";
