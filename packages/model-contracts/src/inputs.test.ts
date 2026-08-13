import { describe, expect, it } from "vitest";

import {
  buildNpcDialogueInput,
  NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
  type NpcDialogueTrustedContext,
} from "./inputs/dialogue-input.js";
import {
  buildClaimNormalizationInput,
  CLAIM_PREDICATE_SIGNATURE_ENTRIES,
  type ClaimNormalizationTrustedContext,
} from "./inputs/normalization-input.js";
import {
  buildClaimNormalizationRepairInput,
  buildNpcDialogueRepairInput,
} from "./inputs/repair-input.js";

const NORMALIZATION_TRUSTED_CONTEXT: ClaimNormalizationTrustedContext = {
  speaker_actor_id: "actor_lark",
  canonical_entities: [
    {
      entity_id: "ent_corin",
      kind: "character",
      display_name: "Corin Hale",
      aliases: [],
    },
  ],
  canonical_actors: [
    {
      actor_id: "actor_lark",
      actor_kind: "player",
      display_name: "Lark",
      aliases: ["The Lark"],
    },
  ],
  predicate_signatures: CLAIM_PREDICATE_SIGNATURE_ENTRIES,
  allowed_contexts: [{ context_key: "festival_night", aliases: ["tonight"] }],
  default_context_key: "festival_night",
};

const DIALOGUE_TRUSTED_CONTEXT: NpcDialogueTrustedContext = {
  npc_profile: {
    npc_id: "npc_mara",
    display_name: "Mara Venn",
    voice_rules: ["Speaks plainly, never flatters."],
    current_location_id: "loc_square",
  },
  player_action: { action_kind: "ask", target_entity_ids: ["npc_mara"] },
  relationship_stance: "neutral",
  dialogue_directive: { required_act: "answer_question", gate_result: "passed" },
  allowed_response_kinds: ["answer", "deflect"],
  approved_disclosures: [
    {
      disclosure_id: "d1",
      claim_id: "claim_bell_at_garden",
      stance: "believed",
      source_episode_id: "ep1",
      parent_transmission_id: null,
      tier: "testimony",
      permitted_entity_ids: ["ent_bell"],
    },
  ],
  required_disclosure_ids: ["d1"],
  approved_outcomes: [],
  required_outcome_ids: [],
  approved_renderings: [
    {
      rendering_id: "r1",
      text: "I saw the bell by the garden.",
      response_kind: "answer",
      disclosure_ids: ["d1"],
      outcome_ids: [],
      episode_ids: ["ep1"],
      entity_ids: ["ent_bell"],
      actor_ids: [],
      style_tags: ["plain"],
    },
  ],
  approved_episodes: [{ episode_id: "ep1", summary: "Saw the bell near the garden." }],
  canonical_entities: [{ entity_id: "ent_bell", display_name: "the festival bell" }],
  approved_actors: [{ actor_id: "npc_mara", display_name: "Mara Venn" }],
  response_limits: NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
};

describe("claim normalization input builder", () => {
  it("builds a valid envelope with the accepted task_input_version", () => {
    const input = buildClaimNormalizationInput({
      trustedContext: NORMALIZATION_TRUSTED_CONTEXT,
      untrustedPlayerText: "I saw the bell at Reed's garden.",
    });
    expect(input.task_input_version).toBe("claim-normalization-input/1");
    expect(input.untrusted_player_text).toBe("I saw the bell at Reed's garden.");
  });

  it("rejects an object containing an unexpected key inside trusted_context", () => {
    const contaminated = { ...NORMALIZATION_TRUSTED_CONTEXT, extra_field: "nope" };
    expect(() =>
      buildClaimNormalizationInput({
        trustedContext: contaminated,
        untrustedPlayerText: "text",
      }),
    ).toThrow();
  });

  it("rejects a non-string untrusted field", () => {
    expect(() =>
      buildClaimNormalizationInput({
        trustedContext: NORMALIZATION_TRUSTED_CONTEXT,
        // @ts-expect-error -- intentionally invalid input under test
        untrustedPlayerText: 12345,
      }),
    ).toThrow();
  });

  it("rejects an untrusted field placed inside trusted_context", () => {
    const contaminated = {
      ...NORMALIZATION_TRUSTED_CONTEXT,
      untrusted_player_text: "smuggled",
    };
    expect(() =>
      buildClaimNormalizationInput({
        trustedContext: contaminated,
        untrustedPlayerText: "text",
      }),
    ).toThrow();
  });

  it("serializes byte-identically across two builds of the same logical input", () => {
    const first = buildClaimNormalizationInput({
      trustedContext: NORMALIZATION_TRUSTED_CONTEXT,
      untrustedPlayerText: "I saw the bell.",
    });
    const second = buildClaimNormalizationInput({
      trustedContext: { ...NORMALIZATION_TRUSTED_CONTEXT },
      untrustedPlayerText: "I saw the bell.",
    });
    const firstSerialized = JSON.stringify(first);
    expect(firstSerialized).toBe(JSON.stringify(second));
    expect(firstSerialized).not.toContain("\r");
    expect(firstSerialized).not.toContain("﻿");
  });

  it("derives the wire predicate signatures from the canonical table", () => {
    expect(CLAIM_PREDICATE_SIGNATURE_ENTRIES).toContainEqual({
      predicate: "is_at",
      subject_kind: "item",
      object_kind: "location",
    });
  });
});

