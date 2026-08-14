import { randomUUID } from "node:crypto";

import {
  BELL_MYSTERY_V1,
  CLAIMS,
  claimNormalizedKeys,
} from "@the-town-remembers/content";
import { DisclosureBundleLimitError } from "@the-town-remembers/rules";
import { describe, expect, it } from "vitest";

import {
  buildDisclosureBundleForNpc,
  buildDisclosureCandidates,
  buildNpcDialogueContext,
  buildRenderingCandidatesForNpc,
  defaultGateResult,
  disclosureRowsForNpc,
  type ClaimBeliefState,
  type DisclosureGateContext,
  type ResolvedDisclosureSource,
} from "./context.js";

/** A fake claim-ID space, stable per test file: `claimKey -> UUID`, deterministic so assertions can name a claim by key. */
const CLAIM_IDS = new Map(CLAIMS.map((claim) => [claim.claimKey, randomUUID()]));

function claimIdFor(claimKey: string): string {
  const id = CLAIM_IDS.get(claimKey);
  if (id === undefined) throw new Error(`No fixture claim ID for "${claimKey}"`);
  return id;
}

/** Resolves every authored disclosure row for one NPC to a fixture claim ID and a grounding matching its content-authored nature (every `BELL_MYSTERY_V1` row is either directly observed or heard once). */
function resolveSources(
  npcKey: string,
  heardClaimKeys: ReadonlySet<string> = new Set(),
): readonly ResolvedDisclosureSource[] {
  return disclosureRowsForNpc(npcKey).map((row) => ({
    claimKey: row.claimKey,
    claimId: claimIdFor(row.claimKey),
    tier: row.tier,
    grounding: heardClaimKeys.has(row.claimKey)
      ? {
          kind: "heard_claim",
          episodeId: randomUUID(),
          parentTransmissionId: randomUUID(),
        }
      : { kind: "direct_observation", episodeId: randomUUID() },
    permittedEntityIds: [],
  }));
}

const NO_BELIEFS: ReadonlyMap<string, ClaimBeliefState> = new Map();

function gateContext(
  overrides: Partial<DisclosureGateContext> = {},
): DisclosureGateContext {
  return {
    isRelevantToRequest: () => true,
    trust: 100,
    suspicion: 0,
    verifiedCluePresentedThisAction: false,
    everBrokenPromiseToThisNpc: false,
    confrontationGateOpen: false,
    beliefByClaimId: NO_BELIEFS,
    ...overrides,
  };
}

