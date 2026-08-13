import { describe, expect, it } from "vitest";

import { normalizeDisplayNameForUniqueness } from "./display-name.js";

describe("normalizeDisplayNameForUniqueness", () => {
  it.each([
    ["MARA  VENN", "mara venn"],
    ["Ｍara Venn", "mara venn"],
    ["Straße", "strasse"],
    ["STRASSE", "strasse"],
    ["ΟΣ", "οσ"],
    ["ος", "οσ"],
    ["ᎠᎹᏂ", "ᎠᎹᏂ"],
    ["ꭰ", "Ꭰ"],
    ["ᏸ", "Ᏸ"],
    ["ǰ", "ǰ"],
    ["ΐ", "ΐ"],
  ])("folds %s to %s", (input, expected) => {
    expect(normalizeDisplayNameForUniqueness(input)).toBe(expected);
  });

  it("keeps dotless i distinct under default Unicode case folding", () => {
    expect(normalizeDisplayNameForUniqueness("ı")).not.toBe(
      normalizeDisplayNameForUniqueness("i"),
    );
  });
});
