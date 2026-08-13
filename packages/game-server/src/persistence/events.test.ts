import { describe, expect, it } from "vitest";

import { effectKey } from "./events.js";

describe("effectKey", () => {
  it("matches Decision 005's derivation exactly", () => {
    expect(effectKey("abc-123", 0)).toBe("player:abc-123:0");
    expect(effectKey("abc-123", 2)).toBe("player:abc-123:2");
  });
});
