import { REPAIR_VALIDATION_ERROR_CODES } from "@the-town-remembers/model-contracts";
import { describe, expect, it } from "vitest";

import {
  buildValidationError,
  SANITIZED_VALIDATION_EXPLANATIONS,
  UnknownValidationErrorCode,
} from "./errors.js";

describe("SANITIZED_VALIDATION_EXPLANATIONS", () => {
  it("covers exactly the eighteen accepted codes", () => {
    expect(Object.keys(SANITIZED_VALIDATION_EXPLANATIONS).toSorted()).toStrictEqual(
      [...REPAIR_VALIDATION_ERROR_CODES].toSorted(),
    );
  });

  // Pins the exact sentence table so a future edit is a visible, reviewed
  // diff rather than a silent wording drift.
  it("matches the pinned sentence table", () => {
    expect(SANITIZED_VALIDATION_EXPLANATIONS).toStrictEqual({
      schema_mismatch: "The result did not match the required output schema.",
      invalid_status_combination: "The claim fields did not match the declared status.",
      unknown_entity_id:
        "An ID was not one of the supplied canonical entities or actors.",
      invalid_context_key:
        "The context key was not one of the supplied allowed contexts.",
      unknown_disclosure_id:
        "A disclosure ID was not one of the supplied approved disclosures.",
      unknown_rendering_id:
        "A rendering ID was not one of the supplied approved renderings.",
      unknown_episode_id:
        "An episode ID was not one of the supplied approved episodes.",
      invalid_predicate_signature:
        "The subject and object kinds did not match the predicate's required signature.",
      missing_required_disclosure:
        "A required disclosure was not expressed by the selection.",
      missing_required_outcome:
        "A required outcome was not expressed by the selection.",
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
  });

  it("contains no secret-shaped or entity-specific text", () => {
    for (const explanation of Object.values(SANITIZED_VALIDATION_EXPLANATIONS)) {
      expect(explanation).not.toMatch(/corin|mara|nessa|lark|chapel|bell/i);
      expect(explanation).not.toMatch(/postgresql:|https?:\/\/|[0-9a-f]{16,}/i);
    }
  });
});

describe("buildValidationError", () => {
  it("attaches the fixed sentence for the code, ignoring anything else", () => {
    const error = buildValidationError("unknown_entity_id", "$.subject_entity_id");
    expect(error).toStrictEqual({
      code: "unknown_entity_id",
      path: "$.subject_entity_id",
      explanation: SANITIZED_VALIDATION_EXPLANATIONS.unknown_entity_id,
    });
  });

  it("rejects a code outside the accepted eighteen", () => {
    // @ts-expect-error -- intentionally invalid input under test
    expect(() => buildValidationError("made_up_code", "$")).toThrow(
      UnknownValidationErrorCode,
    );
  });
});
