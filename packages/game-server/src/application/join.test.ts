import { describe, expect, it } from "vitest";

import { normalizeDisplayName } from "./join.js";

describe("normalizeDisplayName", () => {
  it("folds case, whitespace, and compatibility width to the same key", () => {
    const expected = "mara venn";
    expect(normalizeDisplayName("Mara Venn")).toBe(expected);
    expect(normalizeDisplayName("mara venn")).toBe(expected);
    expect(normalizeDisplayName("MARA  VENN")).toBe(expected);
    expect(normalizeDisplayName("Ｍara Venn")).toBe(expected);
  });

  it("matches town-seed's own NPC actor normalization exactly", () => {
    // packages/town-seed/src/plan.ts normalizes character.displayName with
    // the identical NFKC -> trim -> collapse -> lowercase pipeline.
    expect(normalizeDisplayName("Mara Venn")).toBe(
      "Mara Venn".normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toLowerCase(),
    );
  });
});
