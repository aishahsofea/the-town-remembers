/**
 * Adversarial display-name payloads (`P3-17` acceptance 4). Each of these is
 * rejected before any write — the schema itself is the boundary — by
 * `DisplayNameSchema`'s allowlist pattern
 * (`packages/http-contracts/src/primitives.ts`), which accepts only letters,
 * numbers, spaces, apostrophes, and hyphens. None of the four payloads below
 * fall in that set, so the same one check rejects a literal script tag, an
 * HTML entity, a zero-width joiner, and a right-to-left override alike —
 * there is no separate "looks like markup" detector to bypass.
 *
 * The zero-width joiner and right-to-left override are built from their code
 * points at runtime rather than written as a literal glyph, so this source
 * file never itself carries an invisible or directionality-changing
 * character.
 */

import { describe, expect, it } from "vitest";

import { DisplayNameSchema } from "@the-town-remembers/http-contracts";

const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);

const ADVERSARIAL_DISPLAY_NAMES = {
  "a literal script tag": "<script>",
  "an HTML entity encoding of <": "&#60;",
  "a zero-width joiner hidden inside an otherwise plausible name": `Ann${ZERO_WIDTH_JOINER}Marie`,
  "a right-to-left override hidden inside an otherwise plausible name": `Ann${RIGHT_TO_LEFT_OVERRIDE}Marie`,
} as const;

describe("DisplayNameSchema rejects adversarial payloads (P3-17 acceptance 4)", () => {
  for (const [label, value] of Object.entries(ADVERSARIAL_DISPLAY_NAMES)) {
    it(`rejects ${label}`, () => {
      expect(DisplayNameSchema.safeParse(value).success).toBe(false);
    });
  }

  it("still accepts an ordinary display name, so this is a real allowlist and not a blanket refusal", () => {
    expect(DisplayNameSchema.safeParse("Ann Marie").success).toBe(true);
  });
});
