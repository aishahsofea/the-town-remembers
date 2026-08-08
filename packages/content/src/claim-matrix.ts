/**
 * Which entity types each predicate may relate.
 *
 * The database renders the same matrix into a CHECK constraint from its own
 * declaration in `@the-town-remembers/database`. Content cannot import that
 * package — authored data must stay usable without a driver — so the two are
 * kept honest by a drift test in `town-seed`, which depends on both.
 */

export const CLAIM_ENTITY_MATRIX = Object.freeze({
  was_at: { subject: "character", object: "location" },
  moved: { subject: "character", object: "item" },
  damaged: { subject: "character", object: "item" },
  is_at: { subject: "item", object: "location" },
  acted_for: { subject: "character", object: "motive" },
} as const);
