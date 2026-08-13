/**
 * `NpcContextBuilder`'s pure disclosure-bundle core (`P4-09`, part 1): turns
 * one NPC's already-resolved belief/relationship/promise/transmission state
 * into an `ApprovedDisclosureBundle`. No database access — `context.ts`'s
 * DB-orchestrating half (the five `persistence/{npc-state,beliefs,
 * relationships,promises,board}.ts` reads -> this function's inputs, then
 * on to `model-runtime#assembleDialogueContext`) is a later slice of this
 * same task; this is the formula boundary, matching `application/npc/
 * recall.ts`'s own pure/impure split from `P4-08`.
 */

import {
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