describe("buildDisclosureBundleForNpc", () => {
  it("never lets Mara's bundle contain the chapel location, at any trust or confrontation state", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: resolveSources("mara_venn", new Set(["corin_protected_lark"])),
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({ trust: 100, confrontationGateOpen: true }),
    });

    const approvedClaimKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => bundle.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    expect(approvedClaimKeys.has("bell_at_chapel")).toBe(false);
    expect(approvedClaimKeys.has("bell_at_chapel_current")).toBe(false);
    expect(approvedClaimKeys.has("corin_moved_bell")).toBe(false);
  });

  it("never lets Nessa's bundle assert the cart's load, at any trust or confrontation state", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: resolveSources("nessa_reed", new Set(["corin_acted_for_safety"])),
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({ trust: 100, confrontationGateOpen: true }),
    });

    const approvedClaimKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => bundle.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    // Nessa's authored knowledge is that the cart was covered — she never
    // has a row asserting what it carried.
    expect(approvedClaimKeys.has("lark_damaged_bell")).toBe(false);
    expect(approvedClaimKeys.has("bell_at_chapel")).toBe(false);
  });

  it("keeps Corin's final_truth claims out of the bundle while the confrontation gate is closed, however trusted the player is", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: resolveSources("corin_hale"),
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({
        trust: 100,
        suspicion: 0,
        confrontationGateOpen: false,
      }),
    });

    const approvedClaimKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => bundle.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    for (const claimKey of [
      "lark_damaged_bell",
      "corin_moved_bell",
      "bell_at_chapel",
      "corin_protected_lark",
    ]) {
      expect(approvedClaimKeys.has(claimKey)).toBe(false);
    }
    // The public and cover-story rows still pass — closing the confrontation
    // gate only blocks `final_truth`, not every other tier.
    expect(approvedClaimKeys.has("bell_not_at_square")).toBe(true);
    expect(approvedClaimKeys.has("corin_acted_for_safety")).toBe(true);
  });

  it("admits Corin's final_truth claims once the confrontation gate opens", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: resolveSources("corin_hale"),
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({
        trust: 100,
        suspicion: 0,
        confrontationGateOpen: true,
      }),
    });

    const approvedClaimKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => bundle.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    for (const claimKey of [
      "lark_damaged_bell",
      "corin_moved_bell",
      "bell_at_chapel",
      "corin_protected_lark",
    ]) {
      expect(approvedClaimKeys.has(claimKey)).toBe(true);
    }
  });

  it("gates Mara's confidential row on trust/suspicion and denies it below threshold", () => {
    const sources = resolveSources("mara_venn", new Set(["corin_protected_lark"]));
    const lowTrust = buildDisclosureBundleForNpc({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({ trust: 10, suspicion: 0 }),
    });
    const lowTrustKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => lowTrust.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    expect(lowTrustKeys.has("lark_damaged_bell")).toBe(false);

    const highTrust = buildDisclosureBundleForNpc({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({ trust: 50, suspicion: 0 }),
    });
    const highTrustKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => highTrust.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    expect(highTrustKeys.has("lark_damaged_bell")).toBe(true);
  });

  it("denies Mara's confidential row once she has ever been broken a promise, regardless of trust", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: resolveSources("mara_venn", new Set(["corin_protected_lark"])),
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({
        trust: 100,
        suspicion: 0,
        everBrokenPromiseToThisNpc: true,
      }),
    });
    const approvedClaimKeys = new Set(
      [...CLAIM_IDS.entries()]
        .filter(([, id]) => bundle.approvedDisclosures.some((d) => d.claimId === id))
        .map(([key]) => key),
    );
    expect(approvedClaimKeys.has("lark_damaged_bell")).toBe(false);
  });

  it("marks a heard_claim row as hearsay with its parent transmission, and a direct_observation row as believed with no transmission", () => {
    const sources = resolveSources("mara_venn", new Set(["corin_protected_lark"]));
    const bundle = buildDisclosureBundleForNpc({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({ trust: 100 }),
    });

    const hearsay = bundle.approvedDisclosures.find(
      (d) => d.claimId === claimIdFor("corin_protected_lark"),
    );
    expect(hearsay?.stance).toBe("hearsay");
    expect(hearsay?.parentTransmissionId).not.toBeNull();
    expect(hearsay?.sourceEpisodeId).not.toBeNull();

    const believed = bundle.approvedDisclosures.find(
      (d) => d.claimId === claimIdFor("bell_not_at_square"),
    );
    expect(believed?.stance).toBe("believed");
    expect(believed?.parentTransmissionId).toBeNull();
  });

  it("propagates the authored count limits (`DisclosureBundleLimitError`) rather than silently truncating", () => {
    expect(() =>
      buildDisclosureBundleForNpc({
        sources: resolveSources("corin_hale"),
        content: BELL_MYSTERY_V1,
        gateContext: gateContext(),
        requiredDisclosureIds: [
          claimIdFor("bell_not_at_square"),
          claimIdFor("corin_acted_for_safety"),
          claimIdFor("lark_damaged_bell"),
          claimIdFor("corin_moved_bell"),
          claimIdFor("bell_at_chapel"),
        ],
      }),
    ).toThrow(DisclosureBundleLimitError);
  });

  it("resolves every authored (npcKey, claimKey) row through the normalized-key catalog without drifting from it", () => {
    const normalizedKeys = claimNormalizedKeys();
    for (const npcKey of ["mara_venn", "nessa_reed", "corin_hale"]) {
      for (const row of disclosureRowsForNpc(npcKey)) {
        expect(normalizedKeys.has(row.claimKey)).toBe(true);
      }
    }
  });
});

describe("defaultGateResult", () => {
  it("is no_disclosure_available for an empty bundle", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: [],
      content: BELL_MYSTERY_V1,
      gateContext: gateContext(),
    });
    expect(defaultGateResult(bundle)).toBe("no_disclosure_available");
  });

  it("is passed once at least one disclosure is approved", () => {
    const bundle = buildDisclosureBundleForNpc({
      sources: resolveSources("mara_venn"),
      content: BELL_MYSTERY_V1,
      gateContext: gateContext(),
    });
    expect(defaultGateResult(bundle)).toBe("passed");
  });
});

/** `buildRenderingCandidatesForNpc` maps `claimKey -> claimId`; these tests use the claim key as its own fixture id, so assertions can still name a claim by its authored key. */
function identityClaimIds(claimKeys: readonly string[]): ReadonlyMap<string, string> {
  return new Map(claimKeys.map((claimKey) => [claimKey, claimKey]));
}

