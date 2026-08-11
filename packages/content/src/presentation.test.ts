import { describe, expect, it } from "vitest";

import { ITEMS, LOCATIONS, NPCS } from "./entities.js";
import {
  ITEM_DESCRIPTIONS,
  LOCATION_SCENE_KEYS,
  MYSTERY_TITLE,
  NPC_PORTRAIT_KEYS,
  NPC_ROLE_LABELS,
  OPENING_NARRATION,
  SPOILER_SAFE_DESCRIPTION,
  TAGLINE,
} from "./presentation.js";

const ASSET_KEY_PATTERN = /^bell-mystery-v1\/[a-z0-9-]+\/[a-z0-9-]+$/;

describe("presentation strings", () => {
  it("matches Decision 009's authored copy exactly", () => {
    expect(MYSTERY_TITLE).toBe("The Missing Festival Bell");
    expect(TAGLINE).toBe(
      "The bell is gone. The town remembers a different story in every mouth.",
    );
    expect(SPOILER_SAFE_DESCRIPTION).toBe(
      "Visit a shared town, question its residents, trace its rumours, and " +
        "discover what happened before the festival begins.",
    );
  });

  it("does not expose Lark, the Old Chapel, or Corin's involvement in the opening", () => {
    const lowered = OPENING_NARRATION.toLowerCase();
    for (const spoiler of ["lark", "chapel", "corin"]) {
      expect(lowered).not.toContain(spoiler);
    }
  });
});

describe("LOCATION_SCENE_KEYS", () => {
  it("keys exactly the four authored locations", () => {
    expect(Object.keys(LOCATION_SCENE_KEYS).toSorted()).toStrictEqual(
      LOCATIONS.map((location) => location.entityKey).toSorted(),
    );
  });

  it("every value matches the accepted asset-key shape", () => {
    for (const key of Object.values(LOCATION_SCENE_KEYS)) {
      expect(key).toMatch(ASSET_KEY_PATTERN);
    }
  });
});

describe("NPC_PORTRAIT_KEYS", () => {
  it("keys exactly the three conversational NPCs", () => {
    expect(Object.keys(NPC_PORTRAIT_KEYS).toSorted()).toStrictEqual(
      NPCS.map((npc) => npc.npcKey).toSorted(),
    );
  });

  it("every value matches the accepted asset-key shape", () => {
    for (const key of Object.values(NPC_PORTRAIT_KEYS)) {
      expect(key).toMatch(ASSET_KEY_PATTERN);
    }
  });
});

describe("NPC_ROLE_LABELS", () => {
  it("keys exactly the three conversational NPCs", () => {
    expect(Object.keys(NPC_ROLE_LABELS).toSorted()).toStrictEqual(
      NPCS.map((npc) => npc.npcKey).toSorted(),
    );
  });

  it("never states Corin's involvement or Lark's existence", () => {
    for (const label of Object.values(NPC_ROLE_LABELS)) {
      const lowered = label.toLowerCase();
      expect(lowered).not.toContain("lark");
      expect(lowered).not.toContain("bell");
    }
  });

  it("is short player-safe copy, not Decision 009's long design-note form", () => {
    expect(NPC_ROLE_LABELS["corin_hale"]).toBe("Town guard");
    expect(NPC_ROLE_LABELS["corin_hale"]).not.toContain("moved");
  });
});

describe("ITEM_DESCRIPTIONS", () => {
  it("keys exactly the portable items", () => {
    expect(Object.keys(ITEM_DESCRIPTIONS).toSorted()).toStrictEqual(
      ITEMS.filter((item) => item.portable)
        .map((item) => item.entityKey)
        .toSorted(),
    );
  });

  it("never states the solution or Lark's existence", () => {
    for (const description of Object.values(ITEM_DESCRIPTIONS)) {
      const lowered = description.toLowerCase();
      expect(lowered).not.toContain("lark");
      expect(lowered).not.toContain("corin");
      expect(lowered).not.toContain("chapel");
    }
  });
});
