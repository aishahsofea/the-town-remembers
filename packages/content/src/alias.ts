/**
 * `D4-J`: NFKC-normalized, case-folded alternative names a player might use
 * in free text, consumed by claim normalization's `canonical_entities`/
 * `canonical_actors`/`allowed_contexts` (Decision 010). Shared by
 * `entities.ts` (entity/actor aliases) and `contexts.ts` (context aliases)
 * so both namespaces normalize identically.
 */
export function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeAliases(values: readonly string[]): readonly string[] {
  return Object.freeze(values.map(normalizeAlias));
}
