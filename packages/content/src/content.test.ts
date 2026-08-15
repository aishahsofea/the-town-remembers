import { domainSeparatedDigest } from "@the-town-remembers/serialization";
import { describe, expect, it } from "vitest";

import { claimKeyV1 } from "./claim-key.js";
import { BELL_MYSTERY_V1, UnknownContentVersionError, contentFor } from "./registry.js";
import { validateContent } from "./validate.js";
import { CONTENT_VERSION, RULES_VERSION } from "./versions.js";

const content = BELL_MYSTERY_V1;

describe("the authored registry", () => {
  it("passes every static validation", () => {
    expect(validateContent(content)).toStrictEqual([]);
  });

  it("maps one content version to one rules version", () => {
    expect(content.contentVersion).toBe(CONTENT_VERSION);
    expect(content.rulesVersion).toBe(RULES_VERSION);
  });

  it("is looked up by frozen version and offers no `latest`", () => {
    expect(contentFor(CONTENT_VERSION)).toBe(content);
    expect(() => contentFor("bell-mystery-v2")).toThrow(UnknownContentVersionError);
    expect(() => contentFor("latest")).toThrow(UnknownContentVersionError);
  });

  it("contains exactly the authored inventory", () => {
    expect(content.characters).toHaveLength(4);
    expect(content.locations).toHaveLength(4);
    expect(content.items).toHaveLength(4);
    expect(content.motives).toHaveLength(3);
    expect(content.storyEntities).toHaveLength(15);
    expect(content.npcs).toHaveLength(3);
    expect(content.contactEdges).toHaveLength(4);
    expect(content.claims).toHaveLength(12);
    // Three authored contradictions, each stored in both directions.
    expect(content.claimRelations).toHaveLength(6);
    expect(content.worldFacts).toHaveLength(8);
    expect(content.inspectables).toHaveLength(8);
    expect(content.clues).toHaveLength(7);
    expect(content.clues.flatMap((clue) => clue.effects)).toHaveLength(12);
    expect(content.seedEvents).toHaveLength(11);
    expect(content.seedEpisodes).toHaveLength(11);
    expect(content.seedTransmissions).toHaveLength(2);
    expect(content.seedEvidence).toHaveLength(19);
    expect(content.seedBeliefs).toHaveLength(19);
    expect(content.seedEpisodes.flatMap((episode) => episode.references)).toHaveLength(
      39,
    );
  });

  it("gives Lark a character entity and no NPC", () => {
    expect(
      content.characters.some((character) => character.entityKey === "lark_venn"),
    ).toBe(true);
    expect(content.npcs.some((npc) => npc.characterKey === "lark_venn")).toBe(false);
  });

  it("gives every story entity at least one normalized alias (D4-J)", () => {
    for (const entity of content.storyEntities) {
      expect(entity.aliases.length).toBeGreaterThan(0);
      for (const alias of entity.aliases) {
        expect(alias).toBe(
          alias.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
        );
        expect(alias.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the private solution exactly as Decision 009 states it", () => {
    expect(content.caseSolution).toStrictEqual({
      culpritKey: "corin_hale",
      motiveKey: "protect_lark",
      locationKey: "old_chapel",
      requiredItemKey: "festival_bell",
    });
  });

  it("locks the chapel without naming the ways in", () => {
    expect(content.lockedLocationMessage).toBe("The chapel door is locked.");
    expect(content.evidenceGateLockedMessage).not.toMatch(/chapel|bell|clue/i);
  });
});

describe("claim identity", () => {
  it("uses the frozen claim-key:v1 representation over authored keys", () => {
    expect(content.normalizedKeys.get("bell_at_chapel")).toBe(
      'claim-key:v1\n["item","festival_bell","is_at","location","old_chapel","positive","festival_night"]',
    );
  });

  it("distinguishes the same proposition in a different context", () => {
    expect(content.normalizedKeys.get("bell_at_chapel")).not.toBe(
      content.normalizedKeys.get("bell_at_chapel_current"),
    );
  });

  it("distinguishes polarity", () => {
    expect(content.normalizedKeys.get("lark_damaged_bell")).not.toBe(
      content.normalizedKeys.get("lark_did_not_damage_bell"),
    );
  });

  it("gives every claim a distinct key", () => {
    expect(new Set(content.normalizedKeys.values()).size).toBe(content.claims.length);
  });

  it("ignores display copy entirely, so two phrasings reach one row", () => {
    const tuple = {
      subjectEntityType: "character",
      subjectEntityKey: "corin_hale",
      predicate: "moved",
      objectEntityType: "item",
      objectEntityKey: "festival_bell",
      polarity: "positive",
      contextKey: "festival_night",
    } as const;
    expect(claimKeyV1(tuple)).toBe(content.normalizedKeys.get("corin_moved_bell"));
  });
});

describe("the seeded starting state", () => {
  const beliefFor = (npcKey: string, claimKey: string) =>
    content.seedBeliefs.find(
      (belief) => belief.npcKey === npcKey && belief.claimKey === claimKey,
    );

  it("leaves Mara convinced of the damage and only leaning on the motive", () => {
    expect(beliefFor("mara_venn", "lark_damaged_bell")).toMatchObject({
      score: 80,
      label: "convinced",
    });
    expect(beliefFor("mara_venn", "corin_protected_lark")).toMatchObject({
      score: 44,
      label: "leaning",
    });
  });

  it("gives Mara no belief about where the bell is", () => {
    expect(beliefFor("mara_venn", "bell_at_chapel")).toBeUndefined();
    expect(beliefFor("mara_venn", "bell_at_chapel_current")).toBeUndefined();
  });

  it("leaves Corin convinced of the whole truth", () => {
    for (const claimKey of [
      "lark_damaged_bell",
      "corin_moved_bell",
      "bell_at_chapel",
      "bell_at_chapel_current",
      "corin_protected_lark",
      "bell_not_at_square",
    ]) {
      expect(beliefFor("corin_hale", claimKey), claimKey).toMatchObject({
        score: 80,
        label: "convinced",
      });
    }
  });

  it("leaves Nessa leaning on the cover story and blind to the load", () => {
    expect(beliefFor("nessa_reed", "corin_was_at_chapel")).toMatchObject({
      score: 80,
      label: "convinced",
    });
    expect(beliefFor("nessa_reed", "corin_acted_for_safety")).toMatchObject({
      score: 40,
      label: "leaning",
    });
    expect(beliefFor("nessa_reed", "bell_at_chapel")).toBeUndefined();
    expect(beliefFor("nessa_reed", "lark_damaged_bell")).toBeUndefined();
  });

  it("makes all three convinced the bell left the square", () => {
    for (const npcKey of ["mara_venn", "corin_hale", "nessa_reed"]) {
      expect(beliefFor(npcKey, "bell_not_at_square"), npcKey).toMatchObject({
        score: 80,
        label: "convinced",
      });
    }
  });

  it("mirrors every contradicted claim, and never past the primary weight", () => {
    expect(beliefFor("mara_venn", "corin_acted_for_safety")).toMatchObject({
      score: -44,
      label: "doubtful",
    });
    expect(beliefFor("nessa_reed", "corin_protected_lark")).toMatchObject({
      score: -40,
      label: "doubtful",
    });
    expect(beliefFor("corin_hale", "bell_at_reeds_garden")).toMatchObject({
      score: -80,
    });
  });

  it("weights the two pre-story conversations at 44 and 40", () => {
    const testimony = content.seedEvidence.filter(
      (evidence) => evidence.evidenceKind === "npc_testimony",
    );
    expect(testimony.map((evidence) => evidence.signedWeight)).toStrictEqual([44, 40]);
    // Nessa's snapshot is 0: the conversation predates the game and creates no
    // live contact edge between her and Corin.
    expect(testimony.map((evidence) => evidence.trustSnapshot)).toStrictEqual([40, 0]);
    expect(
      content.contactEdges.some(
        (edge) => edge.fromNpcKey === "nessa_reed" && edge.toNpcKey === "corin_hale",
      ),
    ).toBe(false);
  });

  it("contributes exactly +80 for every direct observation", () => {
    const direct = content.seedEvidence.filter(
      (evidence) => evidence.evidenceKind === "direct_observation",
    );
    expect(direct).toHaveLength(11);
    expect(new Set(direct.map((evidence) => evidence.signedWeight))).toStrictEqual(
      new Set([80]),
    );
  });

  it("orders seed events by non-decreasing offset, all before creation", () => {
    const offsets = content.seedEvents.map((event) => event.offsetMinutes);
    expect(offsets).toStrictEqual([...offsets].toSorted((a, b) => a - b));
    expect(Math.max(...offsets)).toBeLessThan(0);
  });

  it("uses nine authored observations and two communications", () => {
    const byType = content.seedEvents.reduce<Record<string, number>>(
      (counts, event) => {
        counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(byType).toStrictEqual({ authored_observation: 9, claim_transmitted: 2 });
  });
});

describe("content drift", () => {
  it("has a fingerprint that changes when authored copy changes", () => {
    // Regenerate deliberately when content changes, and read the diff. The
    // point is that a copy edit shows up as one reviewable line rather than
    // silently altering a town.
    const fingerprint = domainSeparatedDigest("content-fingerprint:v1", {
      claims: content.claims,
      clues: content.clues,
      inspectables: content.inspectables,
      seedEvents: content.seedEvents,
      seedEpisodes: content.seedEpisodes,
      seedEvidence: content.seedEvidence,
      solution: content.caseSolution,
    });
    expect(fingerprint).toBe("R0M0d2G3S_xajcXbrxU7qCtBQ15xQVHtGpRV06g-rrs");
  });
});

describe("content validation catches the mistakes this data invites", () => {
  /** Applies one deliberate corruption to a shallow copy of the registry. */
  function corrupted(patch: Partial<typeof content>) {
    return { ...content, ...patch };
  }

  it("names a duplicate stable key", () => {
    const issues = validateContent(
      corrupted({ claims: [...content.claims, content.claims[0]!] }),
    );
    expect(issues.map((issue) => issue.code)).toContain("duplicate_key");
  });

  it("rejects two different entities claiming the same alias", () => {
    // entityTypes/entityKeys and this alias check both read storyEntities
    // directly, not items/characters/etc., so the corruption has to land there.
    const collidingItem = {
      ...content.items[0]!,
      aliases: content.characters[0]!.aliases,
    };
    const issues = validateContent(
      corrupted({
        storyEntities: content.storyEntities.map((entity) =>
          entity.entityKey === collidingItem.entityKey ? collidingItem : entity,
        ),
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("alias_collision");
  });

  it("rejects a claim that breaks the predicate matrix", () => {
    const broken = { ...content.claims[0]!, predicate: "damaged" as const };
    const issues = validateContent(corrupted({ claims: [broken] }));
    expect(issues.map((issue) => issue.code)).toContain("claim_matrix");
  });

  it("rejects a contradiction written in only one direction", () => {
    const issues = validateContent(
      corrupted({ claimRelations: [content.claimRelations[0]!] }),
    );
    expect(issues.map((issue) => issue.code)).toContain("relation_asymmetric");
  });

  it("rejects a world fact that names no seeded claim", () => {
    const issues = validateContent(
      corrupted({
        worldFacts: [{ factKey: "invented", claimKey: "nope", visibility: "public" }],
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("fact_claim");
  });

  it("rejects a solution field of the wrong entity type", () => {
    const issues = validateContent(
      corrupted({
        // The registry's literal type pins the authored key, so this
        // corruption has to go through `unknown`. The point of the test is
        // that validation catches it even where the type already would.
        caseSolution: {
          ...content.caseSolution,
          culpritKey: "old_chapel",
        } as unknown as typeof content.caseSolution,
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("solution_role");
  });

  it("rejects an item with two custodians", () => {
    const issues = validateContent(
      corrupted({
        items: [
          {
            ...content.items[0]!,
            initialLocationKey: "old_chapel",
            initialHolderKey: "nessa_reed",
          },
        ],
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("item_custody");
  });

  it("rejects a contact edge that points at itself", () => {
    const issues = validateContent(
      corrupted({
        contactEdges: [
          { fromNpcKey: "mara_venn", toNpcKey: "mara_venn", trustScore: 0 },
        ],
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("contact_edge_self");
  });

  it("rejects seed events that run backwards or into the present", () => {
    const issues = validateContent(
      corrupted({
        seedEvents: [
          { ...content.seedEvents[0]!, offsetMinutes: -10 },
          { ...content.seedEvents[1]!, offsetMinutes: -600 },
          { ...content.seedEvents[2]!, offsetMinutes: 5 },
        ],
      }),
    );
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("seed_offset_order");
    expect(codes).toContain("seed_offset_future");
  });

  it("rejects a clue effect whose sign disagrees with its kind", () => {
    const clue = content.clues[0]!;
    const issues = validateContent(
      corrupted({
        inspectables: [
          {
            ...content.inspectables[0]!,
            clue: {
              ...clue,
              effects: [
                {
                  claimKey: "lark_damaged_bell",
                  effectKind: "supports",
                  signedWeight: -70,
                },
              ],
            },
          },
        ],
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("clue_effect_sign");
  });

  it("rejects a seed that hands an NPC knowledge they must not begin with", () => {
    const issues = validateContent(
      corrupted({
        seedBeliefs: [
          ...content.seedBeliefs,
          {
            npcKey: "nessa_reed",
            claimKey: "bell_at_chapel",
            score: 80,
            label: "convinced",
            seedEventKey: "nessa_saw_corins_cart",
          },
        ],
      }),
    );
    expect(
      issues.some((issue) => issue.detail.includes("Nessa begins believing")),
    ).toBe(true);
  });

  it("rejects a mirror with no contradiction relation behind it", () => {
    const issues = validateContent(
      corrupted({
        seedEvidence: [
          {
            npcKey: "mara_venn",
            claimKey: "corin_was_at_inn",
            seedEventKey: "mara_met_corin_at_inn",
            evidenceKind: "contradiction",
            signedWeight: -80,
            mirrorsEvidenceOf: {
              npcKey: "mara_venn",
              claimKey: "lark_damaged_bell",
            },
          },
        ],
      }),
    );
    expect(issues.map((issue) => issue.code)).toContain("mirror_without_relation");
  });
});
