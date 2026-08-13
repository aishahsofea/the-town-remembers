/**
 * Canonical form used only for display-name uniqueness.
 *
 * Inputs are NFKC-normalized before case folding. ECMAScript exposes Unicode's
 * full uppercase expansions but not a `caseFold` primitive, so two
 * upper/lower passes form the stable caseless-equivalence key, including
 * multi-code-point and decomposing mappings. The explicit fixups cover the
 * differences from Unicode's default full case folding: contextual final
 * sigma, dotless i, and Cherokee (whose canonical folded form is uppercase).
 * The sentinel is safe because private-use characters are rejected by the
 * public display-name schema.
 */
export function normalizeDisplayNameForUniqueness(displayName: string): string {
  const dotlessISentinel = "\uE000";
  const folded = displayName
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/gu, " ")
    .replaceAll("ı", dotlessISentinel)
    .toUpperCase()
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .replaceAll(dotlessISentinel, "ı")
    .replaceAll("ς", "σ");

  return Array.from(folded, (character) => {
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= 0xab70 && codePoint <= 0xabbf) {
      return String.fromCodePoint(codePoint - 0x97d0);
    }
    if (codePoint >= 0x13f8 && codePoint <= 0x13fd) {
      return String.fromCodePoint(codePoint - 8);
    }
    return character;
  }).join("");
}
