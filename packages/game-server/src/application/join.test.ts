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
    expect(normalizeDisplayName("Mara Venn")).toBe("mara venn");
  });

  it("applies full folds that lowercasing alone misses", () => {
    expect(normalizeDisplayName("Straße")).toBe(normalizeDisplayName("STRASSE"));
    expect(normalizeDisplayName("ΟΣ")).toBe(normalizeDisplayName("ος"));
  });
});
