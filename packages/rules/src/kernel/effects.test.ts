import { describe, expect, it } from "vitest";

import {
  isConditionalStateChangeEffect,
  isEventOriginEffect,
  isInsertEffect,
  isPlanRef,
  type EffectPlanEntry,
  type InsertEffect,
  type PlanRef,
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

describe("plan-local reference handles (D4-F)", () => {
  it("recognizes a well-formed plan ref", () => {
    const ref: PlanRef = { $planRef: "ep1" };
    expect(isPlanRef(ref)).toBe(true);
  });

  it.each([
    ["a plain string", "ep1"],
    ["null", null],
    ["undefined", undefined],
    ["an array", ["ep1"]],
    ["an object with the wrong key", { planRef: "ep1" }],
    ["a $planRef whose value is not a string", { $planRef: 1 }],
  ])("rejects %s", (_label, value) => {
    expect(isPlanRef(value)).toBe(false);
  });

  it("lets an insert effect declare a ref other effects in the same plan can point back at", () => {
    const episodeInsert: InsertEffect<"episodes", { readonly summary: string }> = {
      kind: "insert",
      table: "episodes",
      row: { summary: "Saw the bell near the garden." },
      ref: "ep1",
    };
    expect(episodeInsert.ref).toBe("ep1");

    interface TransmissionRow {
      readonly episode_id: string | PlanRef;
    }
    const transmissionInsert: InsertEffect<"claim_transmissions", TransmissionRow> = {
      kind: "insert",
      table: "claim_transmissions",
      row: { episode_id: { $planRef: "ep1" } },
    };
    expect(isPlanRef(transmissionInsert.row.episode_id)).toBe(true);
  });

  it("leaves ref optional so every existing insert effect still typechecks", () => {
    const withoutRef: InsertEffect = {
      kind: "insert",
      table: "belief_evidence",
      row: {},
    };
    expect(withoutRef.ref).toBeUndefined();
  });
});
