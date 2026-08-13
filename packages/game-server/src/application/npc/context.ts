/**
 * `NpcContextBuilder`: loads one NPC's disclosure-relevant state
 * (`loadDisclosureSources`, `P4-09` part 2) and turns it into an
 * `ApprovedDisclosureBundle` (`buildDisclosureBundleForNpc`, the pure core
 * from part 1). The pure/impure split matches `application/npc/recall.ts`'s
 * own split from `P4-08` — `buildDisclosureBundleForNpc` takes no `Pool`
 * and is unit-tested directly; `loadDisclosureSources` is the thin
 * DB-orchestrating composition of the five `persistence/{npc-state,beliefs,
 * relationships,promises,board}.ts` reads this task built, kept in this
 * same file (unlike `recall.ts`'s two-file split) because the composition
 * itself has no non-trivial logic of its own to unit-test in isolation.
 */

import {
  claimNormalizedKeys,
  DISCLOSURE_TIER_TABLE,
  type ContentRegistry,
  type DisclosureTierBinding,
} from "@the-town-remembers/content";
import {
  buildApprovedDisclosureBundle,
  isAuthoredCoverStory,
  type ApprovedDisclosureBundle,
  type ApprovedEpisodeSummary,
  type ApprovedOutcome,
  type ClaimStance,
  type DisclosureCandidateInput,
  type DisclosureTier,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import {
  readGroundingEpisodes,
  readReceivedTransmissions,
} from "../../persistence/board.js";
import {
  readClaimIdsByNormalizedKeys,
  readContradictingClaimScores,
  readNpcBeliefs,
} from "../../persistence/beliefs.js";
import {
  hasEverBrokenPromiseToNpc,
  readRelationshipScores,
} from "../../persistence/relationships.js";

/**
 * How one NPC came to know an authored claim — its own episode memory,
 * never a raw database row. `undefined` means no grounding episode exists
 * yet for this (npc, claim) pair (not expected for `BELL_MYSTERY_V1`'s
 * authored rows, all of which are seeded with one, but not assumed here).
 */
export type DisclosureGrounding =
  | { readonly kind: "direct_observation"; readonly episodeId: string }
  | {
      readonly kind: "heard_claim";
      readonly episodeId: string;
      readonly parentTransmissionId: string;
    }
  | undefined;

/** One authored (npcKey, claimKey) disclosure row, resolved to its real claim ID and this NPC's grounding. */
export interface ResolvedDisclosureSource {
  readonly claimKey: string;
  readonly claimId: string;
  readonly tier: DisclosureTier;
  readonly grounding: DisclosureGrounding;
  readonly permittedEntityIds: readonly string[];
}

export interface ClaimBeliefState {
  readonly score: number;
  readonly contradictingScores: readonly number[];
}

export interface DisclosureGateContext {
  readonly isRelevantToRequest: (claimKey: string) => boolean;
  readonly trust: number;
  readonly suspicion: number;
  readonly verifiedCluePresentedThisAction: boolean;
  readonly everBrokenPromiseToThisNpc: boolean;
  readonly confrontationGateOpen: boolean;
  /** Current belief and contradiction state, keyed by claim ID; a claim absent here has never received evidence (score `0`, no contradictions). */
  readonly beliefByClaimId: ReadonlyMap<string, ClaimBeliefState>;
}

function stanceFor(grounding: DisclosureGrounding): ClaimStance {
  return grounding?.kind === "heard_claim" ? "hearsay" : "believed";
}

function sourceEpisodeIdFor(grounding: DisclosureGrounding): string | null {
  return grounding?.episodeId ?? null;
}

function parentTransmissionIdFor(grounding: DisclosureGrounding): string | null {
  return grounding?.kind === "heard_claim" ? grounding.parentTransmissionId : null;
}

/**
 * Every authored (npcKey, claimKey) row in `DISCLOSURE_TIER_TABLE` is
 * either a direct observation or reported speech the NPC can always
 * recount as such — `disclosure/tiers.ts`'s own module comment: only an
 * *ordinary asserted* claim needs the belief/contestation gate, and this
 * corpus's rows are never that (each is grounded in the NPC's own episode
 * memory). `requiresBeliefGate` is therefore always `false` for this
 * corpus; a future claim disclosed with no grounding episode at all (a
 * rumor an NPC merely absorbed secondhand, with no `heard_claim` episode of
 * its own) would need `true` — that shape does not exist in
 * `BELL_MYSTERY_V1`'s authored content today.
 */
function buildCandidate(
  source: ResolvedDisclosureSource,
  content: ContentRegistry,
  context: DisclosureGateContext,
): DisclosureCandidateInput {
  const belief = context.beliefByClaimId.get(source.claimId);
  return {
    claimId: source.claimId,
    requiresBeliefGate: false,
    stance: stanceFor(source.grounding),
    sourceEpisodeId: sourceEpisodeIdFor(source.grounding),
    parentTransmissionId: parentTransmissionIdFor(source.grounding),
    tier: source.tier,
    gateInputs: {
      isRelevantToRequest: context.isRelevantToRequest(source.claimKey),
      trust: context.trust,
      suspicion: context.suspicion,
      verifiedCluePresentedThisAction: context.verifiedCluePresentedThisAction,
      everBrokenPromiseToThisNpc: context.everBrokenPromiseToThisNpc,
      isCorinsCoverStoryClaim: isAuthoredCoverStory(source.claimKey, content),
      confrontationGateOpen: context.confrontationGateOpen,
    },
    beliefScore: belief?.score ?? 0,
    contradictingClaimScores: belief?.contradictingScores ?? [],
    permittedEntityIds: source.permittedEntityIds,
  };
}

export interface BuildDisclosureBundleParams {
  readonly sources: readonly ResolvedDisclosureSource[];
  readonly content: ContentRegistry;
  readonly gateContext: DisclosureGateContext;
  readonly requiredDisclosureIds?: readonly string[];
  readonly approvedOutcomes?: readonly ApprovedOutcome[];
  readonly requiredOutcomeIds?: readonly string[];
  readonly approvedEpisodes?: readonly ApprovedEpisodeSummary[];
}

/**
 * Builds the `ApprovedDisclosureBundle` for one NPC from its authored
 * disclosure-tier rows — the mechanism that makes "Mara's bundle never
 * contains the chapel location" true by construction: Mara's own rows in
 * `DISCLOSURE_TIER_TABLE` never name a `final_truth` claim, so no gate
 * evaluation could ever approve one for her regardless of trust, belief, or
 * confrontation-gate state. The same holds for Nessa and the cart's load,
 * and for Corin's `final_truth` rows against the confrontation gate.
 */
export function buildDisclosureBundleForNpc(
  params: BuildDisclosureBundleParams,
): ApprovedDisclosureBundle {
  const candidates = params.sources.map((source) =>
    buildCandidate(source, params.content, params.gateContext),
  );
  return buildApprovedDisclosureBundle(
    candidates,
    params.requiredDisclosureIds ?? [],
    params.approvedOutcomes ?? [],
    params.requiredOutcomeIds ?? [],
    params.approvedEpisodes ?? [],
  );
}

/** The authored disclosure rows for one NPC — `DISCLOSURE_TIER_TABLE` filtered to `npcKey`, the fixed set `buildDisclosureBundleForNpc` needs resolving (claim IDs, grounding) before it can run. */
export function disclosureRowsForNpc(npcKey: string): readonly DisclosureTierBinding[] {
  return DISCLOSURE_TIER_TABLE.filter((row) => row.npcKey === npcKey);
}

export interface LoadDisclosureSourcesParams {
  readonly pool: Pool;
  readonly townId: string;
  readonly npcId: string;
  readonly npcKey: string;
  readonly playerId: string;
}

export interface LoadedDisclosureInputs {
  readonly sources: readonly ResolvedDisclosureSource[];
  readonly relationship: { readonly trust: number; readonly suspicion: number };
  readonly everBrokenPromiseToThisNpc: boolean;
  readonly beliefByClaimId: ReadonlyMap<string, ClaimBeliefState>;
}

/**
 * Resolves `disclosureRowsForNpc(npcKey)` against real database state:
 * claim IDs (`claims.normalized_key`), each claim's grounding (an episode,
 * direct or heard — `board.ts#readGroundingEpisodes`/
 * `readReceivedTransmissions`), belief/contradiction scores
 * (`beliefs.ts`), and this player's relationship/grievance state with the
 * NPC (`relationships.ts`). A row whose claim was never normalized in this
 * town (`claims` has no matching `normalized_key` row yet) is silently
 * dropped — there is nothing to disclose about a proposition that does not
 * exist as a row, and `BELL_MYSTERY_V1`'s seed always creates one for every
 * authored `DISCLOSURE_TIER_TABLE` entry, so this only matters for a town
 * whose seed failed partway or a future, less complete content pack.
 *
 * Does **not** decide `isRelevantToRequest`, `verifiedCluePresentedThisAction`,
 * or `confrontationGateOpen` — those depend on the specific action being
 * built (which claim(s) the player is asking about; whether a clue was
 * presented this turn; town-wide confrontation state) and are the caller's
 * job to fold into a `DisclosureGateContext` alongside this function's
 * output, via `{...loaded, isRelevantToRequest, verifiedCluePresentedThisAction,
 * confrontationGateOpen}`.
 */
export async function loadDisclosureSources(
  params: LoadDisclosureSourcesParams,
): Promise<LoadedDisclosureInputs> {
  const { pool, townId, npcId, npcKey, playerId } = params;
  const rows = disclosureRowsForNpc(npcKey);
  const normalizedKeys = claimNormalizedKeys();
  const neededNormalizedKeys = [
    ...new Set(
      rows
        .map((row) => normalizedKeys.get(row.claimKey))
        .filter((key): key is string => key !== undefined),
    ),
  ];

  const [claimIdByNormalizedKey, relationship, everBrokenPromiseToThisNpc] =
    await Promise.all([
      readClaimIdsByNormalizedKeys(pool, townId, neededNormalizedKeys),
      readRelationshipScores(pool, townId, npcId, playerId),
      hasEverBrokenPromiseToNpc(pool, townId, npcId, playerId),
    ]);

  const claimIdByClaimKey = new Map<string, string>();
  for (const row of rows) {
    const normalizedKey = normalizedKeys.get(row.claimKey);
    const claimId =
      normalizedKey === undefined
        ? undefined
        : claimIdByNormalizedKey.get(normalizedKey);
    if (claimId !== undefined) claimIdByClaimKey.set(row.claimKey, claimId);
  }
  const claimIds = [...new Set(claimIdByClaimKey.values())];

  const [groundingEpisodes, receivedTransmissions, beliefRows, contradictingByClaimId] =
    await Promise.all([
      readGroundingEpisodes(pool, townId, npcId, claimIds),
      readReceivedTransmissions(pool, townId, npcId, claimIds),
      readNpcBeliefs(pool, townId, npcId, claimIds),
      Promise.all(
        claimIds.map(
          async (claimId) =>
            [
              claimId,
              await readContradictingClaimScores(pool, townId, npcId, claimId),
            ] as const,
        ),
      ).then((entries) => new Map(entries)),
    ]);

  const beliefByClaimId = new Map<string, ClaimBeliefState>(
    claimIds.map((claimId) => [
      claimId,
      {
        score: beliefRows.get(claimId)?.score ?? 0,
        contradictingScores: contradictingByClaimId.get(claimId) ?? [],
      },
    ]),
  );

  const sources: ResolvedDisclosureSource[] = [];
  for (const row of rows) {
    const claimId = claimIdByClaimKey.get(row.claimKey);
    if (claimId === undefined) continue;

    const grounding = groundingEpisodes.get(claimId);
    let resolvedGrounding: DisclosureGrounding;
    if (grounding === undefined) {
      resolvedGrounding = undefined;
    } else if (grounding.episodeKind === "direct_observation") {
      resolvedGrounding = {
        kind: "direct_observation",
        episodeId: grounding.episodeId,
      };
    } else {
      // A `heard_claim` episode with no matching received transmission is a
      // data-integrity gap that should not occur for `BELL_MYSTERY_V1`'s
      // seed (every `heard_claim` episode is paired with a real
      // `claim_transmissions` row, confirmed against `content/seed.ts`).
      // Degrading to `undefined` (disclosed as an unsourced "believed" row,
      // not excluded outright) rather than fabricating a transmission ID is
      // the safer of two imperfect choices.
      const transmission = receivedTransmissions.get(claimId);
      resolvedGrounding =
        transmission === undefined
          ? undefined
          : {
              kind: "heard_claim",
              episodeId: grounding.episodeId,
              parentTransmissionId: transmission.transmissionId,
            };
    }

    sources.push({
      claimKey: row.claimKey,
      claimId,
      tier: row.tier,
      grounding: resolvedGrounding,
      permittedEntityIds: [],
    });
  }

  return {
    sources,
    relationship: {
      trust: relationship.trustScore,
      suspicion: relationship.suspicionScore,
    },
    everBrokenPromiseToThisNpc,
    beliefByClaimId,
  };
}
