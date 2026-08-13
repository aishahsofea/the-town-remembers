import { describe, expect, it } from "vitest";

import {
  CONFESSION_TEMPLATES,
  DENIAL_TEMPLATES,
  DISCLOSURE_TEMPLATES,
  DISCLOSURE_TIER_TABLE,
  OUTCOME_TEMPLATES,
} from "./templates.js";

const CLOSED_PLACEHOLDERS = new Set(["claim", "entity", "actor", "item", "clue"]);

function placeholdersIn(text: string): readonly string[] {
  return [...text.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

describe("disclosure tier table", () => {
  it("has exactly the fourteen rows Decision 009 states", () => {
    expect(DISCLOSURE_TIER_TABLE).toHaveLength(14);
  });

  it("gives Corin, and only Corin, any final_truth row", () => {
    const finalTruthNpcs = new Set(
      DISCLOSURE_TIER_TABLE.filter((row) => row.tier === "final_truth").map(
        (row) => row.npcKey,
      ),
    );
    expect(finalTruthNpcs).toStrictEqual(new Set(["corin_hale"]));
  });

  it("never gives Mara a row about the Old Chapel claims", () => {
    const maraClaims = new Set(
      DISCLOSURE_TIER_TABLE.filter((row) => row.npcKey === "mara_venn").map(
        (row) => row.claimKey,
      ),
    );
    expect(maraClaims.has("bell_at_chapel")).toBe(false);
    expect(maraClaims.has("corin_moved_bell")).toBe(false);
  });

  it("never gives Nessa a row asserting the bell's chapel location or Lark's role", () => {
    const nessaClaims = new Set(
      DISCLOSURE_TIER_TABLE.filter((row) => row.npcKey === "nessa_reed").map(
        (row) => row.claimKey,
      ),
    );
    expect(nessaClaims.has("bell_at_chapel")).toBe(false);
    expect(nessaClaims.has("lark_damaged_bell")).toBe(false);
  });
});

describe("disclosure templates", () => {
  it("uses only the closed placeholder set", () => {
    for (const template of DISCLOSURE_TEMPLATES) {
      for (const placeholder of placeholdersIn(template.text)) {
        expect(CLOSED_PLACEHOLDERS.has(placeholder), template.templateKey).toBe(true);
      }
    }
  });

  it("gives every disclosure tier row at least two voiced alternatives", () => {
    // Corin's four final_truth rows are covered by CONFESSION_TEMPLATES (one
    // combined confession per variant), not by four separate DISCLOSURE_TEMPLATES.
    for (const row of DISCLOSURE_TIER_TABLE) {
      const count =
        row.tier === "final_truth"
          ? CONFESSION_TEMPLATES.filter((confession) =>
              (confession.claimKeys as readonly string[]).includes(row.claimKey),
            ).length
          : DISCLOSURE_TEMPLATES.filter(
              (template) =>
                template.npcKey === row.npcKey && template.claimKey === row.claimKey,
            ).length;
      expect(count, `${row.npcKey}/${row.claimKey}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("never mentions the chapel in any of Mara's templates", () => {
    for (const template of DISCLOSURE_TEMPLATES) {
      if (template.npcKey !== "mara_venn") continue;
      expect(template.text.toLowerCase(), template.templateKey).not.toContain("chapel");
    }
  });

  it("never has Nessa's cart-observation templates name what was under the cover", () => {
    // Her public bell_not_at_square templates may say "bell" — that it's
    // missing is public knowledge. Only her corin_was_at_chapel templates are
    // actually about the covered cart, and those must never say "bell".
    for (const template of DISCLOSURE_TEMPLATES) {
      if (template.npcKey !== "nessa_reed") continue;
      if (template.claimKey !== "corin_was_at_chapel") continue;
      expect(template.text.toLowerCase(), template.templateKey).not.toContain("bell");
    }
  });

  it("keeps every template key unique", () => {
    const keys = DISCLOSURE_TEMPLATES.map((template) => template.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Corin's confession templates", () => {
  it("has at least two voiced variants, each covering all four final-truth claims", () => {
    expect(CONFESSION_TEMPLATES.length).toBeGreaterThanOrEqual(2);
    for (const confession of CONFESSION_TEMPLATES) {
      expect(confession.claimKeys).toStrictEqual([
        "lark_damaged_bell",
        "corin_moved_bell",
        "bell_at_chapel",
        "corin_protected_lark",
      ]);
      expect(placeholdersIn(confession.text)).toStrictEqual([]);
    }
  });

  it("never changes the solution's culprit, motive, or location", () => {
    for (const confession of CONFESSION_TEMPLATES) {
      const lower = confession.text.toLowerCase();
      expect(lower).toContain("lark");
      expect(lower).toMatch(/chapel/);
    }
  });
});

describe("outcome and denial templates", () => {
  it("uses only the closed placeholder set", () => {
    for (const template of [...OUTCOME_TEMPLATES, ...DENIAL_TEMPLATES]) {
      for (const placeholder of placeholdersIn(template.text)) {
        expect(CLOSED_PLACEHOLDERS.has(placeholder), template.templateKey).toBe(true);
      }
    }
  });

  it("only authors a requested-item outcome for the two NPCs with a requested item", () => {
    const npcsWithRequestedItemTemplates = new Set(
      OUTCOME_TEMPLATES.filter(
        (template) => template.outcomeKind === "requested_item_received",
      ).map((template) => template.npcKey),
    );
    expect(npcsWithRequestedItemTemplates).toStrictEqual(
      new Set(["corin_hale", "nessa_reed"]),
    );
  });
});
