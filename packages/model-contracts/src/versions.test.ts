import { describe, expect, it } from "vitest";

import {
  AMBIENT_DO_NOTHING_REASON,
  AMBIENT_SELECTION_REASONS,
  AmbientChoiceV1Schema,
} from "./ambient-choice.js";
import {
  CLAIM_CLARIFICATION_REASON_CODES,
  CLAIM_NORMALIZATION_REASON_CODES,
  CLAIM_PREDICATES,
  CLAIM_PREDICATE_SIGNATURES,
  ClaimNormalizationV1Schema,
} from "./claim-normalization.js";
import { NpcDialogueV1Schema } from "./npc-dialogue.js";
import {
  INFERENCE_SETTINGS,
  OUTPUT_SCHEMA_NAMES,
  PROMPT_VERSIONS,
  REPAIR_VALIDATION_ERROR_CODES,
  TASK_INPUT_VERSIONS,
  VALIDATION_POLICY_VERSIONS,
  WARMUP_PAIRS,
} from "./versions.js";

describe("version constants", () => {
  it("exposes the four accepted prompt versions", () => {
    expect(Object.values(PROMPT_VERSIONS)).toStrictEqual([
      "claim-normalization/1.0.0",
      "npc-dialogue/1.0.0",
      "ambient-choice/1.0.0",
      "structured-repair/1.0.0",
    ]);
  });

  it("exposes one task-input version per prompt", () => {
    expect(Object.keys(TASK_INPUT_VERSIONS).toSorted()).toStrictEqual(
      Object.keys(PROMPT_VERSIONS).toSorted(),
    );
  });

  it("exposes three validator versions because repair inherits its target", () => {
    expect(Object.values(VALIDATION_POLICY_VERSIONS)).toStrictEqual([
      "claim-normalization-validator/1.0.0",
      "npc-dialogue-validator/1.0.0",
      "ambient-choice-validator/1.0.0",
    ]);
    expect(VALIDATION_POLICY_VERSIONS).not.toHaveProperty("structuredRepair");
  });

  it("names the three output schemas that four prompts share", () => {
    expect(Object.values(OUTPUT_SCHEMA_NAMES)).toStrictEqual([
      "claim_normalization_v1",
      "npc_dialogue_v1",
      "ambient_choice_v1",
    ]);
  });

  it("records the accepted inference settings", () => {
    expect(INFERENCE_SETTINGS.claimNormalization).toStrictEqual({
      temperature: 0,
      maximumOutputTokens: 256,
    });
    expect(INFERENCE_SETTINGS.npcDialogue).toStrictEqual({
      temperature: 0.4,
      maximumOutputTokens: 384,
    });
    expect(INFERENCE_SETTINGS.ambientChoice).toStrictEqual({
      temperature: 0.2,
      maximumOutputTokens: 128,
    });
    expect(INFERENCE_SETTINGS.structuredRepair).toStrictEqual({ temperature: 0 });
  });

  it("lists the eighteen permitted repair validation codes", () => {
    expect(REPAIR_VALIDATION_ERROR_CODES).toHaveLength(18);
    expect(new Set(REPAIR_VALIDATION_ERROR_CODES).size).toBe(18);
  });

  it("warms the four accepted model and schema grammar pairs", () => {
    expect(WARMUP_PAIRS).toHaveLength(4);
    expect(WARMUP_PAIRS.filter((pair) => pair.modelRole === "sonnet")).toStrictEqual([
      { modelRole: "sonnet", schema: "npc_dialogue_v1" },
    ]);
  });
});

describe("claim normalization shape", () => {
  it("accepts a normalized result with no reason code", () => {
    expect(
      ClaimNormalizationV1Schema.safeParse({
        status: "normalized",
        subject_entity_id: "ent_corin",
        predicate: "was_at",
        object_entity_id: "ent_old_chapel",
        polarity: "positive",
        context_key: "festival_night",
        alleged_source_actor_id: null,
        reason_code: null,
      }).success,
    ).toBe(true);
  });

  it("accepts an unsupported result whose claim fields are all null", () => {
    expect(
      ClaimNormalizationV1Schema.safeParse({
        status: "unsupported",
        subject_entity_id: null,
        predicate: null,
        object_entity_id: null,
        polarity: null,
        context_key: null,
        alleged_source_actor_id: null,
        reason_code: "no_proposition",
      }).success,
    ).toBe(true);
  });

  it("requires every property, matching the Bedrock subset", () => {
    expect(ClaimNormalizationV1Schema.safeParse({ status: "normalized" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown property or predicate", () => {
    const valid = {
      status: "normalized",
      subject_entity_id: "ent_corin",
      predicate: "was_at",
      object_entity_id: "ent_old_chapel",
      polarity: "positive",
      context_key: "festival_night",
      alleged_source_actor_id: null,
      reason_code: null,
    };
    expect(
      ClaimNormalizationV1Schema.safeParse({ ...valid, confidence: 0.9 }).success,
    ).toBe(false);
    expect(
      ClaimNormalizationV1Schema.safeParse({ ...valid, predicate: "believed" }).success,
    ).toBe(false);
  });

  it("splits reason codes into clarification and unsupported sets without overlap", () => {
    const clarification = new Set<string>(CLAIM_CLARIFICATION_REASON_CODES);
    const combined = new Set<string>([
      ...CLAIM_CLARIFICATION_REASON_CODES,
      ...CLAIM_NORMALIZATION_REASON_CODES,
    ]);
    expect(combined.size).toBe(CLAIM_NORMALIZATION_REASON_CODES.length);
    expect(clarification.has("unknown_entity")).toBe(false);
  });

  it("fixes one signature per supported predicate", () => {
    expect(Object.keys(CLAIM_PREDICATE_SIGNATURES).toSorted()).toStrictEqual(
      [...CLAIM_PREDICATES].toSorted(),
    );
    expect(CLAIM_PREDICATE_SIGNATURES.is_at).toStrictEqual({
      subject: "item",
      object: "location",
    });
  });
});

describe("dialogue and ambient shapes", () => {
  it("accepts an ordered rendering selection and rejects prose", () => {
    expect(
      NpcDialogueV1Schema.safeParse({
        response_kind: "answer",
        rendering_ids: ["r1", "r2"],
      }).success,
    ).toBe(true);
    expect(
      NpcDialogueV1Schema.safeParse({
        response_kind: "answer",
        rendering_ids: ["r1"],
        text: "I closed the inn late.",
      }).success,
    ).toBe(false);
  });

  it("accepts a do-nothing decision with both slots null", () => {
    expect(
      AmbientChoiceV1Schema.safeParse({
        decision: "do_nothing",
        primary_choice_id: null,
        secondary_choice_id: null,
        selection_reason: AMBIENT_DO_NOTHING_REASON,
      }).success,
    ).toBe(true);
  });

  it("keeps the do-nothing reason inside the accepted reason enum", () => {
    expect(AMBIENT_SELECTION_REASONS).toContain(AMBIENT_DO_NOTHING_REASON);
  });

  it("rejects an ambient result that invents a third slot", () => {
    expect(
      AmbientChoiceV1Schema.safeParse({
        decision: "select_choices",
        primary_choice_id: "c1",
        secondary_choice_id: "c2",
        tertiary_choice_id: "c3",
        selection_reason: "share_salient_claim",
      }).success,
    ).toBe(false);
  });
});
