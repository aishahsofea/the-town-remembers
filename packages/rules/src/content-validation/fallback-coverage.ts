/**
 * Fallback-coverage checking engine.
 *
 * `content/validate.ts` checks starting-knowledge boundaries but has no
 * fallback-coverage or reachability check today — this is genuinely new
 * work. This module owns the *checking engine*: given the set of
 * `(NPC, action, response_kind, gate_result, required_outcome_set)`
 * combinations Decision 009's fallback table names, and the lines an
 * author actually wrote, it reports exactly what's missing.
 *
 * The engine takes authored lines as an explicit input rather than reading
 * `packages/content` directly: dialogue authoring is Phase 4/5's job, not
 * this phase's, so `bell-mystery-v1` has no fallback lines to check yet. A
 * later phase runs this engine against its own authored table; this
 * package proves the engine is correct today using synthetic fixtures.
 */

export interface FallbackCoverageRequirement {
  readonly npcKey: string;
  readonly actionKind: string;
  readonly responseKind: string;
  readonly gateResult: string;
  readonly requiredOutcomeIds: readonly string[];
}

export interface AuthoredFallbackLine {
  readonly npcKey: string;
  readonly actionKind: string;
  readonly responseKind: string;
  readonly gateResult: string;
  readonly outcomeIds: readonly string[];
}

export interface FallbackCoverageResult {
  readonly covered: readonly FallbackCoverageRequirement[];
  readonly missing: readonly FallbackCoverageRequirement[];
}

function requirementKey(entry: {
  readonly npcKey: string;
  readonly actionKind: string;
  readonly responseKind: string;
  readonly gateResult: string;
}): string {
  return `${entry.npcKey}|${entry.actionKind}|${entry.responseKind}|${entry.gateResult}`;
}

/**
 * A requirement is covered only when an authored line exists for the exact
 * `(npc, action, response_kind, gate_result)` key *and* that line's outcome
 * set is a superset of every required outcome ID — a line that matches the
 * key but omits a required outcome does not count as coverage.
 */
export function computeFallbackCoverage(
  requirements: readonly FallbackCoverageRequirement[],
  authoredLines: readonly AuthoredFallbackLine[],
): FallbackCoverageResult {
  const authoredByKey = new Map<string, AuthoredFallbackLine>();
  for (const line of authoredLines) authoredByKey.set(requirementKey(line), line);

  const covered: FallbackCoverageRequirement[] = [];
  const missing: FallbackCoverageRequirement[] = [];
  for (const requirement of requirements) {
    const authored = authoredByKey.get(requirementKey(requirement));
    const isCovered =
      authored !== undefined &&
      requirement.requiredOutcomeIds.every((outcomeId) =>
        authored.outcomeIds.includes(outcomeId),
      );
    (isCovered ? covered : missing).push(requirement);
  }

  return { covered, missing };
}

export function isFullyCovered(result: FallbackCoverageResult): boolean {
  return result.missing.length === 0;
}
