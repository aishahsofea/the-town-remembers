/**
 * `ambient_choice_v1`, the Bedrock structured output accepted by Decision 010.
 *
 * Fixed primary and secondary slots are used because the Bedrock-supported
 * JSON Schema subset cannot express an array maximum of two. Membership,
 * distinctness, repeated-claim and repeated-speaker rules, and commit-time
 * revalidation are deterministic application checks owned by Phase 5.
 */

import { z } from "zod";

export const AMBIENT_DECISIONS = ["select_choices", "do_nothing"] as const;

export const AMBIENT_SELECTION_REASONS = [
  "respond_to_new_event",
  "share_salient_claim",
  "address_contradiction",
  "relationship_pressure",
  "honor_or_protect_promise",
  "nothing_safe_or_relevant",
] as const;

/** The only reason permitted with `do_nothing`. */
export const AMBIENT_DO_NOTHING_REASON = "nothing_safe_or_relevant" as const;

/** Deterministic shortlist size the candidate builder must not exceed. */
export const AMBIENT_CANDIDATE_SHORTLIST_SIZE = 12;

/** Maximum candidates the model may select in one tick. */
export const AMBIENT_MAXIMUM_SELECTIONS = 2;

export const AmbientChoiceV1Schema = z
  .strictObject({
    decision: z.enum(AMBIENT_DECISIONS),
    primary_choice_id: z
      .union([z.string(), z.null()])
      .describe("First supplied choice ID, or null."),
    secondary_choice_id: z
      .union([z.string(), z.null()])
      .describe("Second supplied choice ID, or null."),
    selection_reason: z.enum(AMBIENT_SELECTION_REASONS),
  })
  .describe(
    "Selection of zero, one, or two application-supplied ambient action candidates.",
  );

export type AmbientChoiceV1 = z.infer<typeof AmbientChoiceV1Schema>;
export type AmbientSelectionReason = (typeof AMBIENT_SELECTION_REASONS)[number];
