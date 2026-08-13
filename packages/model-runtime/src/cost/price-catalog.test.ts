import { describe, expect, it } from "vitest";

import {
  ceilingFor,
  PURPOSE_TOKEN_CEILINGS,
  rateFor,
  UnknownPriceCatalogEntryError,
} from "./price-catalog.js";

describe("rateFor", () => {
  it("resolves a rate for each of the three known models", () => {
    for (const model of ["haiku", "sonnet", "titan"]) {
      const rate = rateFor(model);
      expect(rate.inputPerMillionTokens).toBeGreaterThanOrEqual(0);
      expect(rate.outputPerMillionTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("fails closed for an unrecognized model", () => {
    expect(() => rateFor("gpt-nope")).toThrow(UnknownPriceCatalogEntryError);
  });
});

describe("ceilingFor", () => {
  it("resolves a ceiling for every accepted purpose", () => {
    for (const purpose of Object.keys(PURPOSE_TOKEN_CEILINGS)) {
      const ceiling = ceilingFor(purpose);
      expect(ceiling.worstCaseInputTokens).toBeGreaterThan(0);
      expect(ceiling.worstCaseOutputTokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("fails closed for an unrecognized purpose", () => {
    expect(() => ceilingFor("made_up_purpose")).toThrow(UnknownPriceCatalogEntryError);
  });

  it("covers exactly the six accepted agent-run purposes", () => {
    expect(Object.keys(PURPOSE_TOKEN_CEILINGS).toSorted()).toStrictEqual([
      "ambient_choice",
      "claim_normalization",
      "dialogue_selection",
      "episode_embedding",
      "query_embedding",
      "structured_repair",
    ]);
  });
});