describe("npc dialogue input builder", () => {
  it("builds a valid envelope and omits untrusted_player_text when not supplied", () => {
    const input = buildNpcDialogueInput({ trustedContext: DIALOGUE_TRUSTED_CONTEXT });
    expect(input.task_input_version).toBe("npc-dialogue-input/1");
    expect(Object.keys(input)).not.toContain("untrusted_player_text");
  });

  it("includes untrusted_player_text only when explicitly supplied", () => {
    const input = buildNpcDialogueInput({
      trustedContext: DIALOGUE_TRUSTED_CONTEXT,
      untrustedPlayerText: "was the bell there?",
    });
    expect(input.untrusted_player_text).toBe("was the bell there?");
  });

  it("rejects an unexpected key inside trusted_context", () => {
    const contaminated = { ...DIALOGUE_TRUSTED_CONTEXT, extra_field: "nope" };
    expect(() =>
      buildNpcDialogueInput({
        trustedContext: contaminated,
      }),
    ).toThrow();
  });

  it("rejects a non-string untrusted field", () => {
    expect(() =>
      buildNpcDialogueInput({
        trustedContext: DIALOGUE_TRUSTED_CONTEXT,
        // @ts-expect-error -- intentionally invalid input under test
        untrustedPlayerText: 42,
      }),
    ).toThrow();
  });

  it("serializes byte-identically across two builds of the same logical input", () => {
    const first = buildNpcDialogueInput({ trustedContext: DIALOGUE_TRUSTED_CONTEXT });
    const second = buildNpcDialogueInput({
      trustedContext: { ...DIALOGUE_TRUSTED_CONTEXT },
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("structured repair input builders", () => {
  it("builds a claim-normalization repair envelope carrying the target task's own trusted context", () => {
    const input = buildClaimNormalizationRepairInput({
      trustedContext: NORMALIZATION_TRUSTED_CONTEXT,
      untrustedInvalidOutput: "{not valid json",
      validationErrors: [
        { code: "schema_mismatch", path: "$.status", explanation: "missing status" },
      ],
    });
    expect(input.task_input_version).toBe("structured-repair-input/1");
    expect(input.target_task).toBe("claim_normalization");
    expect(input.target_prompt_version).toBe("claim-normalization/1.0.0");
    expect(input.target_schema_name).toBe("claim_normalization_v1");
  });

  it("builds an npc-dialogue repair envelope carrying the target task's own trusted context", () => {
    const input = buildNpcDialogueRepairInput({
      trustedContext: DIALOGUE_TRUSTED_CONTEXT,
      untrustedInvalidOutput: '{"response_kind":"invented"}',
      validationErrors: [
        {
          code: "unknown_rendering_id",
          path: "$.rendering_ids[0]",
          explanation: "not in approved_renderings",
        },
      ],
    });
    expect(input.target_task).toBe("npc_dialogue");
    expect(input.target_prompt_version).toBe("npc-dialogue/1.0.0");
    expect(input.target_schema_name).toBe("npc_dialogue_v1");
  });

  it("rejects an empty validation_errors array", () => {
    expect(() =>
      buildClaimNormalizationRepairInput({
        trustedContext: NORMALIZATION_TRUSTED_CONTEXT,
        untrustedInvalidOutput: "{}",
        validationErrors: [],
      }),
    ).toThrow();
  });

  it("rejects an unpermitted validation error code", () => {
    expect(() =>
      buildClaimNormalizationRepairInput({
        trustedContext: NORMALIZATION_TRUSTED_CONTEXT,
        untrustedInvalidOutput: "{}",
        // @ts-expect-error -- intentionally invalid input under test
        validationErrors: [{ code: "made_up_code", path: "$", explanation: "x" }],
      }),
    ).toThrow();
  });
});
