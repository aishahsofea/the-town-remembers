/**
 * The authored backstory, as ordered causal history.
 *
 * Everything here happened before the first player arrived, and all of it is
 * recorded the same way live play will be: events, episodes, transmissions, and
 * append-only evidence. There is no privileged "initial state" that bypasses
 * the ledger, which is why the inspection views can explain a starting belief
 * exactly as they explain one formed in play.
 *
 * Order is authored rather than derived. Decision 009 breaks ties on "stable
 * event and episode IDs", but those are generated per town, so two towns would
 * order their ties differently and the repeatability proof would fail. The
 * explicit sequence below is deterministic and, unlike a UUID comparison,
 * reviewable.
 *
 * Offsets are negative minutes from the town's creation time. Nothing here
 * reads a clock.
 */

export interface SeedEvent {
  readonly seedEventKey: string;
  readonly offsetMinutes: number;
  readonly eventType: "authored_observation" | "claim_transmitted";
}

/**
 * Eleven events, in the order their sequence numbers are allocated.
 *
 * Corin asks Nessa to open the chapel (T-11h30m) *before* he moves the bell
 * (T-11h); the canon list reads the other way round, but he could hardly hide
 * it in a locked building he had not yet been let into.
 */
export const SEED_EVENTS: readonly SeedEvent[] = Object.freeze([
  {
    seedEventKey: "corin_saw_the_accident",
    offsetMinutes: -720,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "mara_saw_the_accident",
    offsetMinutes: -720,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "mara_met_corin_at_inn",
    offsetMinutes: -710,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "corin_told_mara_he_would_protect_lark",
    offsetMinutes: -710,
    eventType: "claim_transmitted",
  },
  {
    seedEventKey: "corin_told_nessa_the_safety_story",
    offsetMinutes: -690,
    eventType: "claim_transmitted",
  },
  {
    seedEventKey: "corin_chose_to_protect_lark",
    offsetMinutes: -660,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "corin_moved_the_bell",
    offsetMinutes: -660,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "nessa_saw_corins_cart",
    offsetMinutes: -660,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "mara_saw_the_empty_frame",
    offsetMinutes: -30,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "corin_saw_the_empty_frame",
    offsetMinutes: -30,
    eventType: "authored_observation",
  },
  {
    seedEventKey: "nessa_saw_the_empty_frame",
    offsetMinutes: -30,
    eventType: "authored_observation",
  },
] as const);

export interface EpisodeReference {
  readonly referenceKind: "participant" | "location" | "item" | "motive" | "claim";
  readonly key: string;
}

export interface SeedEpisode {
  readonly episodeKey: string;
  readonly npcKey: string;
  readonly seedEventKey: string;
  readonly episodeKind: "direct_observation" | "heard_claim";
  readonly importance: number;
  readonly summary: string;
  readonly references: readonly EpisodeReference[];
}

