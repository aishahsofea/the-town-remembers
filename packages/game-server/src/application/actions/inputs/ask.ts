/**
 * Ask's narrow Observe -> Recall -> Decide -> Select -> Persist composition.
 * External model calls are injected so the loader and handler can be tested
 * without a network; the production Bedrock implementation lives beside the
 * other model-runtime adapters.
 */

import { asVector256, type Vector256 } from "@the-town-remembers/database";
import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";
import {
  AskQuestionSchema,
  type ActionResultByKind,
} from "@the-town-remembers/http-contracts";
import type { AssembledDialogueContext } from "@the-town-remembers/model-runtime";
import {
  applyAskSelection,
  buildAskPromiseOffers,
  isConfrontationGateOpen,
  planAsk,
  type AskDialogueSelection,
  type AskInputs,
  type AskPromiseOfferState,
  type DirectnessCategory,
  type ExternalSelectionRequired,
  type ParentTransmissionProvenance,
  type ReasonCode,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import { recordRecallCandidates } from "../../../observability/metrics.js";
import {
  readTransmissionProvenance,
  type TransmissionProvenanceRow,
} from "../../../persistence/board.js";
import {
  isCoLocated,
  readActiveVisitLocation,
  readNpcSnapshot,
  type NpcSnapshot,
} from "../../../persistence/npc-state.js";
import {
  readRecallEpisodeDetails,
  readStructuredAnchorCandidates,
  readVectorCandidates,
  type RecallEpisodeDetail,
} from "../../../persistence/recall.js";
import {
  readAskPromiseOfferState,
  toPromiseKeys,
} from "../../../persistence/promises.js";
import { readConfrontationGateStatus } from "../../../persistence/view-queries.js";
import {
  buildDisclosureCandidates,
  buildNpcDialogueContext,
  loadDisclosureSources,
  type DisclosureGateContext,
  type ResolvedDisclosureSource,
} from "../../npc/context.js";
import { rankRecallCandidates } from "../../npc/recall.js";
import type { LoadInputsContext } from "../executor.js";
import type { ModelActionHandler, RunModelSelectionParams } from "../model-executor.js";

const VECTOR_CANDIDATE_LIMIT = 30;

export interface AskQueryEmbeddingParams {
  readonly townId: string;
  readonly actionId: string;
  readonly question: string;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
}

export interface AskDialogueSelectionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly npcKey: string;
  readonly assembled: AssembledDialogueContext;
  readonly pending: ExternalSelectionRequired;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
}

export interface AskActionDependencies {
  /** `undefined` is the explicit anchors-only embedding fallback. */
  embedQuery(params: AskQueryEmbeddingParams): Promise<Vector256 | undefined>;
  selectDialogue(params: AskDialogueSelectionParams): Promise<AskDialogueSelection>;
}

export interface AskLoadedInputs extends AskInputs {
  readonly townId: string;
  readonly actionId: string;
  readonly playerId: string;
  readonly question: string;
  readonly visitId: string | null;
  readonly npc: NpcSnapshot | undefined;
  readonly npcKey: string | null;
  readonly disclosureSources: readonly ResolvedDisclosureSource[];
  readonly disclosureGateContext: DisclosureGateContext;
  readonly parentTransmissionById: ReadonlyMap<string, ParentTransmissionProvenance>;
  readonly promiseOfferState: AskPromiseOfferState;
  readonly loadedAt: Date;
}

function directnessCategoryFor(detail: RecallEpisodeDetail): DirectnessCategory {
  switch (detail.episodeKind) {
    case "heard_claim":
      return detail.heardHopCount === 0
        ? "hop0_original_testimony"
        : "hop1_plus_hearsay";
    case "player_interaction":
      return "ordinary_interaction_without_claim";
    case "direct_observation":
    case "promise_consequence":
    case "item_transfer":
    case "world_consequence":
      return "direct_observation_or_item_or_promise_or_consequence";
  }
}

