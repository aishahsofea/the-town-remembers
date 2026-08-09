import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { COVERAGE_MAP } from "./coverage-map.js";

const SRC_ROOT = path.resolve(import.meta.dirname, "..");

describe("COVERAGE_MAP", () => {
  it("is non-empty", () => {
    expect(COVERAGE_MAP.length).toBeGreaterThan(0);
  });

  it.each(COVERAGE_MAP.map((row) => [row.goal, row.requirement, row] as const))(
    "%s: %s resolves to a real test",
    (_goal, _requirement, row) => {
      const filePath = path.join(SRC_ROOT, row.testFile);
      expect(fs.existsSync(filePath), `${row.testFile} does not exist`).toBe(true);

      const contents = fs.readFileSync(filePath, "utf8");
      expect(
        contents.includes(row.testName),
        `${row.testFile} has no test named "${row.testName}"`,
      ).toBe(true);
    },
  );

  it("references every relevant goal from G2 through G22", () => {
    const referencedGoals = new Set(COVERAGE_MAP.map((row) => row.goal));
    for (let goalNumber = 2; goalNumber <= 22; goalNumber++) {
      expect(referencedGoals.has(`G${goalNumber}`)).toBe(true);
    }
  });
});
