import { describe, expect, it } from "vitest";

import { isDatabaseUuid } from "./identifiers.js";

describe("isDatabaseUuid", () => {
  it("recognizes the persistence representation without exposing it publicly", () => {
    expect(isDatabaseUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isDatabaseUuid("not-a-uuid")).toBe(false);
  });
});