describe("buildRenderingCandidatesForNpc", () => {
  it("offers only disclosure templates for claims the bundle actually approved", () => {
    const candidates = buildRenderingCandidatesForNpc(
      "mara_venn",
      identityClaimIds(["bell_not_at_square"]),
      new Set(),
      "passed",
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.disclosureClaimKeys).toEqual(["bell_not_at_square"]);
      expect(candidate.outcomeKeys).toEqual([]);
      expect(candidate.episodeKeys).toEqual([]);
      expect(candidate.entityIds).toEqual([]);
      expect(candidate.actorIds).toEqual([]);
    }
  });

  it("offers Corin's confession only when every one of its four claims is approved", () => {
    const partial = buildRenderingCandidatesForNpc(
      "corin_hale",
      identityClaimIds(["lark_damaged_bell", "corin_moved_bell", "bell_at_chapel"]),
      new Set(),
      "passed",
    );
    expect(
      partial.some((candidate) => candidate.templateKey.includes("confession")),
    ).toBe(false);

    const complete = buildRenderingCandidatesForNpc(
      "corin_hale",
      identityClaimIds([
        "lark_damaged_bell",
        "corin_moved_bell",
        "bell_at_chapel",
        "corin_protected_lark",
      ]),
      new Set(),
      "passed",
    );
    const confession = complete.find((candidate) =>
      candidate.templateKey.includes("confession"),
    );
    expect(confession?.disclosureClaimKeys).toEqual([
      "lark_damaged_bell",
      "corin_moved_bell",
      "bell_at_chapel",
      "corin_protected_lark",
    ]);
  });

  it("offers an outcome template only for an approved outcome kind", () => {
    const none = buildRenderingCandidatesForNpc(
      "nessa_reed",
      new Map(),
      new Set(),
      "passed",
    );
    expect(
      none.some((candidate) => candidate.templateKey.includes("chapel_key_lent")),
    ).toBe(false);

    const withOutcome = buildRenderingCandidatesForNpc(
      "nessa_reed",
      new Map(),
      new Set(["chapel_key_lent"]),
      "passed",
    );
    const outcome = withOutcome.find((candidate) =>
      candidate.templateKey.includes("chapel_key_lent"),
    );
    expect(outcome?.outcomeKeys).toEqual(["chapel_key_lent"]);
  });

  it("offers a denial template only for the matching gate result", () => {
    const wrongGate = buildRenderingCandidatesForNpc(
      "nessa_reed",
      new Map(),
      new Set(),
      "passed",
    );
    expect(
      wrongGate.some((candidate) => candidate.templateKey.includes("denied_key")),
    ).toBe(false);

    const deniedAccess = buildRenderingCandidatesForNpc(
      "nessa_reed",
      new Map(),
      new Set(),
      "denied_access",
    );
    expect(
      deniedAccess.some((candidate) => candidate.templateKey.includes("denied_key")),
    ).toBe(true);
  });

  it("never offers a template belonging to a different NPC", () => {
    const candidates = buildRenderingCandidatesForNpc(
      "mara_venn",
      identityClaimIds(["bell_not_at_square", "corin_was_at_inn"]),
      new Set(),
      "denied_access",
    );
    expect(
      candidates.every((candidate) => !candidate.templateKey.startsWith("nessa_")),
    ).toBe(true);
    expect(
      candidates.every((candidate) => !candidate.templateKey.startsWith("corin_")),
    ).toBe(true);
  });
});

