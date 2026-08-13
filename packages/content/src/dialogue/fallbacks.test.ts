import { describe, expect, it } from "vitest";

import {
  ALL_FALLBACK_LINES,
  CORIN_FALLBACK_CONFESSION,
  GENERIC_ACTION_FALLBACKS,
  OUTCOME_FALLBACKS,
  SITUATIONAL_DENIALS,
} from "./fallbacks.js";

const NPC_KEYS = ["mara_venn", "corin_hale", "nessa_reed"] as const;
const DIALOGUE_ACTION_KINDS = [
  "ask",
  "tell",
  "show",
  "give",
  "accept_promise",
] as const;

describe("generic per-action fallbacks", () => {
  it("covers every NPC for every dialogue action kind", () => {
    for (const npcKey of NPC_KEYS) {
      for (const actionKind of DIALOGUE_ACTION_KINDS) {
        const hasLine = GENERIC_ACTION_FALLBACKS.some(
          (line) => line.npcKey === npcKey && line.actionKind === actionKind,
        );
        expect(hasLine, `${npcKey}/${actionKind}`).toBe(true);
      }
    }
  });

  it("never contains a hidden claim, only safe closing prose", () => {
    for (const line of GENERIC_ACTION_FALLBACKS) {
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.outcomeIds).toStrictEqual([]);
    }
  });
});

describe("situational denials", () => {
  it("gives Nessa's key refusal, Corin's chapel refusal, and Mara's confidential withhold", () => {
    expect(
      SITUATIONAL_DENIALS.find(
        (line) => line.npcKey === "nessa_reed" && line.gateResult === "denied_access",
      )?.text,
    ).toBe("I do not lend the chapel key on urgency alone.");
    expect(
      SITUATIONAL_DENIALS.find(
        (line) => line.npcKey === "corin_hale" && line.gateResult === "denied_access",
      )?.text,
    ).toBe("You have not shown me enough to justify opening a sealed place.");
    expect(
      SITUATIONAL_DENIALS.find(
        (line) =>
          line.npcKey === "mara_venn" && line.gateResult === "denied_disclosure_tier",
      )?.text,
    ).toBe("Some matters are not mine to scatter through the town.");
  });

  it("gives every NPC the item-refused, promise-stale, and town-frozen lines", () => {
    for (const npcKey of NPC_KEYS) {
      for (const gateResult of [
        "denied_custody",
        "denied_promise_context",
        "town_frozen",
      ]) {
        const hasLine = SITUATIONAL_DENIALS.some(
          (line) => line.npcKey === npcKey && line.gateResult === gateResult,
        );
        expect(hasLine, `${npcKey}/${gateResult}`).toBe(true);
      }
    }
  });
});

describe("outcome fallbacks", () => {
  it("gives every NPC the generic item-received line", () => {
    for (const npcKey of NPC_KEYS) {
      const hasLine = OUTCOME_FALLBACKS.some(
        (line) =>
          line.npcKey === npcKey && line.outcomeIds.includes("requested_item_received"),
      );
      expect(hasLine, npcKey).toBe(true);
    }
  });

  it("matches Decision 009's exact outcome-specific lines", () => {
    expect(
      OUTCOME_FALLBACKS.find((line) => line.outcomeIds.includes("chapel_key_lent"))
        ?.text,
    ).toBe("Take the chapel key. Bring it back when the inquiry is settled.");
    expect(
      OUTCOME_FALLBACKS.find((line) =>
        line.outcomeIds.includes("chapel_access_granted"),
      )?.text,
    ).toBe("You have shown enough. The chapel is open to you.");
    expect(
      OUTCOME_FALLBACKS.find((line) =>
        line.outcomeIds.includes("keep_secret_promise_accepted"),
      )?.text,
    ).toBe("Your promise is recorded.");
  });
});

describe("Corin's fallback confession", () => {
  it("matches Decision 009's exact confession text", () => {
    expect(CORIN_FALLBACK_CONFESSION.text).toBe(
      "Lark damaged the bell by accident, and I moved it to the Old Chapel before the " +
        "council could see it because I meant to protect her. I told myself I was " +
        "preserving order. I was hiding the truth.",
    );
    expect(CORIN_FALLBACK_CONFESSION.npcKey).toBe("corin_hale");
  });
});

describe("the combined fallback list", () => {
  it("has no duplicate (npc, action, responseKind, gateResult) key", () => {
    const seen = new Set<string>();
    for (const line of ALL_FALLBACK_LINES) {
      const key = `${line.npcKey}|${line.actionKind}|${line.responseKind}|${line.gateResult}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});
