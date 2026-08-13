import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";
import type { FallbackCoverageRequirement } from "@the-town-remembers/rules";
import { describe, expect, it } from "vitest";

import {
  assertFallbackCoverage,
  checkFallbackCoverage,
  FallbackCoverageError,
  FallbackNotFoundError,
  resolveFallbackLine,
} from "./fallback.js";

const NPC_KEYS = ["mara_venn", "corin_hale", "nessa_reed"] as const;
const DIALOGUE_ACTION_KINDS_BY_RESPONSE_KIND = [
  ["ask", "deflect"],
  ["tell", "acknowledge"],
  ["show", "acknowledge"],
  ["give", "refuse"],
  ["accept_promise", "refuse"],
] as const;

/** The requirement set GENERIC_ACTION_FALLBACKS was authored to satisfy (content/dialogue/fallbacks.test.ts covers this same shape from the content side). */
function genericActionRequirements(): FallbackCoverageRequirement[] {
  return NPC_KEYS.flatMap((npcKey) =>
    DIALOGUE_ACTION_KINDS_BY_RESPONSE_KIND.map(([actionKind, responseKind]) => ({
      npcKey,
      actionKind,
      responseKind,
      gateResult: "passed",
      requiredOutcomeIds: [],
    })),
  );
}

describe("resolveFallbackLine", () => {
  it("finds Mara's generic ask fallback", () => {
    const resolved = resolveFallbackLine(BELL_MYSTERY_V1, {
      npcKey: "mara_venn",
      actionKind: "ask",
      responseKind: "deflect",
      gateResult: "passed",
      requiredOutcomeIds: [],
    });
    expect(resolved.text).toBe(
      "There is too much frightened talk already. Ask me about one thing at a time, and I will tell you what I can.",
    );
  });

  it("only matches a line whose outcome set covers every required outcome", () => {
    const resolved = resolveFallbackLine(BELL_MYSTERY_V1, {
      npcKey: "nessa_reed",
      actionKind: "give",
      responseKind: "acknowledge",
      gateResult: "passed",
      requiredOutcomeIds: ["requested_item_received"],
    });
    expect(resolved.text).toBe("I have it now.");
  });

  it("throws FallbackNotFoundError for a combination with no authored line", () => {
    expect(() =>
      resolveFallbackLine(BELL_MYSTERY_V1, {
        npcKey: "mara_venn",
        actionKind: "ask",
        responseKind: "deflect",
        gateResult: "passed",
        requiredOutcomeIds: ["never_authored_outcome"],
      }),
    ).toThrow(FallbackNotFoundError);
  });

  it("resolves Corin's fallback confession for the final confrontation", () => {
    const resolved = resolveFallbackLine(BELL_MYSTERY_V1, {
      npcKey: "corin_hale",
      actionKind: "ask",
      responseKind: "answer",
      gateResult: "passed",
      requiredOutcomeIds: [],
    });
    expect(resolved.text).toContain("Lark damaged the bell by accident");
    expect(resolved.text).toContain("I was hiding the truth.");
  });
});

describe("fallback coverage against the real corpus", () => {
  it("is fully covered for the generic per-NPC-per-action requirement set", () => {
    const result = checkFallbackCoverage(BELL_MYSTERY_V1, genericActionRequirements());
    expect(result.missing).toStrictEqual([]);
  });

  it("assertFallbackCoverage does not throw for the real corpus", () => {
    expect(() =>
      assertFallbackCoverage(BELL_MYSTERY_V1, genericActionRequirements()),
    ).not.toThrow();
  });

  it("names exactly one missing requirement in a synthetic corpus with one gap", () => {
    const requirements = [
      ...genericActionRequirements(),
      {
        npcKey: "mara_venn",
        actionKind: "ask",
        responseKind: "answer",
        gateResult: "no_disclosure_available",
        requiredOutcomeIds: [],
      },
    ];
    const error = catchError(() =>
      assertFallbackCoverage(BELL_MYSTERY_V1, requirements),
    );
    expect(error).toBeInstanceOf(FallbackCoverageError);
    const missing = (error as FallbackCoverageError).missing;
    expect(missing).toHaveLength(1);
    expect(missing[0]).toStrictEqual({
      npcKey: "mara_venn",
      actionKind: "ask",
      responseKind: "answer",
      gateResult: "no_disclosure_available",
      requiredOutcomeIds: [],
    });
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected fn to throw");
}
