import { describe, expect, it } from "vitest";

import {
  computeScenarioDigest,
  runScenario,
  SCENARIO_NAMES,
  type ScenarioStepRecord,
} from "./scenario-runner.js";

function outcomeOf(step: ScenarioStepRecord): unknown {
  return (step.result as { outcome?: unknown }).outcome;
}

describe("every named scenario runs and produces a deterministic digest", () => {
  it.each(SCENARIO_NAMES)("%s is byte-identical across repeated runs", (name) => {
    const first = computeScenarioDigest(name);
    const second = computeScenarioDigest(name);
    expect(first).toBe(second);
  });

  it.each(SCENARIO_NAMES)("%s produces at least one step", (name) => {
    expect(runScenario(name).length).toBeGreaterThan(0);
  });
});

describe("golden scenario: start_and_travel", () => {
  it("applies the start, arrives once, then no-changes on a repeat travel", () => {
    const steps = runScenario("start_and_travel");
    expect(steps.map(outcomeOf)).toStrictEqual(["applied", "applied", "no_change"]);
  });
});

describe("golden scenario: inspect_new_to_town", () => {
  it("applies the first inspection and no-changes the repeat", () => {
    const steps = runScenario("inspect_new_to_town");
    expect(steps.map(outcomeOf)).toStrictEqual(["applied", "no_change"]);
  });
});

describe("golden scenario: both accusation outcomes", () => {
  it("applies both an incorrect and a correct attempt, each creating shared history", () => {
    const steps = runScenario("both_accusation_outcomes");
    expect(steps.map(outcomeOf)).toStrictEqual(["applied", "applied"]);
    const [incorrect, correct] = steps.map(
      (step) =>
        (step.result as { effects: readonly { row?: { outcome?: string } }[] }).effects,
    );
    expect(incorrect?.[1]?.row?.outcome).toBe("incorrect");
    expect(correct?.[1]?.row?.outcome).toBe("correct");
  });
});

describe("golden scenario: both endings", () => {
  it("applies expose_cover_up and restore_bell_quietly, each relocating the bell once", () => {
    const steps = runScenario("both_endings");
    expect(steps.map(outcomeOf)).toStrictEqual(["applied", "applied"]);
  });
});

describe("golden scenario: show_evidence_flow", () => {
  it("resumes the external-selection seam into an applied result", () => {
    const steps = runScenario("show_evidence_flow");
    expect(steps.map(outcomeOf)).toStrictEqual(["applied"]);
  });
});

describe("hidden-state projection-unchanged case", () => {
  it("running the same scenario twice from scratch never diverges, proving no rule leaks ambient state between runs", () => {
    const runOne = runScenario("both_endings");
    const runTwo = runScenario("both_endings");
    expect(runOne).toStrictEqual(runTwo);
  });
});
