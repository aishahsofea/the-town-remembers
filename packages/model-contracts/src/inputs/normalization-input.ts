/**
 * `claim-normalization-input/1`, the exact user-message shape sent to
 * `claim-normalization/1.0.0` (Decision 010, "Claim normalization / Purpose
 * and input").
 *
 * The Zod shape validates the object before it is serialized, so a malformed
 * bundle fails locally rather than at Bedrock. It fixes structure only —
 * membership of a supplied ID against the frozen content registry is Phase
 * 4's `model-runtime` semantic-validation layer, not this package (`D4-B`).
 */

import { z } from "zod";

import {
  CLAIM_PREDICATES,
  CLAIM_PREDICATE_SIGNATURES,
} from "../claim-normalization.js";
import { TASK_INPUT_VERSIONS } from "../versions.js";

export const CLAIM_NORMALIZATION_INPUT_VERSION = TASK_INPUT_VERSIONS.claimNormalization;

const CanonicalEntityInputSchema = z.strictObject({
  entity_id: z.string().min(1),
  kind: z.string().min(1),
  display_name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
});

const CanonicalActorInputSchema = z.strictObject({
  actor_id: z.string().min(1),
  actor_kind: z.string().min(1),
  display_name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
});

const PredicateSignatureInputSchema = z.strictObject({
  predicate: z.enum(CLAIM_PREDICATES),
  subject_kind: z.string().min(1),
  object_kind: z.string().min(1),
});

const AllowedContextInputSchema = z.strictObject({
  context_key: z.string().min(1),
  aliases: z.array(z.string().min(1)),
});

const ClaimNormalizationTrustedContextSchema = z.strictObject({
  speaker_actor_id: z.string().min(1),
  canonical_entities: z.array(CanonicalEntityInputSchema),
  canonical_actors: z.array(CanonicalActorInputSchema),
  predicate_signatures: z.array(PredicateSignatureInputSchema),
  allowed_contexts: z.array(AllowedContextInputSchema),
  default_context_key: z.string().min(1),
});

export type ClaimNormalizationTrustedContext = z.infer<
  typeof ClaimNormalizationTrustedContextSchema
>;

export const ClaimNormalizationInputV1Schema = z.strictObject({
  task_input_version: z.literal(CLAIM_NORMALIZATION_INPUT_VERSION),
  trusted_context: ClaimNormalizationTrustedContextSchema,
  untrusted_player_text: z.string(),
});

export type ClaimNormalizationInputV1 = z.infer<typeof ClaimNormalizationInputV1Schema>;

/**
 * The five predicate signatures in `CLAIM_PREDICATE_SIGNATURES`'s own key
 * order, reshaped for the wire so the sent value can never drift from the
 * canonical table.
 */
export const CLAIM_PREDICATE_SIGNATURE_ENTRIES: Array<
  z.infer<typeof PredicateSignatureInputSchema>
> = CLAIM_PREDICATES.map((predicate) => ({
  predicate,
  subject_kind: CLAIM_PREDICATE_SIGNATURES[predicate].subject,
  object_kind: CLAIM_PREDICATE_SIGNATURES[predicate].object,
}));

export interface BuildClaimNormalizationInputParams {
  readonly trustedContext: ClaimNormalizationTrustedContext;
  readonly untrustedPlayerText: string;
}

export function buildClaimNormalizationInput(
  params: BuildClaimNormalizationInputParams,
): ClaimNormalizationInputV1 {
  return ClaimNormalizationInputV1Schema.parse({
    task_input_version: CLAIM_NORMALIZATION_INPUT_VERSION,
    trusted_context: params.trustedContext,
    untrusted_player_text: params.untrustedPlayerText,
  });
}