export const SEED_EPISODES: readonly SeedEpisode[] = Object.freeze([
  {
    episodeKey: "mara_saw_the_accident",
    npcKey: "mara_venn",
    seedEventKey: "mara_saw_the_accident",
    episodeKind: "direct_observation",
    importance: 95,
    summary:
      "Mara saw the bell strike its frame while Lark worked at the rope and clapper pin.",
    references: [
      { referenceKind: "participant", key: "lark_venn" },
      { referenceKind: "item", key: "festival_bell" },
      { referenceKind: "location", key: "festival_square" },
      { referenceKind: "claim", key: "lark_damaged_bell" },
    ],
  },
  {
    episodeKey: "mara_met_corin_at_inn",
    npcKey: "mara_venn",
    seedEventKey: "mara_met_corin_at_inn",
    episodeKind: "direct_observation",
    importance: 90,
    summary: "Mara saw Corin enter The Lantern Inn after the accident.",
    references: [
      { referenceKind: "participant", key: "corin_hale" },
      { referenceKind: "location", key: "lantern_inn" },
      { referenceKind: "claim", key: "corin_was_at_inn" },
    ],
  },
  {
    episodeKey: "mara_heard_corins_offer",
    npcKey: "mara_venn",
    seedEventKey: "corin_told_mara_he_would_protect_lark",
    episodeKind: "heard_claim",
    importance: 90,
    summary: "Corin told Mara he would keep Lark out of the public blame.",
    references: [
      { referenceKind: "participant", key: "corin_hale" },
      { referenceKind: "participant", key: "lark_venn" },
      { referenceKind: "claim", key: "corin_protected_lark" },
    ],
  },
  {
    episodeKey: "corin_saw_the_accident",
    npcKey: "corin_hale",
    seedEventKey: "corin_saw_the_accident",
    episodeKind: "direct_observation",
    importance: 95,
    summary:
      "Corin saw the bell strike its frame while Lark worked, then inspected the fresh crack.",
    references: [
      { referenceKind: "participant", key: "lark_venn" },
      { referenceKind: "item", key: "festival_bell" },
      { referenceKind: "location", key: "festival_square" },
      { referenceKind: "claim", key: "lark_damaged_bell" },
    ],
  },
  {
    episodeKey: "corin_moved_the_bell",
    npcKey: "corin_hale",
    seedEventKey: "corin_moved_the_bell",
    episodeKind: "direct_observation",
    importance: 100,
    summary:
      "Corin loaded the bell onto the guard handcart and hid it under oilcloth in the Old Chapel.",
    references: [
      { referenceKind: "participant", key: "corin_hale" },
      { referenceKind: "item", key: "festival_bell" },
      { referenceKind: "location", key: "old_chapel" },
      { referenceKind: "claim", key: "corin_moved_bell" },
      { referenceKind: "claim", key: "bell_at_chapel" },
      { referenceKind: "claim", key: "bell_at_chapel_current" },
    ],
  },
  {
    episodeKey: "corin_chose_to_protect_lark",
    npcKey: "corin_hale",
    seedEventKey: "corin_chose_to_protect_lark",
    episodeKind: "direct_observation",
    importance: 100,
    summary:
      "Corin decided to conceal the damage until he could protect Lark from public blame.",
    references: [
      { referenceKind: "participant", key: "corin_hale" },
      { referenceKind: "participant", key: "lark_venn" },
      { referenceKind: "motive", key: "protect_lark" },
      { referenceKind: "claim", key: "corin_protected_lark" },
    ],
  },
  {
    episodeKey: "nessa_saw_corins_cart",
    npcKey: "nessa_reed",
    seedEventKey: "nessa_saw_corins_cart",
    episodeKind: "direct_observation",
    importance: 95,
    summary:
      "Nessa saw Corin take the covered guard cart through the chapel gate but could not see its load.",
    references: [
      { referenceKind: "participant", key: "corin_hale" },
      { referenceKind: "location", key: "old_chapel" },
      { referenceKind: "claim", key: "corin_was_at_chapel" },
    ],
  },
  {
    episodeKey: "nessa_heard_safety_story",
    npcKey: "nessa_reed",
    seedEventKey: "corin_told_nessa_the_safety_story",
    episodeKind: "heard_claim",
    importance: 80,
    summary: "Corin said he needed the chapel opened to prevent a public accident.",
    references: [
      { referenceKind: "participant", key: "corin_hale" },
      { referenceKind: "motive", key: "public_safety" },
      { referenceKind: "claim", key: "corin_acted_for_safety" },
    ],
  },
  {
    episodeKey: "mara_saw_the_empty_frame",
    npcKey: "mara_venn",
    seedEventKey: "mara_saw_the_empty_frame",
    episodeKind: "direct_observation",
    importance: 90,
    summary: "Mara saw the empty bell frame at dawn.",
    references: [
      { referenceKind: "item", key: "festival_bell" },
      { referenceKind: "location", key: "festival_square" },
      { referenceKind: "claim", key: "bell_not_at_square" },
    ],
  },
  {
    episodeKey: "corin_saw_the_empty_frame",
    npcKey: "corin_hale",
    seedEventKey: "corin_saw_the_empty_frame",
    episodeKind: "direct_observation",
    importance: 90,
    summary: "Corin saw the empty bell frame at dawn.",
    references: [
      { referenceKind: "item", key: "festival_bell" },
      { referenceKind: "location", key: "festival_square" },
      { referenceKind: "claim", key: "bell_not_at_square" },
    ],
  },
  {
    episodeKey: "nessa_saw_the_empty_frame",
    npcKey: "nessa_reed",
    seedEventKey: "nessa_saw_the_empty_frame",
    episodeKind: "direct_observation",
    importance: 90,
    summary: "Nessa saw the empty bell frame at dawn.",
    references: [
      { referenceKind: "item", key: "festival_bell" },
      { referenceKind: "location", key: "festival_square" },
      { referenceKind: "claim", key: "bell_not_at_square" },
    ],
  },
] as const);

