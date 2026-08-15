import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLAIM_NORMALIZATION_PROMPT_V1_0_0,
  NPC_DIALOGUE_PROMPT_V1_0_0,
  STRUCTURED_REPAIR_OVERLAY_V1_0_0,
  promptHash,
  repairPromptHash,
} from "./prompts/index.js";

const DECISION_010_PATH = fileURLToPath(
  new URL("../../../docs/010-bedrock-prompt-contracts.md", import.meta.url),
);

/**
 * Extracts a ` ```text ` fenced block's exact content following the given
 * heading line, the same way the throwaway script that seeded the checked-in
 * constants did. If Decision 010 changes and a prompt constant does not, this
 * comparison fails.
 */
function extractFencedBlock(heading: string): string {
  const decisionText = readFileSync(DECISION_010_PATH, "utf8");
  const headingIndex = decisionText.indexOf(heading);
  if (headingIndex === -1) {
    throw new Error(
      `docs/010-bedrock-prompt-contracts.md no longer contains: ${heading}`,
    );
  }
  const fenceOpen = decisionText.indexOf("```text", headingIndex);
  const contentStart = decisionText.indexOf("\n", fenceOpen) + 1;
  const fenceClose = decisionText.indexOf("\n```", contentStart);
  return decisionText.slice(contentStart, fenceClose);
}

const PROMPT_SOURCE_FILES = [
  "./prompts/claim-normalization.ts",
  "./prompts/npc-dialogue.ts",
  "./prompts/structured-repair.ts",
] as const;

describe("prompt text drift against Decision 010", () => {
  it("matches the exact claim-normalization system prompt", () => {
    expect(CLAIM_NORMALIZATION_PROMPT_V1_0_0).toBe(
      extractFencedBlock("### Exact system prompt: `claim-normalization/1.0.0`"),
    );
  });

  it("matches the exact npc-dialogue system prompt", () => {
    expect(NPC_DIALOGUE_PROMPT_V1_0_0).toBe(
      extractFencedBlock("### Exact system prompt: `npc-dialogue/1.0.0`"),
    );
  });

  it("matches the exact structured-repair overlay", () => {
    expect(STRUCTURED_REPAIR_OVERLAY_V1_0_0).toBe(
      extractFencedBlock("### Exact system overlay: `structured-repair/1.0.0`"),
    );
  });

  it("never contains a runtime interpolation", () => {
    for (const relativePath of PROMPT_SOURCE_FILES) {
      const source = readFileSync(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        "utf8",
      );
      expect(source).not.toContain("${");
    }
  });
});

describe("prompt hashing (D4-T)", () => {
  it("hashes the exact system prompt text to 32 bytes matching a known digest", () => {
    const hash = promptHash("town");
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash).toHaveLength(32);
    expect(hash.toString("hex")).toBe(
      "50ac81f970325a3e011f2437818adde426e1278dee5670dd359edfca43a72d79",
    );
  });

  it("is stable across repeated calls with the same text", () => {
    expect(promptHash(NPC_DIALOGUE_PROMPT_V1_0_0)).toStrictEqual(
      promptHash(NPC_DIALOGUE_PROMPT_V1_0_0),
    );
  });

  it("changes when the text changes by even one character", () => {
    expect(promptHash("a")).not.toStrictEqual(promptHash("b"));
  });

  it("repair hash differs from both of its inputs and from a naive concatenation", () => {
    const target = CLAIM_NORMALIZATION_PROMPT_V1_0_0;
    const overlay = STRUCTURED_REPAIR_OVERLAY_V1_0_0;
    const repair = repairPromptHash(target, overlay);
    expect(repair).toHaveLength(32);
    expect(repair).not.toStrictEqual(promptHash(target));
    expect(repair).not.toStrictEqual(promptHash(overlay));
    expect(repair).not.toStrictEqual(promptHash(target + overlay));
  });

  it("orders the target prompt before the overlay", () => {
    expect(repairPromptHash("a", "b")).not.toStrictEqual(repairPromptHash("b", "a"));
  });

  it("is stable across repeated calls with the same pair", () => {
    expect(repairPromptHash("a", "b")).toStrictEqual(repairPromptHash("a", "b"));
  });
});
