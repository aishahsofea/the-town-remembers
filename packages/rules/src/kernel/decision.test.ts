import { describe, expect, it } from "vitest";

import { deniedResult } from "./decision.js";
import { ruleTrace } from "./trace.js";

describe("deniedResult", () => {
  it("builds a denied outcome with no effects", () => {
    const trace = ruleTrace({
      rulesVersion: "mvp-rules-v1",
      ruleName: "example_rule",
      matchedStableKeys: [],
      matchedReasonCode: "REVISION_CONFLICT",
    });

    const result = deniedResult("REVISION_CONFLICT", trace, { expectedRevision: 4 });

    expect(result).toStrictEqual({
      outcome: "denied",
      reasonCode: "REVISION_CONFLICT",
      effects: [],
      preconditions: { expectedRevision: 4 },
      trace,
    });
  });
});
