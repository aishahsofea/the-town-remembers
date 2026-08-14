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
  CHARACTERS,
  claimNormalizedKeys,
  CONFESSION_TEMPLATES,
  DENIAL_TEMPLATES,
  DISCLOSURE_TEMPLATES,
  DISCLOSURE_TIER_TABLE,
  NPC_DIALOGUE_PROFILES,
  OUTCOME_TEMPLATES,
  type ContentRegistry,
  type DisclosureTierBinding,
} from "@the-town-remembers/content";
import {
  assembleDialogueContext,
  authoredTemplateText,
  playerSafeText,
  type ApprovedActorInput,
  type AssembledDialogueContext,
  type CanonicalNamedEntityInput,
  type DialogueDirectiveInput,
  type NpcProfileInput,
  type PlayerActionInput,
  type RenderingCandidateInput,
} from "@the-town-remembers/model-runtime";
import {
  buildApprovedDisclosureBundle,
  isAuthoredCoverStory,
  meetsDisclosureTier,
  stanceFor as relationshipStanceForScores,
  type ApprovedDisclosureBundle,
  type ApprovedEpisodeSummary,
  type ApprovedOutcome,
  type ClaimStance,
  type DisclosureCandidateInput,
  type DisclosureGateInputs,
  type DisclosureTier,
  type GateResult,
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
function gateInputsFor(
  source: ResolvedDisclosureSource,
  content: ContentRegistry,
  context: DisclosureGateContext,
): DisclosureGateInputs {
  return {
    isRelevantToRequest: context.isRelevantToRequest(source.claimKey),
    trust: context.trust,
    suspicion: context.suspicion,
    verifiedCluePresentedThisAction: context.verifiedCluePresentedThisAction,
    everBrokenPromiseToThisNpc: context.everBrokenPromiseToThisNpc,
    isCorinsCoverStoryClaim: isAuthoredCoverStory(source.claimKey, content),
    confrontationGateOpen: context.confrontationGateOpen,
  };
}

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
    gateInputs: gateInputsFor(source, content, context),
    beliefScore: belief?.score ?? 0,
    contradictingClaimScores: belief?.contradictingScores ?? [],
    permittedEntityIds: source.permittedEntityIds,
  };
}

/** Mirrors `disclosure/tiers.ts#DisclosureTier`'s declared union order, least to most restricted — there is no exported runtime array for it in `rules`. */
const DISCLOSURE_TIER_ORDER: readonly DisclosureTier[] = [
  "public",
  "guarded",
  "confidential",
  "cover_story",
  "final_truth",
];

/**
 * `DISCLOSURE_TIER_TABLE` sometimes authors more than one tier for the same
 * (npc, claim) pair — e.g. Mara's `corin_protected_lark` has both a
 * `guarded` framing ("an incomplete offer of help") and a `confidential`
 * framing (the fuller protection motive). `rules#buildApprovedDisclosureBundle`
 * assumes at most one `ApprovedDisclosure` per claim ID
 * (`model-runtime#assignDisclosureIds` throws `DuplicateBundleKeyError`
 * otherwise, since `D4-H`'s ephemeral id space is keyed by claim ID) — so
 * when two or more authored tiers for the same claim would *simultaneously*
 * pass their gate, only the single most-revealing (highest-tier) one is
 * kept; the rest are dropped before ever reaching
 * `buildApprovedDisclosureBundle`. A claim with only one row, or whose
 * extra rows don't all pass, is unaffected — `buildApprovedDisclosureBundle`
 * already filters a non-passing row out on its own.
 */
function selectOnePassingTierPerClaim(
  sources: readonly ResolvedDisclosureSource[],
  content: ContentRegistry,
  context: DisclosureGateContext,
): readonly ResolvedDisclosureSource[] {
  const byClaimId = new Map<string, ResolvedDisclosureSource[]>();
  for (const source of sources) {
    const existing = byClaimId.get(source.claimId) ?? [];
    existing.push(source);
    byClaimId.set(source.claimId, existing);
  }

  const result: ResolvedDisclosureSource[] = [];
  for (const group of byClaimId.values()) {
    if (group.length === 1) {
      result.push(...group);
      continue;
    }
    const passing = group.filter((source) =>
      meetsDisclosureTier(source.tier, gateInputsFor(source, content, context)),
    );
    if (passing.length <= 1) {
      result.push(...group);
      continue;
    }
    const [highest] = passing.toSorted(
      (left, right) =>
        DISCLOSURE_TIER_ORDER.indexOf(right.tier) -
        DISCLOSURE_TIER_ORDER.indexOf(left.tier),
    );
    result.push(highest!);
  }
  return result;
}

export interface DisclosureCandidateParams {
  readonly sources: readonly ResolvedDisclosureSource[];
  readonly content: ContentRegistry;
  readonly gateContext: DisclosureGateContext;
}

