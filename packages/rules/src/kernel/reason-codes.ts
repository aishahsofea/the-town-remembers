/**
 * The closed set of `DecisionResult` reason codes (`D2-K`).
 *
 * One string per denial or non-applied outcome, owned here so `P2-17`'s
 * dispatcher and `P2-18`'s projections pass it through unchanged into
 * `DeniedActionResult.reasonCode` rather than translating between two
 * vocabularies. Every entry already satisfies that schema's
 * `/^[A-Z][A-Z0-9_]*$/` pattern by construction; `reason-codes.test.ts`
 * proves it rather than trusting it.
 *
 * Grows as later workstreams land; never renamed or removed once a workstream
 * ships against it, since `ReasonCode` values are recorded on append-only
 * event and evidence rows.
 */

export const REASON_CODES = [
  // --- Kernel-wide -----------------------------------------------------------
  "OK",
  "REVISION_CONFLICT",
  "CONTENT_VERSION_MISMATCH",
  "CORRUPT_CLAIM_KEY",
  "UNKNOWN_ENTITY",

  // --- Claims (P2-03) ----------------------------------------------------------
  "INVALID_CLAIM_TUPLE",
  "UNKNOWN_CLAIM",

  // --- Beliefs and relationships (P2-04..06) ------------------------------------
  "DUPLICATE_EVIDENCE_SOURCE",
  "NO_ACTIVE_CONTRIBUTION_TO_REVERSE",

  // --- Disclosure (P2-07) -------------------------------------------------------
  "DISCLOSURE_TIER_NOT_MET",
  "CLAIM_NOT_BELIEVED",

  // --- World: clues, custody, access (P2-08) ------------------------------------
  "INSPECTABLE_NOT_FOUND",
  "INSPECTABLE_DISABLED",
  "LOCATION_LOCKED",
  "ITEM_NOT_HELD",
  "ITEM_NOT_DISCOVERED",
  "ITEM_NOT_PORTABLE",
  "NPC_NOT_PRESENT",
  "EVIDENCE_NOT_AUTHORIZED",
  "CHAPEL_ACCESS_DENIED",

  // --- Promises (P2-09) ----------------------------------------------------------
  "PROMISE_OFFER_INVALID",
  "PROMISE_OFFER_EXPIRED",
  "PROMISE_ALREADY_ACTIVE",
  "PROMISE_NOT_FOUND",
  "PROMISE_NOT_ACTIVE",

  // --- Visits and travel (P2-10) --------------------------------------------------
  "TOWN_NOT_ACTIVE",
  "VISIT_NOT_ACTIVE",
  "VISIT_ALREADY_ACTIVE",
  "PRIOR_VISIT_NOT_CLOSED",
  "DESTINATION_UNKNOWN",
  "ALREADY_AT_DESTINATION",

  // --- Lies (P2-11) ----------------------------------------------------------------
  "LIE_NOT_ESTABLISHED",

  // --- Ambient (P2-13..14) -----------------------------------------------------------
  "AMBIENT_CANDIDATE_UNKNOWN",
  "AMBIENT_CANDIDATE_DUPLICATE",
  "AMBIENT_CANDIDATE_REPEATED_CLAIM",
  "AMBIENT_CANDIDATE_REPEATED_SPEAKER",
  "AMBIENT_CANDIDATE_NEWLY_INVALID",

  // --- Case board and resolution (P2-15..16) -------------------------------------------
  "CASE_GATE_LOCKED",
  "CASE_ALREADY_RESOLVED",
  "RESOLUTION_RESERVATION_ACTIVE",
  "RESOLUTION_NOT_OWNER",
  "RESOLUTION_NOT_ELIGIBLE",

  // --- Claim drafts and dialogue (P2-17) ------------------------------------------------
  "CLAIM_DRAFT_NOT_FOUND",
  "CLAIM_DRAFT_EXPIRED",
  "CLAIM_DRAFT_ALREADY_CONFIRMED",
  "CLAIM_DRAFT_WRONG_NPC",
  "EXTERNAL_SELECTION_REQUIRED",
  "EXTERNAL_SELECTION_INVALID",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