function parentMap(
  rows: ReadonlyMap<string, TransmissionProvenanceRow>,
): ReadonlyMap<string, ParentTransmissionProvenance> {
  return new Map(
    [...rows].map(([id, row]) => [
      id,
      { rootTransmissionId: row.rootTransmissionId, hopCount: row.hopCount },
    ]),
  );
}

function emptyGateContext(): DisclosureGateContext {
  return {
    isRelevantToRequest: () => false,
    trust: 0,
    suspicion: 0,
    verifiedCluePresentedThisAction: false,
    everBrokenPromiseToThisNpc: false,
    confrontationGateOpen: false,
    beliefByClaimId: new Map(),
  };
}

function emptyPromiseOfferState(npcKey: string): AskPromiseOfferState {
  return {
    npcKey,
    trust: 0,
    suspicion: 0,
    bellRevealed: false,
    activePromises: [],
    oldChapelKey: undefined,
    larkDamageClaim: undefined,
  };
}

async function loadAuthorizedAskInputs(
  pool: Pool,
  context: LoadInputsContext,
  dependencies: AskActionDependencies,
  question: string,
  npc: NpcSnapshot,
  visit: NonNullable<Awaited<ReturnType<typeof readActiveVisitLocation>>>,
): Promise<AskLoadedInputs> {
  const [embedding, anchors, loadedDisclosure, confrontation] = await Promise.all([
    dependencies.embedQuery({
      townId: context.townId,
      actionId: context.actionId,
      question,
      deadlineAt: context.deadlineAt,
      attempt: context.attempt,
      now: context.now,
    }),
    readStructuredAnchorCandidates(pool, context.townId, npc.npcId),
    loadDisclosureSources({
      pool,
      townId: context.townId,
      npcId: npc.npcId,
      npcKey: npc.characterKey,
      playerId: context.playerId,
    }),
    readConfrontationGateStatus(pool, context.townId),
  ]);
  const vectorRows =
    embedding === undefined
      ? []
      : await readVectorCandidates(
          pool,
          context.townId,
          npc.npcId,
          asVector256(embedding),
          VECTOR_CANDIDATE_LIMIT,
        );
  const candidateIds = [
    ...new Set([
      ...anchors.map((candidate) => candidate.episodeId),
      ...vectorRows.map((candidate) => candidate.episodeId),
    ]),
  ];
  const details = await readRecallEpisodeDetails(
    pool,
    context.townId,
    npc.npcId,
    context.playerId,
    candidateIds,
  );
  const distanceByEpisodeId = new Map(
    vectorRows.map((candidate) => [candidate.episodeId, candidate.distance]),
  );
  const anchorIds = new Set(anchors.map((candidate) => candidate.episodeId));
  const candidates = details.map((detail) => ({
    episodeId: detail.episodeId,
    occurredAt: detail.occurredAt,
    storedImportance: detail.importance,
    directnessCategory: directnessCategoryFor(detail),
    isCommitmentOrGrievance: detail.isCommitmentOrGrievance,
    isInActiveContradiction: detail.isInActiveContradiction,
    ...(distanceByEpisodeId.has(detail.episodeId)
      ? { distance: distanceByEpisodeId.get(detail.episodeId)! }
      : {}),
  }));
  const ranked = rankRecallCandidates(
    candidates.filter((candidate) => candidate.distance !== undefined),
    candidates.filter((candidate) => anchorIds.has(candidate.episodeId)),
    { embeddingAvailable: embedding !== undefined, now: context.now },
  );
  recordRecallCandidates({
    vectorCandidateCount: vectorRows.length,
    anchorCandidateCount: anchors.length,
    rankedCandidateCount: ranked.length,
    embeddingAvailable: embedding !== undefined,
  });
  // Anchors keep recall operational when Titan is unavailable, but they do
  // not prove that this particular question is relevant to a claim. Only a
  // positive query-vector match may open the public relevance gate.
  const queryRelevantEpisodeIds = new Set(
    ranked
      .filter(
        (candidate) =>
          candidate.provenance.fromVectorSearch && candidate.similarity > 0,
      )
      .map((candidate) => candidate.episodeId),
  );
  const relevantClaimIds = new Set(
    details
      .filter((detail) => queryRelevantEpisodeIds.has(detail.episodeId))
      .flatMap((detail) => detail.claimIds),
  );
  const relevantClaimKeys = new Set(
    loadedDisclosure.sources
      .filter(
        (source) =>
          relevantClaimIds.has(source.claimId) ||
          (source.grounding !== undefined &&
            queryRelevantEpisodeIds.has(source.grounding.episodeId)),
      )
      .map((source) => source.claimKey),
  );
  const gateContext: DisclosureGateContext = {
    isRelevantToRequest: (claimKey) => relevantClaimKeys.has(claimKey),
    trust: loadedDisclosure.relationship.trust,
    suspicion: loadedDisclosure.relationship.suspicion,
    verifiedCluePresentedThisAction: false,
    everBrokenPromiseToThisNpc: loadedDisclosure.everBrokenPromiseToThisNpc,
    confrontationGateOpen: isConfrontationGateOpen(confrontation),
    beliefByClaimId: loadedDisclosure.beliefByClaimId,
  };
  const disclosureCandidates = buildDisclosureCandidates({
    sources: loadedDisclosure.sources,
    content: BELL_MYSTERY_V1,
    gateContext,
  });
  const parentIds = [
    ...new Set(
      loadedDisclosure.sources.flatMap((source) =>
        source.grounding?.kind === "heard_claim"
          ? [source.grounding.parentTransmissionId]
          : [],
      ),
    ),
  ];
  const larkDamageSource = loadedDisclosure.sources.find(
    (source) => source.claimKey === "lark_damaged_bell",
  );
  const [provenance, offerReadState] = await Promise.all([
    readTransmissionProvenance(pool, context.townId, parentIds),
    readAskPromiseOfferState(
      pool,
      context.townId,
      npc.npcId,
      context.playerId,
      larkDamageSource?.claimId,
    ),
  ]);
  const larkDamageClaim = BELL_MYSTERY_V1.claims.find(
    (claim) => claim.claimKey === "lark_damaged_bell",
  );

  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    question,
    visitId: visit.visitId,
    npc,
    npcKey: npc.characterKey,
    npcPresent: true,
    disclosureSources: loadedDisclosure.sources,
    disclosureGateContext: gateContext,
    parentTransmissionById: parentMap(provenance),
    promiseOfferState: {
      npcKey: npc.characterKey,
      trust: loadedDisclosure.relationship.trust,
      suspicion: loadedDisclosure.relationship.suspicion,
      bellRevealed: confrontation.bellRevealed,
      activePromises: toPromiseKeys(npc.npcId, offerReadState.activePromises),
      oldChapelKey: offerReadState.oldChapelKey,
      larkDamageClaim:
        larkDamageSource === undefined || larkDamageClaim === undefined
          ? undefined
          : {
              claimId: larkDamageSource.claimId,
              text: larkDamageClaim.sentence,
              previouslyDisclosedToPlayer: offerReadState.larkDamagePreviouslyDisclosed,
            },
    },
    disclosureCandidates,
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
    loadedAt: context.now,
  };
}

