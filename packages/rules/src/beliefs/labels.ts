/**
 * Belief labels, dialogue stance, contestation, and selected belief.
 *
 * The stored `label` reuses `database/domains`'s three bands directly
 * (`D2-C`) rather than restating them a third time — `content/seed.ts`
 * already has its own private copy, and this package's own test proves the
 * two agree rather than adding a fourth implementation.
 */

import { beliefLabelFor, type BeliefLabel } from "@the-town-remembers/database/domains";
import type { ContentRegistry } from "@the-town-remembers/content";

import { RULES_REGISTRY } from "../kernel/version.js";

export { beliefLabelFor, type BeliefLabel };

export type DialogueStance =
  "confident" | "tentative" | "uncertain_or_reported" | "explicit_reject";

/**
 * The stored `label` alone cannot select dialogue stance: the `-19..19` and
 * `-100..-20` bands share the label `doubtful` but Decision 008 gives them
 * different approved phrasing (`D2-O`) — a claim scored `-20` is an explicit
 * denial, one scored `-19` is merely unconfirmed.
 */
export function dialogueStanceFor(score: number): DialogueStance {
  if (score >= 60) return "confident";
  if (score >= 20) return "tentative";
  if (score >= -19) return "uncertain_or_reported";
  return "explicit_reject";
}

/**
 * `lead = topScore - secondHighestScore`. When no contradicting claim has
 * any evidence, `secondHighestScore` is `0` — not omitted from the formula —
 * so an uncontested claim's lead equals its own score.
 */
export function contestationLead(
  claimScore: number,
  contradictingClaimScores: readonly number[],
): number {
  const secondHighestScore =
    contradictingClaimScores.length > 0 ? Math.max(...contradictingClaimScores) : 0;
  return claimScore - secondHighestScore;
}

/**
 * A belief unlocks a belief-dependent gate only when it is both convincing on
 * its own (`score >= 20`) and clearly ahead of anything that contradicts it
 * (`lead >= 20`). A contested set with no such claim unlocks nothing.
 */
export function isSelectedBelief(
  claimScore: number,
  contradictingClaimScores: readonly number[],
): boolean {
  const { minimumScore, minimumLead } = RULES_REGISTRY.selectedBelief;
  return (
    claimScore >= minimumScore &&
    contestationLead(claimScore, contradictingClaimScores) >= minimumLead
  );
}

/**
 * Whether `claimKey` is the one authored claim Corin's cover story is built
 * on: the false `acted_for` claim naming his public-safety motive. Derived
 * structurally from the content registry — subject type, predicate, and the
 * authored truth flag — never from any belief score, so a well-believed lie
 * cannot accidentally read as objectively true through this path.
 */
export function isAuthoredCoverStory(
  claimKey: string,
  content: ContentRegistry,
): boolean {
  const claim = content.claims.find((candidate) => candidate.claimKey === claimKey);
  if (claim === undefined) return false;
  return (
    claim.subjectType === "character" &&
    claim.predicate === "acted_for" &&
    !claim.objectivelyTrueAtSeed
  );
}
