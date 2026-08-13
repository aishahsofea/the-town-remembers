import {
  PROMPT_VERSIONS,
  OUTPUT_SCHEMA_NAMES,
  VALIDATION_POLICY_VERSIONS,
} from "@the-town-remembers/model-contracts";
import { describe, expect, it } from "vitest";

import {
  resolveDialogueModelRole,
  resolveModelForRole,
  type ModelResolutionConfig,
} from "./model-resolution.js";

const CONFIG: ModelResolutionConfig = {
  haikuModelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
  sonnetModelId: "anthropic.claude-sonnet-5-20260101-v1:0",
  haikuInferenceProfileArn: undefined,
  sonnetInferenceProfileArn: undefined,
};

describe("resolveDialogueModelRole", () => {
  it("picks Sonnet by default", () => {
    expect(resolveDialogueModelRole(false)).toBe("sonnet");
  });

  it("picks Haiku under reduced-cost mode", () => {
    expect(resolveDialogueModelRole(true)).toBe("haiku");
  });
});

describe("resolveModelForRole", () => {
  it("resolves the bare model id when no inference profile is configured", () => {
    expect(resolveModelForRole("sonnet", CONFIG)).toStrictEqual({
      role: "sonnet",
      modelId: CONFIG.sonnetModelId,
      inferenceProfile: CONFIG.sonnetModelId,
    });
    expect(resolveModelForRole("haiku", CONFIG)).toStrictEqual({
      role: "haiku",
      modelId: CONFIG.haikuModelId,
      inferenceProfile: CONFIG.haikuModelId,
    });
  });

  it("prefers the inference profile ARN when configured (D4-N)", () => {
    const withProfile: ModelResolutionConfig = {
      ...CONFIG,
      sonnetInferenceProfileArn: "arn:aws:bedrock:us-east-1:1:profile/sonnet",
    };
    expect(resolveModelForRole("sonnet", withProfile)).toStrictEqual({
      role: "sonnet",
      modelId: "arn:aws:bedrock:us-east-1:1:profile/sonnet",
      inferenceProfile: "arn:aws:bedrock:us-east-1:1:profile/sonnet",
    });
  });

  it("never resolves an empty inference profile", () => {
    expect(
      resolveModelForRole("haiku", CONFIG).inferenceProfile.length,
    ).toBeGreaterThan(0);
    expect(
      resolveModelForRole("sonnet", CONFIG).inferenceProfile.length,
    ).toBeGreaterThan(0);
  });
});

describe("model resolution never changes prompt, schema, or validator versions", () => {
  it("keeps one fixed npc-dialogue prompt/schema/validator version regardless of role", () => {
    const sonnetRole = resolveDialogueModelRole(false);
    const haikuRole = resolveDialogueModelRole(true);
    expect(sonnetRole).not.toBe(haikuRole);

    // The point under test: nothing about picking a role touches these
    // constants — they are the same fixed values whichever model answers.
    expect(PROMPT_VERSIONS.npcDialogue).toBe("npc-dialogue/1.0.0");
    expect(OUTPUT_SCHEMA_NAMES.npcDialogue).toBe("npc_dialogue_v1");
    expect(VALIDATION_POLICY_VERSIONS.npcDialogue).toBe("npc-dialogue-validator/1.0.0");
  });
});
