/**
 * The eighteen `REPAIR_VALIDATION_ERROR_CODES` (Decision 010), each mapped
 * to one fixed, sanitized explanation sentence. `buildValidationError` is
 * the only way another validator in this package may construct a
 * `RepairValidationError`, and it never accepts caller-supplied prose for
 * the explanation — only the code and a JSON path. That is what makes "no
 * secrets, no raw database row, no case-solution string, no error message
 * quoting hidden truth" true by construction rather than by author
 * discipline: there is no parameter through which any of that could flow.
 */

import {
  REPAIR_VALIDATION_ERROR_CODES,
  type RepairValidationError,
  type RepairValidationErrorCode,
} from "@the-town-remembers/model-contracts";

export const SANITIZED_VALIDATION_EXPLANATIONS: Readonly<
  Record<RepairValidationErrorCode, string>
> = Object.freeze({
  schema_mismatch: "The result did not match the required output schema.",
  invalid_status_combination: "The claim fields did not match the declared status.",
  unknown_entity_id: "An ID was not one of the supplied canonical entities or actors.",
  invalid_context_key: "The context key was not one of the supplied allowed contexts.",
  unknown_disclosure_id:
    "A disclosure ID was not one of the supplied approved disclosures.",
  unknown_rendering_id:
    "A rendering ID was not one of the supplied approved renderings.",
  unknown_episode_id: "An episode ID was not one of the supplied approved episodes.",
  invalid_predicate_signature:
    "The subject and object kinds did not match the predicate's required signature.",
  missing_required_disclosure:
    "A required disclosure was not expressed by the selection.",
  missing_required_outcome: "A required outcome was not expressed by the selection.",
  rendering_limit_exceeded: "The selection exceeded the accepted rendering count.",
  response_kind_conflict:
    "A selected rendering was not compatible with the response kind.",
  response_too_long:
    "The concatenated response exceeded the accepted sentence or word limit.",
  invalid_choice_id: "A choice ID was not one of the supplied candidates.",
  duplicate_choice: "The same choice ID was selected more than once.",
  repeated_claim_hop: "Two selections advanced the same claim in one tick.",
  repeated_speaker: "Two selections used the same source NPC in one tick.",
  gate_result_conflict: "The selection did not match the supplied gate result.",
});

const KNOWN_CODES: ReadonlySet<string> = new Set(REPAIR_VALIDATION_ERROR_CODES);

export class UnknownValidationErrorCode extends Error {
  constructor(code: string) {
    super(`"${code}" is not one of the eighteen accepted repair validation codes.`);
    this.name = "UnknownValidationErrorCode";
  }
}

/**
 * Builds one sanitized validation error. `path` should be a JSON Pointer-
 * style path into the rejected output (for example `$.subject_entity_id`);
 * it is caller-supplied but is only ever a structural location, never a
 * value, so it carries nothing to sanitize.
 */
export function buildValidationError(
  code: RepairValidationErrorCode,
  path: string,
): RepairValidationError {
  if (!KNOWN_CODES.has(code)) throw new UnknownValidationErrorCode(code);
  return { code, path, explanation: SANITIZED_VALIDATION_EXPLANATIONS[code] };
}
