import { describe, expect, it } from "vitest";

import { ITEMS, NPCS } from "../entities.js";
import {
  PROMISE_TERMS,
  REQUESTED_ITEM_BINDINGS,
  requestedItemBindingForNpc,
} from "./offers.js";

describe("requested item bindings", () => {
  it("binds exactly Corin's seal and Nessa's lens", () => {
    expect(REQUESTED_ITEM_BINDINGS).toHaveLength(2);
    expect(requestedItemBindingForNpc("corin_hale")?.itemKey).toBe(
      "guard_dispatch_seal",
    );
    expect(requestedItemBindingForNpc("nessa_reed")?.itemKey).toBe("nessas_field_lens");
  });

  it("returns undefined for an NPC with no requested item", () => {
    expect(requestedItemBindingForNpc("mara_venn")).toBeUndefined();
  });

  it("references a real NPC and a real portable item for every binding", () => {
    const npcKeys = new Set(NPCS.map((npc) => npc.npcKey));
    const portableItemKeys = new Set(
      ITEMS.filter((item) => item.portable).map((item) => item.entityKey),
    );
    for (const binding of REQUESTED_ITEM_BINDINGS) {
      expect(npcKeys.has(binding.npcKey)).toBe(true);
      expect(portableItemKeys.has(binding.itemKey)).toBe(true);
      expect(binding.prompt.length).toBeGreaterThan(0);
    }
  });

  it("re-exports the two already-authored promise terms", () => {
    expect(PROMISE_TERMS.keepLarkAccidentSecret.termsVersion).toBe(
      "keep-lark-accident-secret-v1",
    );
    expect(PROMISE_TERMS.returnChapelKey.termsVersion).toBe("return-chapel-key-v1");
  });
});
