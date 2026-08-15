import { describe, expect, it } from "vitest";

import {
  COST_MODE_THRESHOLDS_MICRO_USD,
  modelCallsAdmitted,
  reducedCostModeActive,
  resolveCostMode,
  shouldStopNewTowns,
} from "./mode.js";

describe("resolveCostMode", () => {
  it("is normal below the $8.00 threshold", () => {
    expect(resolveCostMode(0)).toBe("normal");
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.reducedCost - 1)).toBe(
      "normal",
    );
  });

  it("switches to reduced_cost exactly at $8.00", () => {
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.reducedCost)).toBe(
      "reduced_cost",
    );
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.tighten - 1)).toBe(
      "reduced_cost",
    );
  });

  it("switches to tighten exactly at $9.50", () => {
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.tighten)).toBe("tighten");
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.hardCap - 1)).toBe("tighten");
  });

  it("switches to fallback_only exactly at the $10.35 hard cap", () => {
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.hardCap)).toBe(
      "fallback_only",
    );
    expect(resolveCostMode(COST_MODE_THRESHOLDS_MICRO_USD.hardCap + 1_000_000)).toBe(
      "fallback_only",
    );
  });
});

describe("reducedCostModeActive", () => {
  it("is false only in normal mode", () => {
    expect(reducedCostModeActive("normal")).toBe(false);
    expect(reducedCostModeActive("reduced_cost")).toBe(true);
    expect(reducedCostModeActive("tighten")).toBe(true);
    expect(reducedCostModeActive("fallback_only")).toBe(true);
  });
});

describe("modelCallsAdmitted", () => {
  it("is false only under the hard cap", () => {
    expect(modelCallsAdmitted("normal")).toBe(true);
    expect(modelCallsAdmitted("reduced_cost")).toBe(true);
    expect(modelCallsAdmitted("tighten")).toBe(true);
    expect(modelCallsAdmitted("fallback_only")).toBe(false);
  });
});

describe("shouldStopNewTowns", () => {
  it("is true from tighten onward", () => {
    expect(shouldStopNewTowns("normal")).toBe(false);
    expect(shouldStopNewTowns("reduced_cost")).toBe(false);
    expect(shouldStopNewTowns("tighten")).toBe(true);
    expect(shouldStopNewTowns("fallback_only")).toBe(true);
  });
});
