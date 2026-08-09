import { describe, expect, it } from "vitest";

import { PROMISE_TERMS } from "@the-town-remembers/content";
import { base64UrlUtf8 } from "@the-town-remembers/serialization";

import {
  decodePromiseOffer,
  encodePromiseOffer,
  hasActivePromise,
  keepSecretBreaks,
  keepSecretEndingOutcome,
  PROMISE_OFFER_DOMAIN,
  returnItemEndingOutcome,
  returnItemTransferOutcome,
} from "./promises.js";

describe("promise-offer:v1 encoding (D2-E)", () => {
  it("encodes exactly domain, source action ID, and ordinal joined by newlines", () => {
    const offer = encodePromiseOffer("action-42", 0);
    expect(offer).toBe(base64UrlUtf8(`${PROMISE_OFFER_DOMAIN}\naction-42\n0`));
  });

  it("round-trips through decode", () => {
    const offer = encodePromiseOffer("action-42", 3);
    expect(decodePromiseOffer(offer)).toStrictEqual({
      sourceActionId: "action-42",
      ordinal: 3,
    });
  });

  it("rejects a malformed offer ID rather than throwing", () => {
    expect(decodePromiseOffer("not-base64url-!!!")).toBeUndefined();
  });

  it("rejects an offer from a different domain", () => {
    const wrongDomain = base64UrlUtf8("some-other-domain:v1\naction-1\n0");
    expect(decodePromiseOffer(wrongDomain)).toBeUndefined();
  });

  it("rejects a non-decimal ordinal", () => {
    const bad = base64UrlUtf8(`${PROMISE_OFFER_DOMAIN}\naction-1\nnot-a-number`);
    expect(decodePromiseOffer(bad)).toBeUndefined();
  });
});

describe("hasActivePromise", () => {
  it("denies reaccepting an already-active promise of the same subject", () => {
    const active = [
      { npcId: "nessa_reed", kind: "return_item" as const, protectedItemId: "key" },
    ];
    expect(
      hasActivePromise(active, {
        npcId: "nessa_reed",
        kind: "return_item",
        protectedItemId: "key",
      }),
    ).toBe(true);
  });

  it("allows a promise of a different subject to the same NPC", () => {
    const active = [
      { npcId: "mara_venn", kind: "keep_secret" as const, protectedClaimId: "c1" },
    ];
    expect(
      hasActivePromise(active, {
        npcId: "mara_venn",
        kind: "keep_secret",
        protectedClaimId: "c2",
      }),
    ).toBe(false);
  });
});

describe("keepSecretBreaks", () => {
  it("breaks on a structured transmission of the protected claim to anyone but the NPC", () => {
    expect(
      keepSecretBreaks(
        "claim-key-1",
        {
          isStructured: true,
          normalizedClaimKey: "claim-key-1",
          recipientActorId: "npc-other",
        },
        "mara_venn",
      ),
    ).toBe(true);
  });

  it("never breaks on an unstructured board note", () => {
    expect(
      keepSecretBreaks(
        "claim-key-1",
        {
          isStructured: false,
          normalizedClaimKey: "claim-key-1",
          recipientActorId: "npc-other",
        },
        "mara_venn",
      ),
    ).toBe(false);
  });

  it("does not break when told back to the requesting NPC", () => {
    expect(
      keepSecretBreaks(
        "claim-key-1",
        {
          isStructured: true,
          normalizedClaimKey: "claim-key-1",
          recipientActorId: "mara_venn",
        },
        "mara_venn",
      ),
    ).toBe(false);
  });

  it("does not break for a different claim", () => {
    expect(
      keepSecretBreaks(
        "claim-key-1",
        {
          isStructured: true,
          normalizedClaimKey: "claim-key-2",
          recipientActorId: "npc-other",
        },
        "mara_venn",
      ),
    ).toBe(false);
  });
});

describe("returnItemTransferOutcome", () => {
  it("fulfills when custody reaches the requester", () => {
    expect(returnItemTransferOutcome("nessa_reed", "nessa_reed")).toBe("fulfilled");
  });

  it("breaks on transfer to anyone else", () => {
    expect(returnItemTransferOutcome("nessa_reed", "corin_hale")).toBe("broken");
  });

  it("does nothing when the player leaves town still holding it", () => {
    expect(returnItemTransferOutcome("nessa_reed", null)).toBe("no_change");
  });
});

describe("ending-time resolution", () => {
  it("restore_bell_quietly fulfills every active secrecy promise", () => {
    expect(keepSecretEndingOutcome("restore_bell_quietly", false)).toBe("fulfilled");
    expect(keepSecretEndingOutcome("restore_bell_quietly", true)).toBe("fulfilled");
  });

  it("expose_cover_up breaks the secrecy promise only if its claim enters the public resolution", () => {
    expect(keepSecretEndingOutcome("expose_cover_up", true)).toBe("broken");
    expect(keepSecretEndingOutcome("expose_cover_up", false)).toBe("unchanged");
  });

  it("return_item resolves identically regardless of the chosen ending", () => {
    expect(returnItemEndingOutcome(true)).toBe("fulfilled");
    expect(returnItemEndingOutcome(false)).toBe("broken");
  });
});

describe("authored promise terms come from content, not restated here", () => {
  it("Nessa's key-loan term is a return_item promise", () => {
    expect(PROMISE_TERMS.returnChapelKey.kind).toBe("return_item");
    expect(PROMISE_TERMS.returnChapelKey.npcKey).toBe("nessa_reed");
  });

  it("Mara's secret term is a keep_secret promise", () => {
    expect(PROMISE_TERMS.keepLarkAccidentSecret.kind).toBe("keep_secret");
    expect(PROMISE_TERMS.keepLarkAccidentSecret.npcKey).toBe("mara_venn");
  });
});