export interface SeedTransmission {
  readonly transmissionKey: string;
  readonly seedEventKey: string;
  readonly claimKey: string;
  readonly speakerNpcKey: string;
  readonly recipientNpcKey: string;
  /** The listener's trust in the speaker at the time, snapshotted permanently. */
  readonly trustSnapshot: number;
  readonly testimonyWeight: number;
}

/**
 * The two pre-story conversations.
 *
 * Corin-to-Nessa uses a trust snapshot of `0` even though no contact edge
 * exists between them: this was a one-off conversation that predates the game
 * and deliberately does not create a live gossip channel.
 */
export const SEED_TRANSMISSIONS: readonly SeedTransmission[] = Object.freeze([
  {
    transmissionKey: "corin_told_mara_he_would_protect_lark",
    seedEventKey: "corin_told_mara_he_would_protect_lark",
    claimKey: "corin_protected_lark",
    speakerNpcKey: "corin_hale",
    recipientNpcKey: "mara_venn",
    trustSnapshot: 40,
    testimonyWeight: 44,
  },
  {
    transmissionKey: "corin_told_nessa_the_safety_story",
    seedEventKey: "corin_told_nessa_the_safety_story",
    claimKey: "corin_acted_for_safety",
    speakerNpcKey: "corin_hale",
    recipientNpcKey: "nessa_reed",
    trustSnapshot: 0,
    testimonyWeight: 40,
  },
] as const);

export const DIRECT_OBSERVATION_WEIGHT = 80;

export interface SeedEvidence {
  readonly npcKey: string;
  readonly claimKey: string;
  readonly seedEventKey: string;
  readonly evidenceKind: "direct_observation" | "npc_testimony" | "contradiction";
  readonly signedWeight: number;
  /** Present for a direct observation. */
  readonly episodeKey?: string;
  /** Present for testimony. */
  readonly transmissionKey?: string;
  readonly trustSnapshot?: number;
  readonly independentSourceNpcKey?: string;
  /** Present for a mirror: the primary contribution it opposes. */
  readonly mirrorsEvidenceOf?: { readonly npcKey: string; readonly claimKey: string };
}

/**
 * One row per contribution, exactly as live play would append them.
 *
 * The six mirrors at the end are not decoration. Decision 008 states without
 * qualification that supporting evidence of weight W appends −W to every
 * explicitly contradicted claim, and the seed inserts real evidence over real
 * authored contradictions, so the rule applies here too. They are additive:
 * every belief Decision 009 names in prose keeps exactly its stated score.
 */