export async function loadAskInputs(
  pool: Pool,
  context: LoadInputsContext,
  dependencies: AskActionDependencies,
): Promise<AskLoadedInputs> {
  const question = AskQuestionSchema.parse(context.requestPayload["question"]);
  const npcId = context.requestPayload["npcId"] as string;
  const [npc, visit] = await Promise.all([
    readNpcSnapshot(pool, context.townId, npcId),
    readActiveVisitLocation(pool, context.townId, context.playerId),
  ]);

  if (!isCoLocated(visit, npc) || npc === undefined || visit === undefined) {
    return {
      townId: context.townId,
      actionId: context.actionId,
      playerId: context.playerId,
      question,
      visitId: visit?.visitId ?? null,
      npc,
      npcKey: npc?.characterKey ?? null,
      npcPresent: false,
      disclosureSources: [],
      disclosureGateContext: emptyGateContext(),
      parentTransmissionById: new Map(),
      promiseOfferState: emptyPromiseOfferState(npc?.characterKey ?? ""),
      disclosureCandidates: [],
      requiredDisclosureIds: [],
      approvedOutcomes: [],
      requiredOutcomeIds: [],
      approvedEpisodes: [],
      loadedAt: context.now,
    };
  }

  return loadAuthorizedAskInputs(pool, context, dependencies, question, npc, visit);
}