/**
 * Resolves one NPC's authored disclosure sources into the
 * `DisclosureCandidateInput[]` a `rules/actions/model-backed.ts` planner's
 * `XInputs.disclosureCandidates` needs (e.g. `AskInputs extends
 * DisclosureBundleInputs`) — the real production path: a model-backed
 * action's own input loader (`P4-11`'s `ask`, etc.) calls this, then hands
 * the result to `planAsk`/`planShow`/etc., which does its own authority
 * checks (`npcPresent`, draft state, ...) *before* building the
 * `ApprovedDisclosureBundle` a caller eventually gets back via
 * `ExternalSelectionRequired.trustedContext`. The dedup step
 * (`selectOnePassingTierPerClaim`) has to happen here, not only inside
 * `buildDisclosureBundleForNpc` below — a duplicate-claim crash in
 * `assembleDialogueContext` would happen identically whether the bundle
 * was built by a real planner or by this module directly.
 */
export function buildDisclosureCandidates(
  params: DisclosureCandidateParams,
): readonly DisclosureCandidateInput[] {
  const dedupedSources = selectOnePassingTierPerClaim(
    params.sources,
    params.content,
    params.gateContext,
  );
  return dedupedSources.map((source) =>
    buildCandidate(source, params.content, params.gateContext),
  );
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
 * Builds the `ApprovedDisclosureBundle` for one NPC directly from its
 * authored disclosure-tier rows — the mechanism that makes "Mara's bundle
 * never contains the chapel location" true by construction: Mara's own
 * rows in `DISCLOSURE_TIER_TABLE` never name a `final_truth` claim, so no
 * gate evaluation could ever approve one for her regardless of trust,
 * belief, or confrontation-gate state. The same holds for Nessa and the
 * cart's load, and for Corin's `final_truth` rows against the
 * confrontation gate.
 *
 * **Not the real production path for a model-backed action** — a real
 * `ask`/`show`/etc. goes through its `rules/actions/model-backed.ts`
 * planner (via `buildDisclosureCandidates` above), whose own
 * `ExternalSelectionRequired.trustedContext` is the authoritative bundle
 * (it alone reflects the planner's own authority/gate denials). This
 * function computes the mathematically identical bundle a planner would
 * from the same candidates — kept as a direct, plannerless entry point for
 * regression-testing the disclosure-tier/safety invariants themselves
 * (see `context.test.ts`) and for `buildNpcDialogueContext`'s convenience
 * overload below, not because production code should prefer it over a
 * real planner's result.
 */
export function buildDisclosureBundleForNpc(
  params: BuildDisclosureBundleParams,
): ApprovedDisclosureBundle {
  const candidates = buildDisclosureCandidates(params);
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

// --- Rendering candidates ----------------------------------------------------

function toCandidate(
  templateKey: string,
  text: string,
  responseKind: string,
  disclosureClaimKeys: readonly string[],
  outcomeKeys: readonly string[],
  styleTags: readonly string[],
): RenderingCandidateInput {
  // Every template in `content/dialogue/templates.ts`/`outcomes.ts`/
  // `fallbacks.ts` is closed, hardcoded prose with no placeholder grammar
  // (that module's own header comment) — no template ever needs to bind a
  // specific episode, entity, or actor id, so these three are always empty.
  return {
    templateKey,
    text: authoredTemplateText(text),
    responseKind,
    disclosureClaimKeys,
    outcomeKeys,
    episodeKeys: [],
    entityIds: [],
    actorIds: [],
    styleTags,
  };
}

/**
 * Every rendering candidate this NPC's authored corpus offers for the
 * current bundle: a disclosure/confession template for each claim (or, for
 * Corin's confession, claim *set*) the bundle actually approved, an outcome
 * template for each outcome the bundle actually approved, and a denial
 * template for the resolved `gateResult`. Candidates whose claims/outcomes
 * were not approved are never offered — `assembleDialogueContext` would
 * reject them anyway (`unapproved_entity_id`-style errors from
 * `renderings.ts`), but filtering here keeps the candidate set itself
 * honest about what this bundle actually supports.
 *
 * `approvedClaimIdByKey` maps the content-authored `claimKey` (what
 * templates are keyed by) to the real claim ID (`ApprovedDisclosure.claimId`,
 * what `assembleDialogueContext`'s `disclosureClaimKeys` must actually
 * contain — `D4-H`'s ephemeral disclosure ids are assigned over real claim
 * IDs, never over content string keys, so passing the string key itself
 * here would fail translation with an "unknown key" error).
 */
export function buildRenderingCandidatesForNpc(
  npcKey: string,
  approvedClaimIdByKey: ReadonlyMap<string, string>,
  approvedOutcomeKinds: ReadonlySet<string>,
  gateResult: GateResult,
): readonly RenderingCandidateInput[] {
  const candidates: RenderingCandidateInput[] = [];

  for (const template of DISCLOSURE_TEMPLATES) {
    if (template.npcKey !== npcKey) continue;
    const claimId = approvedClaimIdByKey.get(template.claimKey);
    if (claimId === undefined) continue;
    candidates.push(
      toCandidate(
        template.templateKey,
        template.text,
        template.responseKind,
        [claimId],
        [],
        template.styleTags,
      ),
    );
  }

  for (const template of CONFESSION_TEMPLATES) {
    if (template.npcKey !== npcKey) continue;
    const claimIds = template.claimKeys.map((claimKey) =>
      approvedClaimIdByKey.get(claimKey),
    );
    if (!claimIds.every((claimId): claimId is string => claimId !== undefined))
      continue;
    candidates.push(
      toCandidate(
        template.templateKey,
        template.text,
        template.responseKind,
        claimIds,
        [],
        template.styleTags,
      ),
    );
  }

  for (const template of OUTCOME_TEMPLATES) {
    if (template.npcKey !== npcKey) continue;
    if (!approvedOutcomeKinds.has(template.outcomeKind)) continue;
    candidates.push(
      toCandidate(
        template.templateKey,
        template.text,
        template.responseKind,
        [],
        [template.outcomeKind],
        template.styleTags,
      ),
    );
  }

  for (const template of DENIAL_TEMPLATES) {
    if (template.npcKey !== npcKey) continue;
    if (template.gateResult !== gateResult) continue;
    candidates.push(
      toCandidate(
        template.templateKey,
        template.text,
        template.responseKind,
        [],
        [],
        template.styleTags,
      ),
    );
  }

  return candidates;
}

// --- Gate result --------------------------------------------------------------

/**
 * The default `dialogue_directive.gate_result` for an action with no
 * bespoke access/custody/promise/draft gate of its own (`ask` is the only
 * one today — `show`/`give`/`accept_promise`/`tell`/`normalize_claim` each
 * compute their own denial via `rules/actions/model-backed.ts`'s existing
 * planners and must pass that resolved `GateResult` in directly rather than
 * calling this). **This is a first-pass, deliberately narrow rule, not a
 * full resolution of `D4-K`'s nine-value domain** — it only distinguishes
 * "the bundle has nothing to say" from "the bundle has something to say";
 * it cannot produce `denied_disclosure_tier`/`denied_belief` for a bundle
 * that approved *some* claims but denied the specific one the player asked
 * about, because this function never sees which claim was asked about.
 * Revisit once `P4-11`'s `ask` input actually needs that distinction.
 */
export function defaultGateResult(bundle: ApprovedDisclosureBundle): GateResult {
  const hasAnything =
    bundle.approvedDisclosures.length > 0 ||
    bundle.approvedOutcomes.length > 0 ||
    bundle.approvedEpisodes.length > 0;
  return hasAnything ? "passed" : "no_disclosure_available";
}

// --- Full assembly ------------------------------------------------------------

/**
 * `npc_profile`: display name from `content#CHARACTERS`, voice rules from
 * `content#NPC_DIALOGUE_PROFILES` — both the authored "Voice" bullets and
 * the "Never-do" bullets, since the wire schema (`model-contracts#
 * NpcProfileInputSchema`) has only one `voice_rules` array, not a separate
 * slot for either `coreWant` or the never-do list. `coreWant` itself has no
 * wire slot at all and is not sent — it's authorial context for whoever
 * writes new voice rules, not a runtime instruction.
 */
function npcProfileFor(
  npcKey: string,
  npcId: string,
  currentLocationId: string,
): NpcProfileInput {
  const profile = NPC_DIALOGUE_PROFILES.find(
    (candidate) => candidate.npcKey === npcKey,
  );
  if (profile === undefined) {
    throw new Error(`No authored dialogue profile for NPC "${npcKey}"`);
  }
  const character = CHARACTERS.find((entity) => entity.entityKey === npcKey);
  if (character === undefined) {
    throw new Error(`No authored character entity for NPC "${npcKey}"`);
  }
  return {
    npcId,
    displayName: playerSafeText(character.displayName),
    voiceRules: [
      ...profile.voiceRules,
      ...profile.neverDoRules.map(
        (rule) => `Never ${rule[0]?.toLowerCase()}${rule.slice(1)}`,
      ),
    ].map(playerSafeText),
    currentLocationId,
  };
}

export interface BuildNpcDialogueContextParams {
  readonly npcKey: string;
  readonly npcId: string;
  readonly currentLocationId: string;
  readonly disclosureSources: readonly ResolvedDisclosureSource[];
  readonly content: ContentRegistry;
  readonly disclosureGateContext: DisclosureGateContext;
  /**
   * The real production path: a model-backed action's planner
   * (`rules/actions/model-backed.ts#planAsk` etc.) already built this
   * bundle from `buildDisclosureCandidates`'s output as part of its own
   * authority/gate checks — pass its `ExternalSelectionRequired.trustedContext`
   * straight through rather than letting this function rebuild an
   * equivalent bundle from `disclosureSources` a second time. Omit only
   * when there is no real planner in the loop (a direct test, or a future
   * action with no `rules` planner of its own), in which case this
   * function falls back to `buildDisclosureBundleForNpc` using
   * `disclosureSources`/`content`/`disclosureGateContext` and the four
   * bundle-limit fields below.
   */
  readonly disclosureBundle?: ApprovedDisclosureBundle;
  readonly requiredDisclosureIds?: readonly string[];
  readonly approvedOutcomes?: readonly ApprovedOutcome[];
  readonly requiredOutcomeIds?: readonly string[];
  readonly approvedEpisodes?: readonly ApprovedEpisodeSummary[];
  readonly playerAction: PlayerActionInput;
  /** `gateResult` omitted -> derived by `defaultGateResult`; supply it when the caller's own action already computed a bespoke denial (`show`/`give`/`accept_promise`/`tell`/`normalize_claim`). */
  readonly dialogueDirective: {
    readonly requiredAct: string;
    readonly gateResult?: GateResult;
  };
  readonly allowedResponseKinds: readonly string[];
  readonly canonicalEntities: readonly CanonicalNamedEntityInput[];
  readonly approvedActors: readonly ApprovedActorInput[];
  readonly untrustedPlayerText?: string;
}

/**
 * The full `NpcContextBuilder` assembly: disclosure bundle ->
 * rendering candidates -> `model-runtime#assembleDialogueContext`. The
 * action-specific pieces (`playerAction`, `dialogueDirective.requiredAct`,
 * `allowedResponseKinds`, `canonicalEntities`, `approvedActors`,
 * `disclosureGateContext.isRelevantToRequest`) are supplied by the caller
 * rather than derived here — deriving "which claims are relevant to this
 * request" needs the specific action's own query (`P4-11`'s `ask`, for a
 * question; a fixed set for `show`/`give`), which this builder has no way
 * to know in general. This function is the reusable core every
 * model-backed action composes, not a replacement for their own input
 * modules.
 */
export function buildNpcDialogueContext(
  params: BuildNpcDialogueContextParams,
): AssembledDialogueContext {
  const bundle =
    params.disclosureBundle ??
    buildDisclosureBundleForNpc({
      sources: params.disclosureSources,
      content: params.content,
      gateContext: params.disclosureGateContext,
      ...(params.requiredDisclosureIds === undefined
        ? {}
        : { requiredDisclosureIds: params.requiredDisclosureIds }),
      ...(params.approvedOutcomes === undefined
        ? {}
        : { approvedOutcomes: params.approvedOutcomes }),
      ...(params.requiredOutcomeIds === undefined
        ? {}
        : { requiredOutcomeIds: params.requiredOutcomeIds }),
      ...(params.approvedEpisodes === undefined
        ? {}
        : { approvedEpisodes: params.approvedEpisodes }),
    });

  const gateResult = params.dialogueDirective.gateResult ?? defaultGateResult(bundle);

  const approvedClaimIds = new Set(
    bundle.approvedDisclosures.map((disclosure) => disclosure.claimId),
  );
  const approvedClaimIdByKey = new Map(
    params.disclosureSources
      .filter((source) => approvedClaimIds.has(source.claimId))
      .map((source) => [source.claimKey, source.claimId] as const),
  );
  const approvedOutcomeKinds = new Set(
    bundle.approvedOutcomes.map((outcome) => outcome.outcomeId),
  );

  const renderingCandidates = buildRenderingCandidatesForNpc(
    params.npcKey,
    approvedClaimIdByKey,
    approvedOutcomeKinds,
    gateResult,
  );

  return assembleDialogueContext({
    disclosureBundle: bundle,
    npcProfile: npcProfileFor(params.npcKey, params.npcId, params.currentLocationId),
    playerAction: params.playerAction,
    relationshipStance: playerSafeText(
      relationshipStanceForScores(
        params.disclosureGateContext.trust,
        params.disclosureGateContext.suspicion,
      ),
    ),
    dialogueDirective: {
      requiredAct: params.dialogueDirective.requiredAct,
      gateResult,
    } satisfies DialogueDirectiveInput,
    allowedResponseKinds: params.allowedResponseKinds,
    renderingCandidates,
    canonicalEntities: params.canonicalEntities,
    approvedActors: params.approvedActors,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrustedPlayerText: params.untrustedPlayerText }),
  });
}
