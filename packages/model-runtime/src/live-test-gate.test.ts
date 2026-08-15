import { describe, expect, it } from "vitest";

import { evaluateLiveModelTestGate } from "./live-test-gate.js";

describe("evaluateLiveModelTestGate", () => {
  it("does not run and explains why when the opt-in flag is unset", () => {
    const gate = evaluateLiveModelTestGate({});
    expect(gate.shouldRun).toBe(false);
    expect(gate.skipReason).toMatch(/TTR_MODEL_LIVE_TESTS/);
  });

  it("does not run and explains why when the flag is set but no credential hint is present", () => {
    const gate = evaluateLiveModelTestGate({ TTR_MODEL_LIVE_TESTS: "1" });
    expect(gate.shouldRun).toBe(false);
    expect(gate.skipReason).toMatch(/credential/i);
  });

  it("runs when the flag is set and at least one credential hint is present", () => {
    for (const credentialVar of [
      "AWS_ACCESS_KEY_ID",
      "AWS_PROFILE",
      "AWS_ROLE_ARN",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    ]) {
      const gate = evaluateLiveModelTestGate({
        TTR_MODEL_LIVE_TESTS: "1",
        [credentialVar]: "some-value",
      });
      expect(gate.shouldRun).toBe(true);
      expect(gate.skipReason).toBe("");
    }
  });

  it("does not run when a credential variable is set but empty", () => {
    const gate = evaluateLiveModelTestGate({
      TTR_MODEL_LIVE_TESTS: "1",
      AWS_ACCESS_KEY_ID: "",
    });
    expect(gate.shouldRun).toBe(false);
  });
});
