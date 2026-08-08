import { describe, expect, it } from "vitest";

import {
  isConditionalStateChangeEffect,
  isEventOriginEffect,
  isInsertEffect,
  type EffectPlanEntry,
} from "./effects.js";

const insert: EffectPlanEntry = { kind: "insert", table: "belief_evidence", row: {} };
const conditional: EffectPlanEntry = {
  kind: "conditional_state_change",
  table: "npc_beliefs",
  key: { npc_id: "npc-1", claim_id: "claim-1" },
  expectedRevision: 3,
  change: { score: 42 },
};
const origin: EffectPlanEntry = {
  kind: "event_origin",
  eventType: "evidence_shown",
  effectIndex: 0,
};

describe("effect plan discriminators", () => {
  it("identifies each kind exclusively", () => {
    expect(isInsertEffect(insert)).toBe(true);
    expect(isInsertEffect(conditional)).toBe(false);
    expect(isInsertEffect(origin)).toBe(false);

    expect(isConditionalStateChangeEffect(conditional)).toBe(true);
    expect(isConditionalStateChangeEffect(insert)).toBe(false);
    expect(isConditionalStateChangeEffect(origin)).toBe(false);

    expect(isEventOriginEffect(origin)).toBe(true);
    expect(isEventOriginEffect(insert)).toBe(false);
    expect(isEventOriginEffect(conditional)).toBe(false);
  });
});
