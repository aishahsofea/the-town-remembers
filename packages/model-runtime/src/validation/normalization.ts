/**
 * Semantic validation for `claim_normalization_v1` (Decision 010). Bedrock's
 * own schema conformance is the first check, not the last: this is
 * everything a JSON Schema cannot prove — that an ID came from the supplied
 * `canonical_entities`/`canonical_actors`, that the predicate signature
 * matches the referenced entities' real kinds, and that a non-`normalized`
 * status carries no partial claim.
 *
 * `normalized_key` is always computed here from `content/claim-key.ts`,
 * never read from the model's output — the model never sees or produces a
 * `claim-key:v1` string.
 */

import {
  CLAIM_CLARIFICATION_REASON_CODES,
  CLAIM_PREDICATE_SIGNATURES,
  type ClaimNormalizationTrustedContext,
  type ClaimNormalizationV1,
  CLAIM_UNSUPPORTED_REASON_CODES,
  type RepairValidationError,
} from "@the-town-remembers/model-contracts";
import { claimKeyV1 } from "@the-town-remembers/content";

import { buildValidationError } from "./errors.js";

export interface NormalizationValidationSuccess {
  readonly valid: true;
  readonly result: ClaimNormalizationV1;
  /** `claim-key:v1`, computed here — set only when `status === "normalized"`. */
  readonly normalizedKey: string | null;
}

export interface NormalizationValidationFailure {
  readonly valid: false;
  readonly errors: readonly RepairValidationError[];
}

export type NormalizationValidationResult =
  NormalizationValidationSuccess | NormalizationValidationFailure;

const CLARIFICATION_REASONS: ReadonlySet<string> = new Set(
  CLAIM_CLARIFICATION_REASON_CODES,
);
const UNSUPPORTED_REASONS: ReadonlySet<string> = new Set(
  CLAIM_UNSUPPORTED_REASON_CODES,
);

function claimFieldsOf(
  output: ClaimNormalizationV1,
): readonly [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
] {
  return [
    output.subject_entity_id,
    output.predicate,
    output.object_entity_id,
    output.polarity,
    output.context_key,
  ];
}

export function validateClaimNormalization(
  output: ClaimNormalizationV1,
  trustedContext: ClaimNormalizationTrustedContext,
): NormalizationValidationResult {
  const errors: RepairValidationError[] = [];
  const entityById = new Map(
    trustedContext.canonical_entities.map((entity) => [entity.entity_id, entity]),
  );
  const actorIds = new Set(
    trustedContext.canonical_actors.map((actor) => actor.actor_id),
  );
  const contextKeys = new Set(
    trustedContext.allowed_contexts.map((context) => context.context_key),
  );

  const claimFields = claimFieldsOf(output);
  const anyClaimFieldSet = claimFields.some((field) => field !== null);
  const everyClaimFieldSet = claimFields.every((field) => field !== null);

  if (output.status === "normalized") {
    if (!everyClaimFieldSet) {
      errors.push(buildValidationError("invalid_status_combination", "$"));
    }
    if (output.reason_code !== null) {
      errors.push(buildValidationError("invalid_status_combination", "$.reason_code"));
    }
    if (
      output.subject_entity_id !== null &&
      !entityById.has(output.subject_entity_id)
    ) {
      errors.push(buildValidationError("unknown_entity_id", "$.subject_entity_id"));
    }
    if (output.object_entity_id !== null && !entityById.has(output.object_entity_id)) {
      errors.push(buildValidationError("unknown_entity_id", "$.object_entity_id"));
    }
    if (output.context_key !== null && !contextKeys.has(output.context_key)) {
      errors.push(buildValidationError("invalid_context_key", "$.context_key"));
    }
    if (
      output.alleged_source_actor_id !== null &&
      !actorIds.has(output.alleged_source_actor_id)
    ) {
      errors.push(
        buildValidationError("unknown_entity_id", "$.alleged_source_actor_id"),
      );
    }
    if (
      output.predicate !== null &&
      output.subject_entity_id !== null &&
      output.object_entity_id !== null
    ) {
      const subjectEntity = entityById.get(output.subject_entity_id);
      const objectEntity = entityById.get(output.object_entity_id);
      const signature = CLAIM_PREDICATE_SIGNATURES[output.predicate];
      if (
        subjectEntity &&
        objectEntity &&
        (subjectEntity.kind !== signature.subject ||
          objectEntity.kind !== signature.object)
      ) {
        errors.push(buildValidationError("invalid_predicate_signature", "$.predicate"));
      }
    }
  } else {
    const reasonPath = "$.reason_code";
    const allowedReasons =
      output.status === "needs_clarification"
        ? CLARIFICATION_REASONS
        : UNSUPPORTED_REASONS;
    if (output.reason_code === null || !allowedReasons.has(output.reason_code)) {
      errors.push(buildValidationError("invalid_status_combination", reasonPath));
    }
    if (anyClaimFieldSet || output.alleged_source_actor_id !== null) {
      errors.push(buildValidationError("invalid_status_combination", "$"));
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  if (output.status !== "normalized") {
    return { valid: true, result: output, normalizedKey: null };
  }

  const subjectEntity = entityById.get(output.subject_entity_id!)!;
  const objectEntity = entityById.get(output.object_entity_id!)!;
  const normalizedKey = claimKeyV1({
    subjectEntityType: subjectEntity.kind,
    subjectEntityKey: output.subject_entity_id!,
    predicate: output.predicate!,
    objectEntityType: objectEntity.kind,
    objectEntityKey: output.object_entity_id!,
    polarity: output.polarity!,
    contextKey: output.context_key!,
  });

  return { valid: true, result: output, normalizedKey };
}
