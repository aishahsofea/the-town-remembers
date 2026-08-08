import { describe, expect, it } from "vitest";

import { ACTION_KINDS } from "@the-town-remembers/http-contracts";

import {
  actionKindsAgree,
  assertActionKindsAgree,
  DETERMINISTIC_ACTION_KINDS,
  isExternalSelectionRequired,
  isModelBackedActionKind,
  MODEL_BACKED_ACTION_KINDS,
  resumeWithDialogue,
  type ExternalSelectionRequired,
} from "./dispatcher.js";
import { ruleTrace } from "../kernel/trace.js";

describe("actionKindsAgree (D2-D)", () => {
  it("agrees between database/domains and http-contracts", () => {
    expect(actionKindsAgree()).toBe(true);
    expect(() => assertActionKindsAgree()).not.toThrow();
  });
});

describe("dispatch table completeness", () => {
  it("covers all 13 ACTION_KINDS exactly once, split between deterministic and model-backed", () => {
    const combined = [...DETERMINISTIC_ACTION_KINDS, ...MODEL_BACKED_ACTION_KINDS];
    expect(combined).toHaveLength(13);
    expect(new Set(combined)).toStrictEqual(new Set(ACTION_KINDS));
    expect(new Set(combined).size).toBe(13);
  });

  it("classifies each kind consistently with isModelBackedActionKind", () => {
    for (const kind of ACTION_KINDS) {
      expect(isModelBackedActionKind(kind)).toBe(
        (MODEL_BACKED_ACTION_KINDS as readonly string[]).includes(kind),
      );
    }
  });
});

describe("resumeWithDialogue", () => {
  it("resolves a pending external selection into an applied DecisionResult", () => {
    const pending: ExternalSelectionRequired = {
      kind: "external_selection_required",
      effects: [{ kind: "event_origin", eventType: "evidence_shown", effectIndex: 0 }],
      trustedContext: {
        approvedDisclosures: [],
        requiredDisclosureIds: [],
        approvedOutcomes: [],
        requiredOutcomeIds: [],
        approvedEpisodes: [],
      },
      trace: ruleTrace({
        rulesVersion: "mvp-rules-v1",
        ruleName: "actions.show",
        matchedStableKeys: [],
        matchedReasonCode: "OK",
      }),
    };

    expect(isExternalSelectionRequired(pending)).toBe(true);

    const resolved = resumeWithDialogue(pending, {
      npcId: "npc-1",
      text: "I saw it happen.",
      responseMode: "selected",
    });

    expect(resolved.outcome).toBe("applied");
    expect(resolved.effects).toBe(pending.effects);
    expect(isExternalSelectionRequired(resolved)).toBe(false);
  });
});
