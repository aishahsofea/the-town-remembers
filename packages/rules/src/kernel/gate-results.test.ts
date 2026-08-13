import { describe, expect, it } from "vitest";

import { GATE_RESULTS, isGateResult, type GateResult } from "./gate-results.js";

describe("gate result domain", () => {
  it("has nine distinct values, one of them the pass-through case", () => {
    expect(GATE_RESULTS).toHaveLength(9);
    expect(new Set(GATE_RESULTS).size).toBe(9);
    expect(GATE_RESULTS).toContain("passed");
  });

  it("accepts every declared value", () => {
    for (const value of GATE_RESULTS) {
      expect(isGateResult(value)).toBe(true);
    }
  });

  it("rejects an undeclared string", () => {
    expect(isGateResult("denied_for_unstated_reason")).toBe(false);
    expect(isGateResult("")).toBe(false);
  });

  it("narrows to the GateResult type when true", () => {
    const candidate: string = "denied_belief";
    if (isGateResult(candidate)) {
      const narrowed: GateResult = candidate;
      expect(narrowed).toBe("denied_belief");
    } else {
      throw new Error("expected denied_belief to be a recognized gate result");
    }
  });
});
