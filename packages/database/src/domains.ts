/**
 * Every closed string domain in the accepted schema, declared once.
 *
 * Decision 005 stores closed domains as `STRING` plus a `CHECK` rather than a
 * database enum type, because the check is easier to evolve. That choice only
 * stays safe if the SQL text and the TypeScript union cannot drift apart, so
 * migrations render their `IN (…)` lists from these constants and a schema test
 * reads the migrated checks back and compares them against the same source.
 *
 * Order matters: it is the order rendered into SQL, so a reordering shows up as
 * a schema diff rather than passing silently.
 */

function domain<const T extends readonly string[]>(values: T): T {
  return Object.freeze(values);
}

// --- Town and identity ------------------------------------------------------

export const TOWN_STATUSES = domain([
  "active",
  "awaiting_resolution",
  "resolved",
  "retired",
] as const);

export const STORY_ENTITY_TYPES = domain([
  "character",
  "location",
  "item",
  "motive",
] as const);

export const ACTOR_TYPES = domain(["player", "npc"] as const);

// --- Operational ledgers ----------------------------------------------------

export const REQUEST_LEDGER_STATUSES = domain([
  "processing",
  "completed",
  "failed",
] as const);

export const JOIN_REPLAY_CLOSED_REASONS = domain([
  "confirmed",
  "expired",
  "exhausted",
] as const);

export const SESSION_STATUSES = domain(["active", "revoked"] as const);

export const RATE_LIMIT_SCOPE_KINDS = domain(["ip_hash", "player", "town"] as const);

export const RATE_LIMIT_BUCKET_KINDS = domain([
  "model_action",
  "player_view",
  "town_creation",
  "join",
] as const);

export const VISIT_STATUSES = domain(["active", "ended"] as const);

export const VISIT_END_REASONS = domain(["left_town", "town_resolved"] as const);

// --- Authored truth, evidence, and items ------------------------------------

export const WORLD_FACT_VISIBILITIES = domain([
  "hidden",
  "discoverable",
  "public",
] as const);

export const CAPABILITY_STATUSES = domain(["granted", "revoked"] as const);

export const CLUE_KINDS = domain([
  "physical_trace",
  "document",
  "object_state",
] as const);

export const CLUE_EFFECT_KINDS = domain(["supports", "contradicts"] as const);

// --- Claims, dialogue, provenance, and memory -------------------------------

export const CLAIM_PREDICATES = domain([
  "was_at",
  "moved",
  "damaged",
  "is_at",
  "acted_for",
] as const);

export const CLAIM_POLARITIES = domain(["positive", "negative"] as const);

export const CLAIM_RELATION_KINDS = domain(["contradicts", "entails"] as const);

export const CLAIM_DRAFT_STATUSES = domain([
  "pending",
  "confirmed",
  "cancelled",
  "expired",
] as const);

export const INTERACTION_INPUT_KINDS = domain([
  "ask",
  "tell",
  "show",
  "give",
  "promise",
] as const);

export const INTERACTION_RESPONSE_MODES = domain([
  "selected",
  "repaired",
  "fallback",
  "authored",
] as const);

export const TRANSMISSION_SOURCE_KINDS = domain([
  "original_assertion",
  "direct_observation",
  "repeated_testimony",
  "alleged_hearsay",
] as const);

export const EPISODE_KINDS = domain([
  "direct_observation",
  "heard_claim",
  "player_interaction",
  "promise_consequence",
  "item_transfer",
  "world_consequence",
] as const);

export const EMBEDDING_STATUSES = domain(["pending", "ready", "failed"] as const);

export const EPISODE_REFERENCE_KINDS = domain([
  "participant",
  "location",
  "item",
  "motive",
  "claim",
] as const);

// --- Beliefs and relationships ----------------------------------------------

export const BELIEF_LABELS = domain(["convinced", "leaning", "doubtful"] as const);

export const EVIDENCE_KINDS = domain([
  "direct_observation",
  "player_testimony",
  "npc_testimony",
  "physical_clue",
  "corroboration",
  "contradiction",
  "source_reversal",
] as const);

