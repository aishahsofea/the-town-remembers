import { NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY } from "@the-town-remembers/model-contracts";
import type { NpcDialogueTrustedContext } from "@the-town-remembers/model-contracts";
import { describe, expect, it } from "vitest";

import { validateNpcDialogueSelection } from "./dialogue.js";

function trustedContext(
  overrides: Partial<NpcDialogueTrustedContext> = {},
): NpcDialogueTrustedContext {
  return {
    npc_profile: {
      npc_id: "npc_mara",
      display_name: "Mara Venn",
      voice_rules: [],
      current_location_id: "lantern_inn",
    },
    player_action: { action_kind: "ask", target_entity_ids: [] },
    relationship_stance: "neutral",
    dialogue_directive: { required_act: "answer_question", gate_result: "passed" },
    allowed_response_kinds: ["answer", "deflect"],
    approved_disclosures: [
      {
        disclosure_id: "d1",
        claim_id: "corin_was_at_inn",
        stance: "believed",
        source_episode_id: "e1",
        parent_transmission_id: null,
        tier: "guarded",
        permitted_entity_ids: ["corin_hale"],
      },
    ],
    required_disclosure_ids: ["d1"],
    approved_outcomes: [],
    required_outcome_ids: [],
    approved_renderings: [
      {
        rendering_id: "r1",
        text: "Corin came through before dawn, quiet about it.",
        response_kind: "answer",
        disclosure_ids: ["d1"],
        outcome_ids: [],
        episode_ids: ["e1"],
        entity_ids: ["corin_hale"],
        actor_ids: [],
        style_tags: [],
      },
      {
        rendering_id: "r2",
        text: "He asked me to keep Lark inside while he sorted the bell out himself.",
        response_kind: "answer",
        disclosure_ids: ["d1"],
        outcome_ids: [],
        episode_ids: ["e1"],
        entity_ids: [],
        actor_ids: [],
        style_tags: [],
      },
      {
        rendering_id: "r3",
        text: "There is too much frightened talk already.",
        response_kind: "deflect",
        disclosure_ids: [],
        outcome_ids: [],
        episode_ids: [],
        entity_ids: [],
        actor_ids: [],
        style_tags: [],
      },
    ],
    approved_episodes: [{ episode_id: "e1", summary: "Mara saw Corin enter the inn." }],
    canonical_entities: [{ entity_id: "corin_hale", display_name: "Corin Hale" }],
    approved_actors: [],
    response_limits: NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
    ...overrides,
  };
}

describe("validateNpcDialogueSelection: success", () => {
  it("accepts a single rendering covering the one required disclosure", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r1"] },
      trustedContext(),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.expressedDisclosureIds).toStrictEqual(["d1"]);
      expect(result.concatenatedText).toBe(
        "Corin came through before dawn, quiet about it.",
      );
    }
  });

  it("accepts up to three renderings and concatenates them in selection order", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r2", "r1"] },
      trustedContext(),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.concatenatedText).toBe(
        "He asked me to keep Lark inside while he sorted the bell out himself. " +
          "Corin came through before dawn, quiet about it.",
      );
    }
  });
});

describe("validateNpcDialogueSelection: membership and shape", () => {
  it("rejects a response_kind outside allowed_response_kinds", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "react", rendering_ids: ["r1"] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("response_kind_conflict");
  });

  it("rejects an unknown rendering id", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r_nope"] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("unknown_rendering_id");
  });

  it("rejects a duplicated rendering id", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r1", "r1"] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("duplicate_choice");
  });

  it("rejects zero renderings", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: [] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("rendering_limit_exceeded");
  });

  it("rejects more than three renderings", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r1", "r1", "r1", "r1"] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("rendering_limit_exceeded");
  });

  it("rejects a rendering incompatible with the declared response kind", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "deflect", rendering_ids: ["r1"] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("response_kind_conflict");
  });
});

describe("validateNpcDialogueSelection: required coverage", () => {
  it("rejects a selection missing a required disclosure", () => {
    const result = validateNpcDialogueSelection(
      { response_kind: "deflect", rendering_ids: ["r3"] },
      trustedContext(),
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("missing_required_disclosure");
  });

  it("rejects a selection missing a required outcome", () => {
    const context = trustedContext({
      required_outcome_ids: ["o1"],
      approved_outcomes: [
        { outcome_id: "o1", kind: "requested_item_received", summary: "x" },
      ],
    });
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r1"] },
      context,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("missing_required_outcome");
  });
});

describe("validateNpcDialogueSelection: gate result", () => {
  it("rejects a substantive answer when the gate result denied the request", () => {
    const context = trustedContext({
      dialogue_directive: {
        required_act: "answer_question",
        gate_result: "denied_access",
      },
    });
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r1"] },
      context,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("gate_result_conflict");
  });

  it("accepts a deflection when the gate result denied the request", () => {
    const context = trustedContext({
      dialogue_directive: {
        required_act: "answer_question",
        gate_result: "denied_access",
      },
      required_disclosure_ids: [],
      allowed_response_kinds: ["deflect"],
    });
    const result = validateNpcDialogueSelection(
      { response_kind: "deflect", rendering_ids: ["r3"] },
      context,
    );
    expect(result.valid).toBe(true);
  });
});

describe("validateNpcDialogueSelection: length limits", () => {
  it("rejects a concatenation exceeding the accepted word limit", () => {
    const longText = Array.from({ length: 90 }, () => "word").join(" ") + ".";
    const context = trustedContext({
      required_disclosure_ids: [],
      approved_renderings: [
        {
          rendering_id: "r_long",
          text: longText,
          response_kind: "answer",
          disclosure_ids: [],
          outcome_ids: [],
          episode_ids: [],
          entity_ids: [],
          actor_ids: [],
          style_tags: [],
        },
      ],
    });
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r_long"] },
      context,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("response_too_long");
  });

  it("rejects a concatenation exceeding the accepted sentence limit", () => {
    const context = trustedContext({
      required_disclosure_ids: [],
      approved_renderings: [
        {
          rendering_id: "r_sentences",
          text: "One. Two. Three. Four.",
          response_kind: "answer",
          disclosure_ids: [],
          outcome_ids: [],
          episode_ids: [],
          entity_ids: [],
          actor_ids: [],
          style_tags: [],
        },
      ],
    });
    const result = validateNpcDialogueSelection(
      { response_kind: "answer", rendering_ids: ["r_sentences"] },
      context,
    );
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.map((e) => e.code)).toContain("response_too_long");
  });
});