export const SEED_EVIDENCE: readonly SeedEvidence[] = Object.freeze([
  ...SEED_EPISODES.filter((episode) => episode.episodeKind === "direct_observation")
    .flatMap((episode) =>
      episode.references
        .filter((reference) => reference.referenceKind === "claim")
        .map((reference) => ({
          npcKey: episode.npcKey,
          claimKey: reference.key,
          seedEventKey: episode.seedEventKey,
          evidenceKind: "direct_observation" as const,
          signedWeight: DIRECT_OBSERVATION_WEIGHT,
          episodeKey: episode.episodeKey,
        })),
    )
    .map((evidence) => Object.freeze(evidence)),
  ...SEED_TRANSMISSIONS.map((transmission) =>
    Object.freeze({
      npcKey: transmission.recipientNpcKey,
      claimKey: transmission.claimKey,
      seedEventKey: transmission.seedEventKey,
      evidenceKind: "npc_testimony" as const,
      signedWeight: transmission.testimonyWeight,
      transmissionKey: transmission.transmissionKey,
      trustSnapshot: transmission.trustSnapshot,
      independentSourceNpcKey: transmission.speakerNpcKey,
    }),
  ),
  Object.freeze({
    npcKey: "mara_venn",
    claimKey: "lark_did_not_damage_bell",
    seedEventKey: "mara_saw_the_accident",
    evidenceKind: "contradiction" as const,
    signedWeight: -DIRECT_OBSERVATION_WEIGHT,
    mirrorsEvidenceOf: { npcKey: "mara_venn", claimKey: "lark_damaged_bell" },
  }),
  Object.freeze({
    npcKey: "corin_hale",
    claimKey: "lark_did_not_damage_bell",
    seedEventKey: "corin_saw_the_accident",
    evidenceKind: "contradiction" as const,
    signedWeight: -DIRECT_OBSERVATION_WEIGHT,
    mirrorsEvidenceOf: { npcKey: "corin_hale", claimKey: "lark_damaged_bell" },
  }),
  Object.freeze({
    npcKey: "corin_hale",
    claimKey: "corin_acted_for_safety",
    seedEventKey: "corin_chose_to_protect_lark",
    evidenceKind: "contradiction" as const,
    signedWeight: -DIRECT_OBSERVATION_WEIGHT,
    mirrorsEvidenceOf: { npcKey: "corin_hale", claimKey: "corin_protected_lark" },
  }),
  Object.freeze({
    npcKey: "corin_hale",
    claimKey: "bell_at_reeds_garden",
    seedEventKey: "corin_moved_the_bell",
    evidenceKind: "contradiction" as const,
    signedWeight: -DIRECT_OBSERVATION_WEIGHT,
    mirrorsEvidenceOf: { npcKey: "corin_hale", claimKey: "bell_at_chapel" },
  }),
  Object.freeze({
    npcKey: "mara_venn",
    claimKey: "corin_acted_for_safety",
    seedEventKey: "corin_told_mara_he_would_protect_lark",
    evidenceKind: "contradiction" as const,
    signedWeight: -44,
    mirrorsEvidenceOf: { npcKey: "mara_venn", claimKey: "corin_protected_lark" },
  }),
  Object.freeze({
    npcKey: "nessa_reed",
    claimKey: "corin_protected_lark",
    seedEventKey: "corin_told_nessa_the_safety_story",
    evidenceKind: "contradiction" as const,
    signedWeight: -40,
    mirrorsEvidenceOf: { npcKey: "nessa_reed", claimKey: "corin_acted_for_safety" },
  }),
] as const);

export interface SeedBelief {
  readonly npcKey: string;
  readonly claimKey: string;
  readonly score: number;
  readonly label: "convinced" | "leaning" | "doubtful";
  /** The last seed event that contributed, which the belief row cites. */
  readonly seedEventKey: string;
}

function labelFor(score: number): SeedBelief["label"] {
  if (score >= 60) return "convinced";
  if (score >= 20) return "leaning";
  return "doubtful";
}

/**
 * Derived from the evidence rather than restated, so the two cannot disagree.
 * A belief's citing event is the last seed event that contributed to it.
 */
export function seedBeliefs(): readonly SeedBelief[] {
  const order = new Map(SEED_EVENTS.map((event, index) => [event.seedEventKey, index]));
  const totals = new Map<string, { score: number; eventIndex: number }>();

  for (const evidence of SEED_EVIDENCE) {
    const key = `${evidence.npcKey} ${evidence.claimKey}`;
    const eventIndex = order.get(evidence.seedEventKey) ?? 0;
    const existing = totals.get(key);
    totals.set(key, {
      score: (existing?.score ?? 0) + evidence.signedWeight,
      eventIndex: Math.max(existing?.eventIndex ?? 0, eventIndex),
    });
  }

  return [...totals.entries()]
    .map(([key, total]) => {
      const [npcKey = "", claimKey = ""] = key.split(" ");
      const clamped = Math.max(-100, Math.min(100, total.score));
      return {
        npcKey,
        claimKey,
        score: clamped,
        label: labelFor(clamped),
        seedEventKey: SEED_EVENTS[total.eventIndex]?.seedEventKey ?? "",
      };
    })
    .toSorted(
      (left, right) =>
        left.npcKey.localeCompare(right.npcKey) ||
        left.claimKey.localeCompare(right.claimKey),
    );
}