export const RELATIONSHIP_REASON_KINDS = domain([
  "verified_testimony",
  "evidence_presented",
  "requested_item_given",
  "promise_fulfilled",
  "lie_established",
  "promise_broken",
] as const);

// --- Promises and case progress ---------------------------------------------

export const PROMISE_KINDS = domain(["keep_secret", "return_item"] as const);

export const PROMISE_STATUSES = domain(["active", "fulfilled", "broken"] as const);

export const BOARD_ENTRY_KINDS = domain([
  "verified_evidence",
  "testimony",
  "hearsay",
  "note",
] as const);

export const BOARD_VERIFICATION_STATUSES = domain([
  "verified_physical",
  "attributed_testimony",
  "attributed_hearsay",
  "unverified_player_note",
] as const);

/** Each board entry kind admits exactly one verification status. */
export const BOARD_VERIFICATION_BY_KIND = Object.freeze({
  verified_evidence: "verified_physical",
  testimony: "attributed_testimony",
  hearsay: "attributed_hearsay",
  note: "unverified_player_note",
} as const);

export const CASE_ATTEMPT_OUTCOMES = domain(["incorrect", "correct"] as const);

export const RESOLUTION_CHOICES = domain([
  "expose_cover_up",
  "restore_bell_quietly",
] as const);

// --- Actions, events, and operations ----------------------------------------

export const ACTION_KINDS = domain([
  "start_visit",
  "travel",
  "inspect",
  "ask",
  "normalize_claim",
  "tell",
  "show",
  "give",
  "accept_promise",
  "add_note",
  "leave",
  "accuse",
  "resolve",
] as const);

export const ACTION_STATUSES = domain([
  "processing",
  "retryable",
  "completed",
  "failed",
] as const);

export const ACTION_OUTCOMES = domain(["applied", "no_change", "denied"] as const);

export const EVENT_ORIGIN_KINDS = domain([
  "player_action",
  "ambient_job",
  "system_seed",
] as const);

export const EVENT_TYPES = domain([
  "authored_observation",
  "visit_started",
  "travelled",
  "inspected",
  "clue_discovered",
  "npc_interaction",
  "claim_transmitted",
  "evidence_shown",
  "item_transferred",
  "item_relocated",
  "promise_accepted",
  "promise_fulfilled",
  "promise_broken",
  "capability_changed",
  "note_added",
  "visit_ended",
  "relationship_changed",
  "source_discredited",
  "case_attempted",
  "case_resolved",
] as const);

export const AGENT_RUN_PURPOSES = domain([
  "claim_normalization",
  "dialogue_selection",
  "ambient_choice",
  "structured_repair",
  "episode_embedding",
  "query_embedding",
] as const);

/**
 * The two embedding purposes have no prompt, schema, or validator, so the
 * contract-version columns are required for the rest and forbidden for these.
 */
export const EMBEDDING_AGENT_RUN_PURPOSES = domain([
  "episode_embedding",
  "query_embedding",
] as const);

export const AGENT_RUN_OUTCOMES = domain([
  "accepted",
  "repaired",
  "rejected",
  "fallback",
  "failed",
  "superseded",
] as const);

export const RESERVATION_STATUSES = domain([
  "reserved",
  "settled",
  "released",
] as const);

export const OUTBOX_DELIVERY_STATUSES = domain([
  "pending",
  "sending",
  "sent",
  "abandoned",
] as const);

export const OUTBOX_JOB_TYPES = domain(["ambient_tick"] as const);

export const AMBIENT_EXECUTION_STATUSES = domain([
  "processing",
  "completed",
  "quarantined",
] as const);

// --- Accepted structural constants ------------------------------------------

/** Decision 005 fixes the claim tuple's allowed entity types per predicate. */
export const CLAIM_ENTITY_MATRIX = Object.freeze({
  was_at: { subject: "character", object: "location" },
  moved: { subject: "character", object: "item" },
  damaged: { subject: "character", object: "item" },
  is_at: { subject: "item", object: "location" },
  acted_for: { subject: "character", object: "motive" },
} as const);

/** Belief score bands, highest first, used to derive the stored label. */
export const BELIEF_LABEL_BANDS = Object.freeze([
  { minimum: 60, label: "convinced" },
  { minimum: 20, label: "leaning" },
  { minimum: -100, label: "doubtful" },
] as const);

