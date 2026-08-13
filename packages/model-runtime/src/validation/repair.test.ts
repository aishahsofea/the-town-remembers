import type {
  ClaimNormalizationTrustedContext,
  NpcDialogueTrustedContext,
} from "@the-town-remembers/model-contracts";
import { NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY } from "@the-town-remembers/model-contracts";
import { describe, expect, it } from "vitest";

import { buildValidationError } from "./errors.js";
import {
  buildClaimNormalizationRepairFromFailure,
  buildNpcDialogueRepairFromFailure,
  RepairOfRepairError,
} from "./repair.js";

const NORMALIZATION_CONTEXT: ClaimNormalizationTrustedContext = {
  speaker_actor_id: "actor_lark",
  canonical_entities: [],
  canonical_actors: [],
  predicate_signatures: [],
  allowed_contexts: [{ context_key: "festival_night", aliases: [] }],
  default_context_key: "festival_night",
};

const DIALOGUE_CONTEXT: NpcDialogueTrustedContext = {
  npc_profile: {
    npc_id: "npc_mara",
    display_name: "Mara Venn",
    voice_rules: [],
    current_location_id: "lantern_inn",
  },
  player_action: { action_kind: "ask", target_entity_ids: [] },
  relationship_stance: "neutral",
  dialogue_directive: { required_act: "answer_question", gate_result: "passed" },
  allowed_response_kinds: ["answer"],
  approved_disclosures: [],
  required_disclosure_ids: [],
  approved_outcomes: [],
  required_outcome_ids: [],
  approved_renderings: [],
  approved_episodes: [],
  canonical_entities: [],
  approved_actors: [],
  response_limits: NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
};

describe("buildClaimNormalizationRepairFromFailure", () => {
  it("builds a repair input from an original attempt's failure", () => {
    const input = buildClaimNormalizationRepairFromFailure({
      failedAttemptKind: "original",
      trustedContext: NORMALIZATION_CONTEXT,
      rawInvalidOutput: '{"status":"invented"}',
      validationErrors: [buildValidationError("schema_mismatch", "$.status")],
    });
    expect(input.target_task).toBe("claim_normalization");
    expect(input.untrusted_invalid_output).toBe('{"status":"invented"}');
  });

  it("refuses to build a repair input from an already-repaired attempt's failure", () => {
    expect(() =>
      buildClaimNormalizationRepairFromFailure({
        failedAttemptKind: "repair",
        trustedContext: NORMALIZATION_CONTEXT,
        rawInvalidOutput: '{"status":"invented"}',
        validationErrors: [buildValidationError("schema_mismatch", "$.status")],
      }),
    ).toThrow(RepairOfRepairError);
  });
});

describe("buildNpcDialogueRepairFromFailure", () => {
  it("builds a repair input from an original attempt's failure", () => {
    const input = buildNpcDialogueRepairFromFailure({
      failedAttemptKind: "original",
      trustedContext: DIALOGUE_CONTEXT,
      rawInvalidOutput: '{"response_kind":"invented"}',
      validationErrors: [
        buildValidationError("unknown_rendering_id", "$.rendering_ids[0]"),
      ],
    });
    expect(input.target_task).toBe("npc_dialogue");
  });

  it("refuses to build a repair input from an already-repaired attempt's failure", () => {
    expect(() =>
      buildNpcDialogueRepairFromFailure({
        failedAttemptKind: "repair",
        trustedContext: DIALOGUE_CONTEXT,
        rawInvalidOutput: '{"response_kind":"invented"}',
        validationErrors: [
          buildValidationError("unknown_rendering_id", "$.rendering_ids[0]"),
        ],
      }),
    ).toThrow(RepairOfRepairError);
  });
});
