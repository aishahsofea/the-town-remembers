/**
 * `claim_normalization_v1`, the Bedrock structured output accepted by
 * Decision 010.
 *
 * Schema conformance is the first check, not the last. Membership of every
 * entity, actor, and context identifier, the predicate signature table, and the
 * `claim-key:v1` encoding remain deterministic application checks owned by
 * Phase 4. Nothing here authorizes a claim.
 */

import { z } from "zod";

export const CLAIM_NORMALIZATION_STATUSES = [
  "normalized",
  "needs_clarification",
  "unsupported",
] as const;

export const CLAIM_PREDICATES = [
  "was_at",
  "moved",
  "damaged",
  "is_at",
  "acted_for",
] as const;

export const CLAIM_POLARITIES = ["positive", "negative"] as const;

export const CLAIM_NORMALIZATION_REASON_CODES = [
  "ambiguous_subject",
  "ambiguous_object",
  "ambiguous_predicate",
  "ambiguous_polarity",
  "ambiguous_context",
  "ambiguous_source",
  "multiple_propositions",
  "unknown_entity",
  "unsupported_context",
  "outside_claim_grammar",
  "no_proposition",
] as const;

/** Reasons that may accompany `needs_clarification`. */
export const CLAIM_CLARIFICATION_REASON_CODES = [
  "ambiguous_subject",
  "ambiguous_object",
  "ambiguous_predicate",
  "ambiguous_polarity",
  "ambiguous_context",
  "ambiguous_source",
  "multiple_propositions",
] as const satisfies readonly (typeof CLAIM_NORMALIZATION_REASON_CODES)[number][];

/** Reasons that may accompany `unsupported`. */
export const CLAIM_UNSUPPORTED_REASON_CODES = [
  "unknown_entity",
  "unsupported_context",
  "outside_claim_grammar",
  "no_proposition",
] as const satisfies readonly (typeof CLAIM_NORMALIZATION_REASON_CODES)[number][];

/** Permitted `(subject kind, object kind)` pair for each predicate. */
export const CLAIM_PREDICATE_SIGNATURES = {
  was_at: { subject: "character", object: "location" },
  moved: { subject: "character", object: "item" },
  damaged: { subject: "character", object: "item" },
  is_at: { subject: "item", object: "location" },
  acted_for: { subject: "character", object: "motive" },
} as const satisfies Record<
  (typeof CLAIM_PREDICATES)[number],
  { subject: string; object: string }
>;

export const ClaimNormalizationV1Schema = z
  .strictObject({
    status: z.enum(CLAIM_NORMALIZATION_STATUSES),
    subject_entity_id: z
      .union([z.string(), z.null()])
      .describe("Canonical subject ID when status is normalized; otherwise null."),
    predicate: z
      .union([z.enum(CLAIM_PREDICATES), z.null()])
      .describe("Supported predicate when status is normalized; otherwise null."),
    object_entity_id: z
      .union([z.string(), z.null()])
      .describe("Canonical object ID when status is normalized; otherwise null."),
    polarity: z
      .union([z.enum(CLAIM_POLARITIES), z.null()])
      .describe(
        "Whether the player asserted or negated the proposition; null unless normalized.",
      ),
    context_key: z
      .union([z.string(), z.null()])
      .describe(
        "Supplied authored time or situation context when status is normalized; otherwise null.",
      ),
    alleged_source_actor_id: z
      .union([z.string(), z.null()])
      .describe(
        "Canonical actor explicitly alleged as the source, or null when no source was stated.",
      ),
    reason_code: z
      .union([z.enum(CLAIM_NORMALIZATION_REASON_CODES), z.null()])
      .describe(
        "Why input needs clarification or is unsupported; null when normalized.",
      ),
  })
  .describe(
    "A bounded interpretation of one player utterance as one canonical claim, a clarification request, or unsupported input.",
  );

export type ClaimNormalizationV1 = z.infer<typeof ClaimNormalizationV1Schema>;
export type ClaimPredicate = (typeof CLAIM_PREDICATES)[number];
export type ClaimNormalizationReasonCode =
  (typeof CLAIM_NORMALIZATION_REASON_CODES)[number];
