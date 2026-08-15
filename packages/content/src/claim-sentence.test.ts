import { describe, expect, it } from "vitest";

import {
  renderClaimSentence,
  UnknownClaimContextError,
  UnknownClaimEntityError,
} from "./claim-sentence.js";
import { BELL_MYSTERY_V1 } from "./registry.js";

const content = BELL_MYSTERY_V1;

describe("renderClaimSentence", () => {
  it("renders each predicate, positive and negative, with the context suffix", () => {
    expect(
      renderClaimSentence(content, {
        subjectEntityKey: "corin_hale",
        predicate: "was_at",
        objectEntityKey: "lantern_inn",
        polarity: "positive",
        contextKey: "festival_night",
      }),
    ).toBe("Corin Hale was at The Lantern Inn (on festival night).");

    expect(
      renderClaimSentence(content, {
        subjectEntityKey: "corin_hale",
        predicate: "was_at",
        objectEntityKey: "lantern_inn",
        polarity: "negative",
        contextKey: "festival_night",
      }),
    ).toBe("Corin Hale was not at The Lantern Inn (on festival night).");

    expect(
      renderClaimSentence(content, {
        subjectEntityKey: "lark_venn",
        predicate: "moved",
        objectEntityKey: "festival_bell",
        polarity: "positive",
        contextKey: "festival_night",
      }),
    ).toBe("Lark Venn moved Festival Bell (on festival night).");

    expect(
      renderClaimSentence(content, {
        subjectEntityKey: "lark_venn",
        predicate: "damaged",
        objectEntityKey: "festival_bell",
        polarity: "negative",
        contextKey: "festival_night",
      }),
    ).toBe("Lark Venn did not damage Festival Bell (on festival night).");

    expect(
      renderClaimSentence(content, {
        subjectEntityKey: "festival_bell",
        predicate: "is_at",
        objectEntityKey: "festival_square",
        polarity: "negative",
        contextKey: "festival_morning",
      }),
    ).toBe("Festival Bell is not at Festival Square (on festival morning).");

    expect(
      renderClaimSentence(content, {
        subjectEntityKey: "corin_hale",
        predicate: "acted_for",
        objectEntityKey: "protect_lark",
        polarity: "positive",
        contextKey: "current",
      }),
    ).toBe("Corin Hale acted out of Protecting Lark (currently).");
  });

  it("fails closed on an entity key outside the frozen registry", () => {
    expect(() =>
      renderClaimSentence(content, {
        subjectEntityKey: "not_a_real_entity",
        predicate: "was_at",
        objectEntityKey: "lantern_inn",
        polarity: "positive",
        contextKey: "festival_night",
      }),
    ).toThrow(UnknownClaimEntityError);
  });

  it("fails closed on a context key outside the frozen registry", () => {
    expect(() =>
      renderClaimSentence(content, {
        subjectEntityKey: "corin_hale",
        predicate: "was_at",
        objectEntityKey: "lantern_inn",
        polarity: "positive",
        contextKey: "not_a_real_context",
      }),
    ).toThrow(UnknownClaimContextError);
  });
});
