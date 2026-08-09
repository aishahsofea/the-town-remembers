import { describe, expect, it } from "vitest";

import { CLAIMS, claimNormalizedKeys } from "@the-town-remembers/content";

import {
  assertStoredClaimKeyIsValid,
  canonicalizeClaim,
  CorruptClaimKeyError,
} from "./canonical.js";

const SEEDED_KEYS = claimNormalizedKeys();

describe("canonicalizeClaim", () => {
  it.each(CLAIMS.map((claim) => [claim.claimKey, claim] as const))(
    "reproduces the seeded key for %s",
    (claimKey, claim) => {
      const recomputed = canonicalizeClaim({
        subjectEntityType: claim.subjectType,
        subjectEntityKey: claim.subjectKey,
        predicate: claim.predicate,
        objectEntityType: claim.objectType,
        objectEntityKey: claim.objectKey,
        polarity: claim.polarity,
        contextKey: claim.contextKey,
      });
      expect(recomputed).toBe(SEEDED_KEYS.get(claimKey));
    },
  );
});

describe("assertStoredClaimKeyIsValid", () => {
  const tuple = {
    subjectEntityType: "character",
    subjectEntityKey: "corin_hale",
    predicate: "was_at",
    objectEntityType: "location",
    objectEntityKey: "old_chapel",
    polarity: "positive",
    contextKey: "festival_night",
  };

  it("does not throw when the stored key matches the recomputed key", () => {
    const key = canonicalizeClaim(tuple);
    expect(() => assertStoredClaimKeyIsValid(tuple, key)).not.toThrow();
  });

  it("fails closed when the stored key does not match", () => {
    expect(() => assertStoredClaimKeyIsValid(tuple, "corrupted-key")).toThrow(
      CorruptClaimKeyError,
    );
    try {
      assertStoredClaimKeyIsValid(tuple, "corrupted-key");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CorruptClaimKeyError);
      expect((error as CorruptClaimKeyError).reasonCode).toBe("CORRUPT_CLAIM_KEY");
    }
  });
});
