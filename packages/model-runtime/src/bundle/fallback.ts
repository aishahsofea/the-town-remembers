/**
 * The authored fallback resolver. `resolveFallbackLine` is the last-resort
 * path when selection and repair both fail — Decision 010: "the application
 * uses an authored fallback keyed by NPC, action, response kind, gate
 * result, and required outcome set. It must exactly cover every required
 * mechanical outcome." `assertFallbackCoverage` is the startup check that
 * feeds `rules/content-validation/fallback-coverage.ts`'s engine its first
 * real input (`content/dialogue/fallbacks.ts`) against a caller-supplied
 * requirement matrix.
 */

import type { ContentRegistry } from "@the-town-remembers/content";
import {
  computeFallbackCoverage,
  isFullyCovered,
  type AuthoredFallbackLine,
  type FallbackCoverageRequirement,
  type FallbackCoverageResult,
} from "@the-town-remembers/rules";

export interface FallbackLookup {
  readonly npcKey: string;
  readonly actionKind: string;
  readonly responseKind: string;
  readonly gateResult: string;
  readonly requiredOutcomeIds: readonly string[];
}

export interface ResolvedFallback {
  readonly npcKey: string;
  readonly actionKind: string;
  readonly responseKind: string;
  readonly gateResult: string;
  readonly outcomeIds: readonly string[];
  readonly text: string;
}

export class FallbackNotFoundError extends Error {
  constructor(lookup: FallbackLookup) {
    super(
      `No authored fallback for npc="${lookup.npcKey}" action="${lookup.actionKind}" ` +
        `responseKind="${lookup.responseKind}" gateResult="${lookup.gateResult}" ` +
        `requiredOutcomeIds=[${lookup.requiredOutcomeIds.join(",")}]`,
    );
    this.name = "FallbackNotFoundError";
  }
}

/**
 * Finds the authored line matching the exact `(npc, action, responseKind,
 * gateResult)` key whose outcome set is a superset of every required
 * outcome. A line matching the key but missing a required outcome does not
 * count — the same rule `computeFallbackCoverage` uses to judge coverage.
 */
export function resolveFallbackLine(
  content: ContentRegistry,
  lookup: FallbackLookup,
): ResolvedFallback {
  const match = content.fallbackLines.find(
    (line) =>
      line.npcKey === lookup.npcKey &&
      line.actionKind === lookup.actionKind &&
      line.responseKind === lookup.responseKind &&
      line.gateResult === lookup.gateResult &&
      lookup.requiredOutcomeIds.every((outcomeId) =>
        (line.outcomeIds as readonly string[]).includes(outcomeId),
      ),
  );
  if (!match) throw new FallbackNotFoundError(lookup);
  return match;
}

export class FallbackCoverageError extends Error {
  readonly missing: readonly FallbackCoverageRequirement[];

  constructor(missing: readonly FallbackCoverageRequirement[]) {
    super(
      `${missing.length} fallback requirement(s) have no authored line: ` +
        missing
          .map(
            (requirement) =>
              `${requirement.npcKey}/${requirement.actionKind}/${requirement.responseKind}/${requirement.gateResult}`,
          )
          .join(", "),
    );
    this.name = "FallbackCoverageError";
    this.missing = missing;
  }
}

function toAuthoredFallbackLines(
  content: ContentRegistry,
): readonly AuthoredFallbackLine[] {
  return content.fallbackLines.map((line) => ({
    npcKey: line.npcKey,
    actionKind: line.actionKind,
    responseKind: line.responseKind,
    gateResult: line.gateResult,
    outcomeIds: line.outcomeIds,
  }));
}

/** Runs the coverage engine and returns the result without throwing — useful for a report rather than a hard gate. */
export function checkFallbackCoverage(
  content: ContentRegistry,
  requirements: readonly FallbackCoverageRequirement[],
): FallbackCoverageResult {
  return computeFallbackCoverage(requirements, toAuthoredFallbackLines(content));
}

/** Throws `FallbackCoverageError` naming every uncovered requirement. Intended to run once at process startup. */
export function assertFallbackCoverage(
  content: ContentRegistry,
  requirements: readonly FallbackCoverageRequirement[],
): void {
  const result = checkFallbackCoverage(content, requirements);
  if (!isFullyCovered(result)) throw new FallbackCoverageError(result.missing);
}