export const SCORE_RANGE = Object.freeze({ minimum: -100, maximum: 100 } as const);
export const IMPORTANCE_RANGE = Object.freeze({ minimum: 0, maximum: 100 } as const);
export const HOP_RANGE = Object.freeze({ minimum: 0, maximum: 4 } as const);
/** NPC recipients stop at hop 3; hop 4 is the terminal player-visible edge. */
export const MAXIMUM_NPC_RECIPIENT_HOP = 3;
export const EMBEDDING_DIMENSIONS = 256;
export const SHA256_BYTE_LENGTH = 32;

export type TownStatus = (typeof TOWN_STATUSES)[number];
export type StoryEntityType = (typeof STORY_ENTITY_TYPES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type RequestLedgerStatus = (typeof REQUEST_LEDGER_STATUSES)[number];
export type JoinReplayClosedReason = (typeof JOIN_REPLAY_CLOSED_REASONS)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type RateLimitScopeKind = (typeof RATE_LIMIT_SCOPE_KINDS)[number];
export type RateLimitBucketKind = (typeof RATE_LIMIT_BUCKET_KINDS)[number];
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export type VisitEndReason = (typeof VISIT_END_REASONS)[number];
export type WorldFactVisibility = (typeof WORLD_FACT_VISIBILITIES)[number];
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];
export type ClueKind = (typeof CLUE_KINDS)[number];
export type ClueEffectKind = (typeof CLUE_EFFECT_KINDS)[number];
export type ClaimPredicate = (typeof CLAIM_PREDICATES)[number];
export type ClaimPolarity = (typeof CLAIM_POLARITIES)[number];
export type ClaimRelationKind = (typeof CLAIM_RELATION_KINDS)[number];
export type ClaimDraftStatus = (typeof CLAIM_DRAFT_STATUSES)[number];
export type InteractionInputKind = (typeof INTERACTION_INPUT_KINDS)[number];
export type InteractionResponseMode = (typeof INTERACTION_RESPONSE_MODES)[number];
export type TransmissionSourceKind = (typeof TRANSMISSION_SOURCE_KINDS)[number];
export type EpisodeKind = (typeof EPISODE_KINDS)[number];
export type EmbeddingStatus = (typeof EMBEDDING_STATUSES)[number];
export type EpisodeReferenceKind = (typeof EPISODE_REFERENCE_KINDS)[number];
export type BeliefLabel = (typeof BELIEF_LABELS)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type RelationshipReasonKind = (typeof RELATIONSHIP_REASON_KINDS)[number];
export type PromiseKind = (typeof PROMISE_KINDS)[number];
export type PromiseStatus = (typeof PROMISE_STATUSES)[number];
export type BoardEntryKind = (typeof BOARD_ENTRY_KINDS)[number];
export type BoardVerificationStatus = (typeof BOARD_VERIFICATION_STATUSES)[number];
export type CaseAttemptOutcome = (typeof CASE_ATTEMPT_OUTCOMES)[number];
export type ResolutionChoice = (typeof RESOLUTION_CHOICES)[number];
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export type ActionOutcome = (typeof ACTION_OUTCOMES)[number];
export type EventOriginKind = (typeof EVENT_ORIGIN_KINDS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type AgentRunPurpose = (typeof AGENT_RUN_PURPOSES)[number];
export type AgentRunOutcome = (typeof AGENT_RUN_OUTCOMES)[number];
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type OutboxDeliveryStatus = (typeof OUTBOX_DELIVERY_STATUSES)[number];
export type OutboxJobType = (typeof OUTBOX_JOB_TYPES)[number];
export type AmbientExecutionStatus = (typeof AMBIENT_EXECUTION_STATUSES)[number];

/** Derives the stored label from a score, so no caller writes the bands again. */
export function beliefLabelFor(score: number): BeliefLabel {
  for (const band of BELIEF_LABEL_BANDS) {
    if (score >= band.minimum) return band.label;
  }
  return "doubtful";
}

/** Renders a domain as the SQL fragment migrations embed in their checks. */
export function sqlValueList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}
