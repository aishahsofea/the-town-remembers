import { describe, expect, it } from "vitest";

import { DIRECT_OBSERVATION_WEIGHT, RULES_VERSION } from "@the-town-remembers/content";
import {
  BELIEF_LABEL_BANDS,
  HOP_RANGE,
  IMPORTANCE_RANGE,
  MAXIMUM_NPC_RECIPIENT_HOP,
  SCORE_RANGE,
} from "@the-town-remembers/database/domains";
import {
  AMBIENT_CANDIDATE_SHORTLIST_SIZE,
  AMBIENT_MAXIMUM_SELECTIONS,
} from "@the-town-remembers/model-contracts";

import { RULES_REGISTRY } from "./version.js";

describe("RULES_REGISTRY", () => {
  it("re-exports database/domains constants by reference, not by value", () => {
    expect(RULES_REGISTRY.scoreRange).toBe(SCORE_RANGE);
    expect(RULES_REGISTRY.importanceRange).toBe(IMPORTANCE_RANGE);
    expect(RULES_REGISTRY.hopRange).toBe(HOP_RANGE);
    expect(RULES_REGISTRY.maximumNpcRecipientHop).toBe(MAXIMUM_NPC_RECIPIENT_HOP);
    expect(RULES_REGISTRY.beliefLabelBands).toBe(BELIEF_LABEL_BANDS);
  });

  it("re-exports model-contracts constants by reference", () => {
    expect(RULES_REGISTRY.ambientShortlistSize).toBe(AMBIENT_CANDIDATE_SHORTLIST_SIZE);
    expect(RULES_REGISTRY.ambientMaximumSelections).toBe(AMBIENT_MAXIMUM_SELECTIONS);
  });

  it("re-exports content constants by reference", () => {
    expect(RULES_REGISTRY.rulesVersion).toBe(RULES_VERSION);
    expect(RULES_REGISTRY.directObservationWeight).toBe(DIRECT_OBSERVATION_WEIGHT);
  });

  it("names mvp-rules-v1", () => {
    expect(RULES_REGISTRY.rulesVersion).toBe("mvp-rules-v1");
  });

  it("is deeply frozen at every level a test can reach", () => {
    expect(Object.isFrozen(RULES_REGISTRY)).toBe(true);
    expect(Object.isFrozen(RULES_REGISTRY.testimonyFormula)).toBe(true);
    expect(Object.isFrozen(RULES_REGISTRY.relationshipDeltas)).toBe(true);
    expect(Object.isFrozen(RULES_REGISTRY.recall)).toBe(true);
    expect(Object.isFrozen(RULES_REGISTRY.boundaryTestValues)).toBe(true);
  });

  it("quotes Decision 008's exact boundary test values", () => {
    expect(RULES_REGISTRY.boundaryTestValues).toStrictEqual([
      -20, 19, 20, 39, 40, 59, 60,
    ]);
  });
});
