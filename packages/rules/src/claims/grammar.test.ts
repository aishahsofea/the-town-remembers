import { describe, expect, it } from "vitest";

import {
  assertClaimMatricesAgree,
  claimMatricesAgree,
  validateClaimTuple,
  type ClaimTupleCandidate,
} from "./grammar.js";

describe("claimMatricesAgree (D2-D)", () => {
  it("agrees across database/domains, content, and model-contracts", () => {
    expect(claimMatricesAgree()).toBe(true);
    expect(() => assertClaimMatricesAgree()).not.toThrow();
  });
});

const VALID_TUPLES: readonly ClaimTupleCandidate[] = [
  {
    subjectEntityType: "character",
    subjectEntityKey: "corin_hale",
    predicate: "was_at",
    objectEntityType: "location",
    objectEntityKey: "old_chapel",
    polarity: "positive",
    contextKey: "festival_night",
  },
  {
    subjectEntityType: "character",
    subjectEntityKey: "corin_hale",
    predicate: "moved",
    objectEntityType: "item",
    objectEntityKey: "festival_bell",
    polarity: "positive",
    contextKey: "festival_night",
  },
  {
    subjectEntityType: "character",
    subjectEntityKey: "lark_venn",
    predicate: "damaged",
    objectEntityType: "item",
    objectEntityKey: "festival_bell",
    polarity: "negative",
    contextKey: "festival_night",
  },
  {
    subjectEntityType: "item",
    subjectEntityKey: "festival_bell",
    predicate: "is_at",
    objectEntityType: "location",
    objectEntityKey: "old_chapel",
    polarity: "positive",
    contextKey: "current",
  },
  {
    subjectEntityType: "character",
    subjectEntityKey: "corin_hale",
    predicate: "acted_for",
    objectEntityType: "motive",
    objectEntityKey: "protect_lark",
    polarity: "positive",
    contextKey: "festival_night",
  },
];

describe("validateClaimTuple", () => {
  it.each(VALID_TUPLES.map((tuple) => [tuple.predicate, tuple] as const))(
    "accepts a well-formed %s tuple",
    (_predicate, tuple) => {
      expect(validateClaimTuple(tuple)).toStrictEqual({ valid: true });
    },
  );

  it("accepts an explicit alleged source actor", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, allegedSourceActorId: "npc-1" }),
    ).toStrictEqual({ valid: true });
  });

  it("accepts a null alleged source actor", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, allegedSourceActorId: null }),
    ).toStrictEqual({ valid: true });
  });

  it("rejects an unknown predicate", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, predicate: "teleported" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });

  it("rejects a subject entity type that violates the predicate's matrix row", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, subjectEntityType: "item" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });

  it("rejects an object entity type that violates the predicate's matrix row", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, objectEntityType: "item" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });

  it("rejects an empty subject entity key", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, subjectEntityKey: "" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });

  it("rejects an empty object entity key", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, objectEntityKey: "" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });

  it("rejects an invalid polarity", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, polarity: "sideways" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });

  it("rejects an empty context key", () => {
    expect(validateClaimTuple({ ...VALID_TUPLES[0]!, contextKey: "" })).toStrictEqual({
      valid: false,
      reasonCode: "INVALID_CLAIM_TUPLE",
    });
  });

  it("rejects an empty alleged source actor id", () => {
    expect(
      validateClaimTuple({ ...VALID_TUPLES[0]!, allegedSourceActorId: "" }),
    ).toStrictEqual({ valid: false, reasonCode: "INVALID_CLAIM_TUPLE" });
  });
});
