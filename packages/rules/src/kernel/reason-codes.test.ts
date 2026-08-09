import { describe, expect, it } from "vitest";

import { REASON_CODE_PATTERN, REASON_CODES } from "./reason-codes.js";

describe("REASON_CODES", () => {
  it("matches the DeniedActionResult.reasonCode pattern for every entry", () => {
    for (const code of REASON_CODES) {
      expect(code).toMatch(REASON_CODE_PATTERN);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
  });
});