const ASK_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  NPC_NOT_PRESENT: "That person is not here to answer.",
};

export function createAskActionHandler(
  dependencies: AskActionDependencies,
): ModelActionHandler<"ask", AskLoadedInputs, AskDialogueSelection> {
  return {
    kind: "ask",
    loadInputs: (pool, context) => loadAskInputs(pool, context, dependencies),
    plan: planAsk,
    async runModelSelection(
      params: RunModelSelectionParams<AskLoadedInputs>,
    ): Promise<AskDialogueSelection> {
      const { inputs, pending } = params;
      if (inputs.npc === undefined || inputs.npcKey === null) throw internalError();
      const hasDisclosure = pending.trustedContext.approvedDisclosures.length > 0;
      const assembled = buildNpcDialogueContext({
        npcKey: inputs.npcKey,
        npcId: inputs.npc.npcId,
        currentLocationId: inputs.npc.locationEntityId,
        disclosureSources: inputs.disclosureSources,
        content: BELL_MYSTERY_V1,
        disclosureGateContext: inputs.disclosureGateContext,
        disclosureBundle: pending.trustedContext,
        playerAction: {
          actionKind: "ask",
          targetEntityIds: [inputs.npc.characterEntityId],
        },
        dialogueDirective: {
          requiredAct: hasDisclosure
            ? "Answer the player's question from approved disclosures."
            : "Deflect without adding any disclosure.",
        },
        allowedResponseKinds: hasDisclosure ? ["answer"] : ["deflect"],
        canonicalEntities: [],
        approvedActors: [],
        untrustedPlayerText: inputs.question,
      });
      return dependencies.selectDialogue({
        townId: inputs.townId,
        actionId: inputs.actionId,
        npcKey: inputs.npcKey,
        assembled,
        pending,
        deadlineAt: params.deadlineAt,
        attempt: params.attempt,
        now: inputs.loadedAt,
      });
    },
    applySelection(inputs, _pending, selection) {
      if (inputs.npc === undefined || inputs.visitId === null) return [];
      return applyAskSelection({
        actionId: inputs.actionId,
        visitId: inputs.visitId,
        playerId: inputs.playerId,
        npcId: inputs.npc.npcId,
        npcCharacterEntityId: inputs.npc.characterEntityId,
        locationEntityId: inputs.npc.locationEntityId,
        question: inputs.question,
        occurredAt: inputs.loadedAt,
        selection,
        parentTransmissionById: inputs.parentTransmissionById,
      });
    },
    buildResult(inputs, _effects, _insertIds, selection) {
      if (selection === undefined) throw internalError();
      return {
        dialogue: {
          npcId: selection.npcId,
          text: selection.text,
          responseMode: selection.responseMode,
        },
        promiseOffers: buildAskPromiseOffers(
          inputs.actionId,
          selection.npcId,
          inputs.promiseOfferState,
          selection,
        ),
      } satisfies ActionResultByKind["ask"];
    },
    reasonMessage: (code) =>
      ASK_DENIAL_MESSAGES[code] ?? "That question cannot be answered right now.",
    resolveVisitId: (inputs) => inputs.visitId,
    eventMetadata: (inputs) => ({
      actorId: inputs.playerId,
      targetActorId: inputs.npc?.npcId ?? null,
      locationEntityId: inputs.npc?.locationEntityId ?? null,
    }),
  };
}

/** Resolves the request target before `player_actions.target_actor_id` is written. */
export async function resolveAskTarget(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<string | null> {
  return (await readNpcSnapshot(pool, townId, npcId))?.npcId ?? null;
}