describe("buildNpcDialogueContext", () => {
  it("assembles a full trusted context for Mara answering a public question", () => {
    const npcId = randomUUID();
    const assembled = buildNpcDialogueContext({
      npcKey: "mara_venn",
      npcId,
      currentLocationId: randomUUID(),
      disclosureSources: resolveSources("mara_venn", new Set(["corin_protected_lark"])),
      content: BELL_MYSTERY_V1,
      disclosureGateContext: gateContext(),
      playerAction: { actionKind: "ask", targetEntityIds: [] },
      dialogueDirective: { requiredAct: "Answer the player's question." },
      allowedResponseKinds: ["answer", "refuse", "deflect"],
      canonicalEntities: [],
      approvedActors: [],
    });

    expect(assembled.trustedContext.npc_profile.npc_id).toBe(npcId);
    expect(assembled.trustedContext.dialogue_directive.gate_result).toBe("passed");
    expect(assembled.trustedContext.approved_renderings.length).toBeGreaterThan(0);
    expect(
      assembled.trustedContext.approved_renderings.every(
        (rendering) => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(rendering.text),
      ),
    ).toBe(true);
  });

  it("derives no_disclosure_available when nothing in the bundle qualifies", () => {
    // Mara has no cover_story/final_truth row (unlike Corin, whose
    // cover_story claim passes regardless of relevance), so denying
    // relevance and trust together leaves every one of her rows failing.
    const assembled = buildNpcDialogueContext({
      npcKey: "mara_venn",
      npcId: randomUUID(),
      currentLocationId: randomUUID(),
      disclosureSources: resolveSources("mara_venn", new Set(["corin_protected_lark"])),
      content: BELL_MYSTERY_V1,
      disclosureGateContext: gateContext({
        isRelevantToRequest: () => false,
        trust: 0,
        suspicion: 0,
      }),
      playerAction: { actionKind: "ask", targetEntityIds: [] },
      dialogueDirective: { requiredAct: "Answer the player's question." },
      allowedResponseKinds: ["deflect"],
      canonicalEntities: [],
      approvedActors: [],
    });

    expect(assembled.trustedContext.dialogue_directive.gate_result).toBe(
      "no_disclosure_available",
    );
    expect(assembled.trustedContext.approved_renderings).toHaveLength(0);
  });

  it("honors a caller-supplied gate result over the derived default", () => {
    const assembled = buildNpcDialogueContext({
      npcKey: "nessa_reed",
      npcId: randomUUID(),
      currentLocationId: randomUUID(),
      disclosureSources: resolveSources("nessa_reed"),
      content: BELL_MYSTERY_V1,
      disclosureGateContext: gateContext(),
      playerAction: { actionKind: "show", targetEntityIds: [] },
      dialogueDirective: {
        requiredAct: "Refuse to lend the chapel key.",
        gateResult: "denied_access",
      },
      allowedResponseKinds: ["refuse"],
      canonicalEntities: [],
      approvedActors: [],
    });

    expect(assembled.trustedContext.dialogue_directive.gate_result).toBe(
      "denied_access",
    );
    expect(
      assembled.trustedContext.approved_renderings.some(
        (rendering) => rendering.response_kind === "refuse",
      ),
    ).toBe(true);
  });

  it("uses a caller-supplied disclosureBundle instead of rebuilding one from disclosureGateContext", () => {
    const sources = resolveSources("mara_venn", new Set(["corin_protected_lark"]));
    // Built as a real planner (`rules/actions/model-backed.ts#planAsk`)
    // would: a real bundle, from a permissive gate context.
    const plannerBundle = buildDisclosureBundleForNpc({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: gateContext({ trust: 100, suspicion: 0 }),
    });
    expect(plannerBundle.approvedDisclosures.length).toBeGreaterThan(0);

    // A hostile gate context that would produce an *empty* bundle if
    // buildNpcDialogueContext rebuilt one internally instead of using the
    // supplied bundle.
    const assembled = buildNpcDialogueContext({
      npcKey: "mara_venn",
      npcId: randomUUID(),
      currentLocationId: randomUUID(),
      disclosureSources: sources,
      content: BELL_MYSTERY_V1,
      disclosureGateContext: gateContext({
        trust: 0,
        suspicion: 0,
        isRelevantToRequest: () => false,
      }),
      disclosureBundle: plannerBundle,
      playerAction: { actionKind: "ask", targetEntityIds: [] },
      dialogueDirective: { requiredAct: "Answer the player's question." },
      allowedResponseKinds: ["answer"],
      canonicalEntities: [],
      approvedActors: [],
    });

    expect(assembled.trustedContext.dialogue_directive.gate_result).toBe("passed");
    expect(assembled.trustedContext.approved_renderings.length).toBeGreaterThan(0);
  });
});

describe("buildDisclosureCandidates", () => {
  it("produces the exact candidate set buildDisclosureBundleForNpc feeds to buildApprovedDisclosureBundle", () => {
    const sources = resolveSources("corin_hale");
    const context = gateContext({
      trust: 100,
      suspicion: 0,
      confrontationGateOpen: true,
    });

    const candidates = buildDisclosureCandidates({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: context,
    });
    const bundle = buildDisclosureBundleForNpc({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: context,
    });

    // Every candidate that passes its own tier gate ends up approved —
    // proving buildDisclosureCandidates is the real upstream of the bundle,
    // not a parallel, possibly-divergent computation.
    const approvedClaimIds = new Set(
      bundle.approvedDisclosures.map((disclosure) => disclosure.claimId),
    );
    expect(candidates.length).toBeGreaterThanOrEqual(approvedClaimIds.size);
    for (const claimId of approvedClaimIds) {
      expect(candidates.some((candidate) => candidate.claimId === claimId)).toBe(true);
    }
  });

  it("deduplicates a claim with two simultaneously-passing tiers exactly once, matching the bundle", () => {
    const sources = resolveSources("mara_venn", new Set(["corin_protected_lark"]));
    const context = gateContext({ trust: 100, suspicion: 0 });

    const candidates = buildDisclosureCandidates({
      sources,
      content: BELL_MYSTERY_V1,
      gateContext: context,
    });

    const protectedLarkId = candidates.find(
      (candidate) =>
        [...CLAIM_IDS.entries()].find(([, id]) => id === candidate.claimId)?.[0] ===
        "corin_protected_lark",
    )?.claimId;
    expect(
      candidates.filter((candidate) => candidate.claimId === protectedLarkId),
    ).toHaveLength(1);
  });
});
