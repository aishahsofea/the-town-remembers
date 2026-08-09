/**
 * Numeric and version primitives every later workstream shares, so a
 * boundary rule (a clamp, a floor, a version check) is written exactly once.
 */

import { contentFor } from "@the-town-remembers/content";

import { RULES_REGISTRY } from "./version.js";

/** Clamps `value` into `[minimum, maximum]`, inclusive on both ends. */
export function clampToRange(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Clamps a raw belief score into Decision 008's accepted `[-100, 100]` range. */
export function clampScore(value: number): number {
  const { minimum, maximum } = RULES_REGISTRY.scoreRange;
  return clampToRange(value, minimum, maximum);
}

/**
 * A documented one-line alias for `Math.floor`, written out because a
 * truncating implementation (`Math.trunc`) silently disagrees only for
 * negative inputs — `floor(-25 / 10)` must be `-3`, not `-2`. The testimony
 * formula (`P2-04`) hits exactly this case whenever a listener's trust in the
 * speaker is negative.
 */
export function ruleFloor(value: number): number {
  return Math.floor(value);
}

/**
 * Groups raw per-contribution deltas by target, sums each group from one
 * pre-event snapshot, then clamps once per target — Decision 008's "summed
 * by target row, clamped once" rule for a single event with multiple
 * contributions to the same row.
 */
export function sumEventContributions<TContribution, TTarget>(
  contributions: readonly TContribution[],
  targetOf: (contribution: TContribution) => TTarget,
  deltaOf: (contribution: TContribution) => number,
): Map<TTarget, number> {
  const totals = new Map<TTarget, number>();
  for (const contribution of contributions) {
    const target = targetOf(contribution);
    totals.set(target, (totals.get(target) ?? 0) + deltaOf(contribution));
  }
  for (const [target, total] of totals) {
    totals.set(target, clampScore(total));
  }
  return totals;
}

export class ContentVersionMismatchError extends Error {
  readonly reasonCode = "CONTENT_VERSION_MISMATCH" as const;
  readonly contentVersion: string;
  readonly requestedRulesVersion: string;
  readonly actualRulesVersion: string;

  constructor(
    contentVersion: string,
    requestedRulesVersion: string,
    actualRulesVersion: string,
  ) {
    super(
      `Content version "${contentVersion}" runs rules "${actualRulesVersion}", ` +
        `not the requested "${requestedRulesVersion}".`,
    );
    this.name = "ContentVersionMismatchError";
    this.contentVersion = contentVersion;
    this.requestedRulesVersion = requestedRulesVersion;
    this.actualRulesVersion = actualRulesVersion;
  }
}

/**
 * A town pins `content_version`, which in turn pins the rules version it was
 * seeded under (Decision 008). Looking up content by that version and
 * confirming its `rulesVersion` matches what the caller expects fails closed
 * rather than silently running one town's history under another version's
 * rules.
 */
export function assertCompatibleVersions(
  contentVersion: string,
  rulesVersion: string,
): void {
  const content = contentFor(contentVersion);
  if (content.rulesVersion !== rulesVersion) {
    throw new ContentVersionMismatchError(
      contentVersion,
      rulesVersion,
      content.rulesVersion,
    );
  }
}
