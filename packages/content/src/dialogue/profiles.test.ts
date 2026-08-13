import { describe, expect, it } from "vitest";

import { NPCS } from "../entities.js";
import { NPC_DIALOGUE_PROFILES, dialogueProfileForVersion } from "./profiles.js";

describe("NPC dialogue profiles", () => {
  it("covers exactly the three conversational NPCs", () => {
    expect(NPC_DIALOGUE_PROFILES).toHaveLength(3);
    expect(new Set(NPC_DIALOGUE_PROFILES.map((profile) => profile.npcKey)).size).toBe(
      3,
    );
  });

  it("matches every NPC's own profileVersion exactly", () => {
    for (const npc of NPCS) {
      const profile = dialogueProfileForVersion(npc.profileVersion);
      expect(profile).toBeDefined();
      expect(profile?.npcKey).toBe(npc.npcKey);
    }
  });

  it("gives every profile at least one voice rule and one never-do rule", () => {
    for (const profile of NPC_DIALOGUE_PROFILES) {
      expect(profile.voiceRules.length).toBeGreaterThan(0);
      expect(profile.neverDoRules.length).toBeGreaterThan(0);
      expect(profile.coreWant.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an unknown profile version", () => {
    expect(dialogueProfileForVersion("unknown-npc/9.9.9")).toBeUndefined();
  });

  it("tells Mara never to reveal the chapel location", () => {
    const mara = dialogueProfileForVersion("mara-venn/1.0.0");
    expect(mara?.neverDoRules).toContain("Reveal the chapel location.");
  });

  it("tells Nessa never to claim she saw the bell on the cart", () => {
    const nessa = dialogueProfileForVersion("nessa-reed/1.0.0");
    expect(nessa?.neverDoRules).toContain("Claim she saw the bell on the cart.");
  });
});
