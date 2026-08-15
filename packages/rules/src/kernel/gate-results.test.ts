import { describe, expect, expectTypeOf, it } from "vitest";

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
    // Compile-time only (VPR-10): if isGateResult were not declared as
    // `value is GateResult`, this line would fail typecheck, not just this
    // assertion -- and pnpm typecheck already runs over every *.test.ts.
    const candidate: string = "denied_belief";
    if (isGateResult(candidate)) {
      expectTypeOf(candidate).toEqualTypeOf<GateResult>();
    } else {
      throw new Error("expected denied_belief to be a recognized gate result");
    }
  });
});
