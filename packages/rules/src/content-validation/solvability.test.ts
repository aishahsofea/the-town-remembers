import { describe, expect, it } from "vitest";

import { allChecksPass, runNoSoftLockChecklist } from "./solvability.js";

describe("Decision 009's five-item no-soft-lock checklist", () => {
  const results = runNoSoftLockChecklist();

  it("runs exactly five checks", () => {
    expect(results).toHaveLength(5);
  });

  it.each(runNoSoftLockChecklist().map((result) => [result.name] as const))(
    "%s",
    (name) => {
      const result = results.find((entry) => entry.name === name);
      expect(result?.passed).toBe(true);
    },
  );

  it("all five checks pass together", () => {
    expect(allChecksPass(results)).toBe(true);
  });
});
