/**
 * The stable claim catalog and its authored relations.
 *
 * These twelve propositions exist because canon, initial knowledge, authored
 * disclosure, physical evidence, or the repeatable demo needs them. Players may
 * create others through the bounded grammar; those get the same treatment.
 *
 * Two claims here are false — Corin's cover story and the garden rumour — and
 * one is the explicit opposite of a true claim. They are seeded precisely so
 * that being believed and being true stay visibly different things.
 */

import { claimKeyV1 } from "./claim-key.js";

export type ClaimPredicate = "was_at" | "moved" | "damaged" | "is_at" | "acted_for";

export interface AuthoredClaim {
  readonly claimKey: string;
  readonly subjectKey: string;
  readonly subjectType: "character" | "item";
  readonly predicate: ClaimPredicate;
  readonly objectKey: string;
  readonly objectType: "location" | "item" | "motive";
  readonly polarity: "positive" | "negative";
  readonly contextKey: string;
  /** The player-facing sentence, used only for review and copy binding. */
  readonly sentence: string;
  readonly objectivelyTrueAtSeed: boolean;
}

export const CLAIMS: readonly AuthoredClaim[] = Object.freeze([
  {
    claimKey: "bell_not_at_square",
    subjectKey: "festival_bell",
    subjectType: "item",
    predicate: "is_at",
    objectKey: "festival_square",
    objectType: "location",
    polarity: "negative",
    contextKey: "festival_morning",
    sentence: "At dawn, the Festival Bell was not at Festival Square.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "lark_was_at_square",
    subjectKey: "lark_venn",
    subjectType: "character",
    predicate: "was_at",
    objectKey: "festival_square",
    objectType: "location",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Lark Venn was at Festival Square.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "corin_was_at_inn",
    subjectKey: "corin_hale",
    subjectType: "character",
    predicate: "was_at",
    objectKey: "lantern_inn",
    objectType: "location",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Corin Hale was at The Lantern Inn.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "lark_damaged_bell",
    subjectKey: "lark_venn",
    subjectType: "character",
    predicate: "damaged",
    objectKey: "festival_bell",
    objectType: "item",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Lark Venn damaged the Festival Bell.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "corin_moved_bell",
    subjectKey: "corin_hale",
    subjectType: "character",
    predicate: "moved",
    objectKey: "festival_bell",
    objectType: "item",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Corin Hale moved the Festival Bell.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "corin_was_at_chapel",
    subjectKey: "corin_hale",
    subjectType: "character",
    predicate: "was_at",
    objectKey: "old_chapel",
    objectType: "location",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Corin Hale was at the Old Chapel.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "bell_at_chapel",
    subjectKey: "festival_bell",
    subjectType: "item",
    predicate: "is_at",
    objectKey: "old_chapel",
    objectType: "location",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "The Festival Bell was at the Old Chapel on festival night.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "bell_at_chapel_current",
    subjectKey: "festival_bell",
    subjectType: "item",
    predicate: "is_at",
    objectKey: "old_chapel",
    objectType: "location",
    polarity: "positive",
    contextKey: "current",
    sentence: "The Festival Bell is currently at the Old Chapel.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "corin_protected_lark",
    subjectKey: "corin_hale",
    subjectType: "character",
    predicate: "acted_for",
    objectKey: "protect_lark",
    objectType: "motive",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Corin Hale acted to protect Lark Venn.",
    objectivelyTrueAtSeed: true,
  },
  {
    claimKey: "corin_acted_for_safety",
    subjectKey: "corin_hale",
    subjectType: "character",
    predicate: "acted_for",
    objectKey: "public_safety",
    objectType: "motive",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "Corin Hale acted to prevent a public accident.",
    objectivelyTrueAtSeed: false,
  },
  {
    claimKey: "bell_at_reeds_garden",
    subjectKey: "festival_bell",
    subjectType: "item",
    predicate: "is_at",
    objectKey: "reeds_garden",
    objectType: "location",
    polarity: "positive",
    contextKey: "festival_night",
    sentence: "The Festival Bell was at Reed's Garden on festival night.",
    objectivelyTrueAtSeed: false,
  },
  {
    claimKey: "lark_did_not_damage_bell",
    subjectKey: "lark_venn",
    subjectType: "character",
    predicate: "damaged",
    objectKey: "festival_bell",
    objectType: "item",
    polarity: "negative",
    contextKey: "festival_night",
    sentence: "Lark Venn did not damage the Festival Bell.",
    objectivelyTrueAtSeed: false,
  },
] as const);

export interface AuthoredClaimRelation {
  readonly claimAKey: string;
  readonly claimBKey: string;
  readonly relationKind: "contradicts" | "entails";
}

/**
 * Authored contradictions, written once each.
 *
 * `corin_protected_lark` contradicting `corin_acted_for_safety` is a semantic
 * relation for this case, not a universal rule that a person may hold only one
 * motive. It is what makes the scorched note able to undercut the cover story.
 */
const AUTHORED_CONTRADICTIONS: readonly (readonly [string, string])[] = Object.freeze([
  ["lark_damaged_bell", "lark_did_not_damage_bell"],
  ["corin_protected_lark", "corin_acted_for_safety"],
  ["bell_at_chapel", "bell_at_reeds_garden"],
] as const);

/**
 * Contradiction is symmetric, so both directions are stored. The schema makes
 * the ordered pair unique, and a mirror lookup that had to test two column
 * orders would be one forgotten branch away from a missed contradiction.
 */
export const CLAIM_RELATIONS: readonly AuthoredClaimRelation[] = Object.freeze(
  AUTHORED_CONTRADICTIONS.flatMap(([a, b]) => [
    { claimAKey: a, claimBKey: b, relationKind: "contradicts" as const },
    { claimAKey: b, claimBKey: a, relationKind: "contradicts" as const },
  ]),
);

/** Every claim key mapped to its frozen `claim-key:v1` representation. */
export function claimNormalizedKeys(): ReadonlyMap<string, string> {
  return new Map(
    CLAIMS.map((claim) => [
      claim.claimKey,
      claimKeyV1({
        subjectEntityType: claim.subjectType,
        subjectEntityKey: claim.subjectKey,
        predicate: claim.predicate,
        objectEntityType: claim.objectType,
        objectEntityKey: claim.objectKey,
        polarity: claim.polarity,
        contextKey: claim.contextKey,
      }),
    ]),
  );
}
