/**
 * `tell`'s narrow Observe -> Decide -> Select -> Persist composition
 * (`P4-13`). Unlike `ask`, the claim being communicated is already fully
 * determined by the confirmed draft before any model call — the model is
 * consulted only for the NPC's own reactive dialogue, never for the claim
 * mechanics themselves. `applyTellSelection` (`rules/actions/selection.ts`)
 * builds the deterministic claim/transmission/episode/evidence/belief
 * effects; this loader's job is resolving exactly the database state that
 * pure function needs.
 */

import { BELL_MYSTERY_V1, renderClaimSentence } from "@the-town-remembers/content";
import { IdSchema, type ActionResultByKind } from "@the-town-remembers/http-contracts";
import type { AssembledDialogueContext } from "@the-town-remembers/model-runtime";
import {
  applyTellSelection,
  corroborationWeight,
  deterministicClaimRelation,
  isConfrontationGateOpen,
  mirrorWeightFor,
  planTell,
  playerTestimonyBase,
  sumEventContributions,
  testimonyWeight,
  type ExternalSelectionRequired,
  type ReasonCode,
  type TellClaimBeliefRow,
  type TellBackfillEvidence,
  type TellBrokenPromise,
  type TellClaimIdentity,
  type TellDialogueSelection,
  type TellRelatedClaim,
} from "@the-town-remembers/rules";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import {
  readActiveTestimonySources,
  readDeterministicRelationCandidates,
  readRelatedClaims,
  readTestimonySources,
  readUnreversedPrimarySupport,
} from "../../../persistence/claims.js";
import {
  readClaimIdsByNormalizedKeys,
  readNpcBeliefs,
} from "../../../persistence/beliefs.js";
import {
  readDraftForPlayer,
  resolveEntityKeysByIds,
  type ClaimDraftRow,
} from "../../../persistence/drafts.js";
import {
  isCoLocated,
  readActiveVisitLocation,
  readNpcSnapshot,
  type NpcSnapshot,
} from "../../../persistence/npc-state.js";
import { readConfrontationGateStatus } from "../../../persistence/view-queries.js";
import { readSecretPromisesBrokenByTell } from "../../../persistence/promises.js";
import { readRelationshipScores } from "../../../persistence/relationships.js";
import {
  buildNpcDialogueContext,
  loadDisclosureSources,
  type DisclosureGateContext,
  type ResolvedDisclosureSource,
} from "../../npc/context.js";
import type { LoadInputsContext } from "../executor.js";
import type { ModelActionHandler, RunModelSelectionParams } from "../model-executor.js";

export interface TellDialogueSelectionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly npcKey: string;
  readonly assembled: AssembledDialogueContext;
  readonly pending: ExternalSelectionRequired;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
}

export interface TellActionDependencies {
  selectDialogue(params: TellDialogueSelectionParams): Promise<TellDialogueSelection>;
}

export interface TellLoadedInputs {
  readonly townId: string;
  readonly actionId: string;
  readonly playerId: string;
  readonly draftId: string;
  readonly draft: ClaimDraftRow | undefined;
  readonly npc: NpcSnapshot | undefined;
  readonly npcKey: string | null;
  readonly visitId: string | null;
  readonly claimDraftExists: boolean;
  readonly claimDraftExpired: boolean;
  readonly claimDraftAlreadyConfirmed: boolean;
  readonly claimDraftWrongNpc: boolean;
  readonly disclosureCandidates: readonly [];
  readonly requiredDisclosureIds: readonly [];
  readonly approvedOutcomes: readonly [];
  readonly requiredOutcomeIds: readonly [];
  readonly approvedEpisodes: readonly [];
  readonly canonicalText: string;
  readonly claim: TellClaimIdentity | undefined;
  readonly playerTrust: number;
  readonly isRepeatContribution: boolean;
  readonly priorIndependentSourceCount: number;
  readonly newIndependentSourceCount: number;
  readonly relatedClaims: readonly TellRelatedClaim[];
  readonly newRelations: readonly TellRelatedClaim[];
  readonly backfillEvidence: readonly TellBackfillEvidence[];
  readonly beliefStates: readonly TellClaimBeliefRow[];
  readonly brokenPromises: readonly TellBrokenPromise[];
  readonly disclosureSources: readonly ResolvedDisclosureSource[];
  readonly disclosureGateContext: DisclosureGateContext;
  readonly loadedAt: Date;
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

function emptyLoadedInputs(
  context: LoadInputsContext,
  draftId: string,
  overrides: Partial<TellLoadedInputs>,
): TellLoadedInputs {
  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    draftId,
    draft: undefined,
    npc: undefined,
    npcKey: null,
    visitId: null,
    claimDraftExists: false,
    claimDraftExpired: false,
    claimDraftAlreadyConfirmed: false,
    claimDraftWrongNpc: false,
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
    canonicalText: "",
    claim: undefined,
    playerTrust: 0,
    isRepeatContribution: false,
    priorIndependentSourceCount: 0,
    newIndependentSourceCount: 0,
    relatedClaims: [],
    newRelations: [],
    backfillEvidence: [],
    beliefStates: [],
    brokenPromises: [],
    disclosureSources: [],
    disclosureGateContext: emptyGateContext(),
    loadedAt: context.now,
    ...overrides,
  };
}

function scoreOf(row: TellClaimBeliefRow | undefined): number {
  return row?.exists ? row.score : 0;
}

/**
 * The score `applyTellSelection` will actually write for one claim, computed
 * the identical way (existing score + this contribution, clamped once) so
 * the dialogue call's disclosure gate sees the state Tell is *about* to
 * produce rather than the stale pre-tell snapshot (`P4-13` acceptance 5).
 * Bounded to the primary claim and its directly related claims — the same
 * set `applyTellSelection` itself touches; a claim two hops away from the
 * primary is not re-derived.
 */
function predictedScore(existing: number, delta: number): number {
  return sumEventContributions(
    [
      { key: "x", delta: existing },
      { key: "x", delta },
    ],
    (contribution) => contribution.key,
    (contribution) => contribution.delta,
  ).get("x")!;
}

interface ClaimMechanics {
  readonly claim: TellClaimIdentity;
  readonly isRepeatContribution: boolean;
  readonly priorIndependentSourceCount: number;
  readonly newIndependentSourceCount: number;
  readonly relatedClaims: readonly TellRelatedClaim[];
  readonly newRelations: readonly TellRelatedClaim[];
  readonly backfillEvidence: readonly TellBackfillEvidence[];
  readonly beliefStates: readonly TellClaimBeliefRow[];
}

async function loadClaimMechanics(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
  draft: ClaimDraftRow,
): Promise<ClaimMechanics> {
  const claimIdByNormalizedKey = await readClaimIdsByNormalizedKeys(pool, townId, [
    draft.normalizedKey,
  ]);
  const existingClaimId = claimIdByNormalizedKey.get(draft.normalizedKey);
  const claim: TellClaimIdentity = {
    exists: existingClaimId !== undefined,
    claimId: existingClaimId,
    subjectEntityId: draft.subjectEntityId,
    subjectEntityType: draft.subjectEntityType,
    predicate: draft.predicate,
    objectEntityId: draft.objectEntityId,
    objectEntityType: draft.objectEntityType,
    polarity: draft.polarity,
    contextKey: draft.contextKey,
    normalizedKey: draft.normalizedKey,
  };

  if (existingClaimId === undefined) {
    const candidates = await readDeterministicRelationCandidates(
      pool,
      townId,
      draft.subjectEntityId,
      draft.predicate,
      draft.contextKey,
    );
    const newRelations: TellRelatedClaim[] = candidates.flatMap((candidate) => {
      const relationKind = deterministicClaimRelation(claim, candidate);
      return relationKind === undefined
        ? []
        : [{ claimId: candidate.claimId, relationKind }];
    });
    const relatedClaimIds = newRelations.map((related) => related.claimId);
    const [support, beliefRows] = await Promise.all([
      readUnreversedPrimarySupport(pool, townId, relatedClaimIds),
      readNpcBeliefs(pool, townId, npcId, relatedClaimIds),
    ]);
    return {
      claim,
      isRepeatContribution: false,
      priorIndependentSourceCount: 0,
      newIndependentSourceCount: 1,
      relatedClaims: newRelations,
      newRelations,
      backfillEvidence: support.map((row) => ({
        evidenceId: row.evidenceId,
        npcId: row.npcId,
        sourceClaimId: row.claimId,
        signedWeight: row.signedWeight,
      })),
      beliefStates: [...beliefRows.values()].map((row) => ({
        claimId: row.claimId,
        exists: true,
        score: row.score,
        revision: row.revision,
      })),
    };
  }

  const [activeSources, allSources, relatedClaims] = await Promise.all([
    readActiveTestimonySources(pool, townId, npcId, existingClaimId),
    readTestimonySources(pool, townId, npcId, existingClaimId),
    readRelatedClaims(pool, townId, existingClaimId),
  ]);
  const isRepeatContribution = allSources.includes(playerId);
  const priorIndependentSourceCount = new Set(activeSources).size;
  const newIndependentSourceCount = isRepeatContribution
    ? priorIndependentSourceCount
    : priorIndependentSourceCount + 1;

  const beliefRows = await readNpcBeliefs(pool, townId, npcId, [
    existingClaimId,
    ...relatedClaims.map((related) => related.claimId),
  ]);
  const beliefStates: TellClaimBeliefRow[] = [...beliefRows.values()].map((row) => ({
    claimId: row.claimId,
    exists: true,
    score: row.score,
    revision: row.revision,
  }));

  return {
    claim,
    isRepeatContribution,
    priorIndependentSourceCount,
    newIndependentSourceCount,
    relatedClaims,
    newRelations: [],
    backfillEvidence: [],
    beliefStates,
  };
}

async function loadPresentTellInputs(
  pool: Pool,
  context: LoadInputsContext,
  draftId: string,
  draft: ClaimDraftRow,
  npc: NpcSnapshot,
): Promise<TellLoadedInputs> {
  const [entityKeys, loadedDisclosure, confrontation, mechanics] = await Promise.all([
    resolveEntityKeysByIds(pool, context.townId, [
      draft.subjectEntityId,
      draft.objectEntityId,
    ]),
    loadDisclosureSources({
      pool,
      townId: context.townId,
      npcId: npc.npcId,
      npcKey: npc.characterKey,
      playerId: context.playerId,
    }),
    readConfrontationGateStatus(pool, context.townId),
    loadClaimMechanics(pool, context.townId, npc.npcId, context.playerId, draft),
  ]);

  const subjectKey = entityKeys.get(draft.subjectEntityId);
  const objectKey = entityKeys.get(draft.objectEntityId);
  if (subjectKey === undefined || objectKey === undefined) {
    // `claim_drafts.subject_entity_id`/`object_entity_id` are `story_entities`
    // foreign keys — a row that exists at all always resolves both.
    throw internalError();
  }
  const canonicalText = renderClaimSentence(BELL_MYSTERY_V1, {
    subjectEntityKey: subjectKey,
    predicate: draft.predicate as
      "was_at" | "moved" | "damaged" | "is_at" | "acted_for",
    objectEntityKey: objectKey,
    polarity: draft.polarity as "positive" | "negative",
    contextKey: draft.contextKey,
  });

  const playerTrust = loadedDisclosure.relationship.trust;
  const hopCount = draft.allegedSourceActorId === null ? 0 : 1;
  const primaryWeight = testimonyWeight(playerTestimonyBase(playerTrust), hopCount);
  const corroborationDelta = mechanics.isRepeatContribution
    ? 0
    : corroborationWeight(mechanics.newIndependentSourceCount) -
      corroborationWeight(mechanics.priorIndependentSourceCount);

  const beliefByClaimId = new Map(loadedDisclosure.beliefByClaimId);
  if (!mechanics.isRepeatContribution) {
    const primaryClaimId = mechanics.claim.claimId;
    if (primaryClaimId !== undefined) {
      const primaryState = mechanics.beliefStates.find(
        (row) => row.claimId === primaryClaimId,
      );
      beliefByClaimId.set(primaryClaimId, {
        score: predictedScore(
          scoreOf(primaryState),
          primaryWeight + corroborationDelta,
        ),
        contradictingScores:
          beliefByClaimId.get(primaryClaimId)?.contradictingScores ?? [],
      });
    }
    for (const related of mechanics.relatedClaims) {
      const relatedState = mechanics.beliefStates.find(
        (row) => row.claimId === related.claimId,
      );
      beliefByClaimId.set(related.claimId, {
        score: predictedScore(
          scoreOf(relatedState),
          mirrorWeightFor(related.relationKind, primaryWeight),
        ),
        contradictingScores:
          beliefByClaimId.get(related.claimId)?.contradictingScores ?? [],
      });
    }
  }

  const brokenPromiseRows =
    mechanics.claim.claimId === undefined
      ? []
      : await readSecretPromisesBrokenByTell(
          pool,
          context.townId,
          context.playerId,
          mechanics.claim.claimId,
          npc.npcId,
        );
  const brokenPromises: TellBrokenPromise[] = await Promise.all(
    brokenPromiseRows.map(async (promise) => {
      const relationship = await readRelationshipScores(
        pool,
        context.townId,
        promise.npcId,
        context.playerId,
      );
      return {
        ...promise,
        relationship: {
          npcId: promise.npcId,
          playerId: context.playerId,
          ...relationship,
        },
      };
    }),
  );

  const relevantClaimIds = new Set<string>([
    ...(mechanics.claim.claimId === undefined ? [] : [mechanics.claim.claimId]),
    ...mechanics.relatedClaims.map((related) => related.claimId),
  ]);
  const gateContext: DisclosureGateContext = {
    isRelevantToRequest: (claimKey) => {
      const source = loadedDisclosure.sources.find(
        (candidate) => candidate.claimKey === claimKey,
      );
      return source !== undefined && relevantClaimIds.has(source.claimId);
    },
    trust: loadedDisclosure.relationship.trust,
    suspicion: loadedDisclosure.relationship.suspicion,
    verifiedCluePresentedThisAction: false,
    everBrokenPromiseToThisNpc: loadedDisclosure.everBrokenPromiseToThisNpc,
    confrontationGateOpen: isConfrontationGateOpen(confrontation),
    beliefByClaimId,
  };

  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    draftId,
    draft,
    npc,
    npcKey: npc.characterKey,
    visitId: draft.visitId,
    claimDraftExists: true,
    claimDraftExpired: draft.status === "expired" || draft.expired,
    claimDraftAlreadyConfirmed: draft.status !== "pending",
    claimDraftWrongNpc: false,
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
    canonicalText,
    claim: mechanics.claim,
    playerTrust,
    isRepeatContribution: mechanics.isRepeatContribution,
    priorIndependentSourceCount: mechanics.priorIndependentSourceCount,
    newIndependentSourceCount: mechanics.newIndependentSourceCount,
    relatedClaims: mechanics.relatedClaims,
    newRelations: mechanics.newRelations,
    backfillEvidence: mechanics.backfillEvidence,
    beliefStates: mechanics.beliefStates,
    brokenPromises,
    disclosureSources: loadedDisclosure.sources,
    disclosureGateContext: gateContext,
    loadedAt: context.now,
  };
}

export async function loadTellInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<TellLoadedInputs> {
  const draftId = IdSchema.parse(context.requestPayload["claimDraftId"]);
  const [draft, visit] = await Promise.all([
    readDraftForPlayer(pool, context.townId, draftId, context.playerId),
    readActiveVisitLocation(pool, context.townId, context.playerId),
  ]);

  if (draft === undefined) {
    return emptyLoadedInputs(context, draftId, { visitId: visit?.visitId ?? null });
  }

  const npc = await readNpcSnapshot(pool, context.townId, draft.targetNpcId);
  // docs/005: "Confirmation is bound to the draft's visit and target NPC. The
  // visit must still be active and co-located with that NPC" — both the
  // originating visit and current co-location are checked, never just one.
  const wrongNpc =
    npc === undefined ||
    visit === undefined ||
    visit.visitId !== draft.visitId ||
    !isCoLocated(visit, npc);

  if (npc === undefined || wrongNpc) {
    return emptyLoadedInputs(context, draftId, {
      draft,
      npc,
      npcKey: npc?.characterKey ?? null,
      visitId: visit?.visitId ?? null,
      claimDraftExists: true,
      claimDraftExpired: draft.status === "expired" || draft.expired,
      claimDraftAlreadyConfirmed: draft.status !== "pending",
      claimDraftWrongNpc: true,
    });
  }

  return loadPresentTellInputs(pool, context, draftId, draft, npc);
}

/** Resolves the request target before `player_actions.target_actor_id` is written — the draft's own `target_npc_id`, since `tell`'s own request carries no `npcId`. */
export async function resolveTellTarget(
  pool: Pool,
  townId: string,
  draftId: string,
  playerId: string,
): Promise<string | null> {
  const draft = await readDraftForPlayer(pool, townId, draftId, playerId);
  return draft?.targetNpcId ?? null;
}

const TELL_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  CLAIM_DRAFT_NOT_FOUND:
    "That claim was never drafted, or has already expired from memory.",
  CLAIM_DRAFT_EXPIRED: "That draft has expired. Interpret the claim again.",
  CLAIM_DRAFT_ALREADY_CONFIRMED: "That claim was already told.",
  CLAIM_DRAFT_WRONG_NPC: "You are no longer with the person that claim was meant for.",
};

export function createTellActionHandler(
  dependencies: TellActionDependencies,
): ModelActionHandler<"tell", TellLoadedInputs, TellDialogueSelection> {
  return {
    kind: "tell",
    loadInputs: loadTellInputs,
    plan: planTell,
    async runModelSelection(
      params: RunModelSelectionParams<TellLoadedInputs>,
    ): Promise<TellDialogueSelection> {
      const { inputs, pending } = params;
      if (inputs.npc === undefined || inputs.npcKey === null) throw internalError();
      const assembled = buildNpcDialogueContext({
        npcKey: inputs.npcKey,
        npcId: inputs.npc.npcId,
        currentLocationId: inputs.npc.locationEntityId,
        disclosureSources: inputs.disclosureSources,
        content: BELL_MYSTERY_V1,
        disclosureGateContext: inputs.disclosureGateContext,
        playerAction: {
          actionKind: "tell",
          targetEntityIds: [inputs.npc.characterEntityId],
        },
        dialogueDirective: {
          requiredAct:
            "Acknowledge that you were just told this claim, and share anything relevant you can now say.",
          gateResult: "passed",
        },
        allowedResponseKinds: ["acknowledge", "answer"],
        canonicalEntities: [],
        approvedActors: [],
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
      if (inputs.npc === undefined || inputs.claim === undefined) return [];
      return applyTellSelection({
        actionId: inputs.actionId,
        visitId: inputs.visitId!,
        playerId: inputs.playerId,
        npcId: inputs.npc.npcId,
        npcCharacterEntityId: inputs.npc.characterEntityId,
        locationEntityId: inputs.npc.locationEntityId,
        occurredAt: inputs.loadedAt,
        selection,
        draftId: inputs.draftId,
        claim: inputs.claim,
        canonicalText: inputs.canonicalText,
        allegedSourceActorId: inputs.draft?.allegedSourceActorId ?? null,
        playerTrust: inputs.playerTrust,
        isRepeatContribution: inputs.isRepeatContribution,
        priorIndependentSourceCount: inputs.priorIndependentSourceCount,
        newIndependentSourceCount: inputs.newIndependentSourceCount,
        relatedClaims: inputs.relatedClaims,
        newRelations: inputs.newRelations,
        backfillEvidence: inputs.backfillEvidence,
        beliefStates: inputs.beliefStates,
        brokenPromises: inputs.brokenPromises,
      });
    },
    allocateInsertIds(inputs) {
      return inputs.claim !== undefined && !inputs.claim.exists
        ? { claims: randomUUID() }
        : {};
    },
    buildResult(inputs, _effects, insertIds, selection) {
      if (selection === undefined || inputs.claim === undefined) throw internalError();
      const claimId = inputs.claim.exists
        ? inputs.claim.claimId!
        : insertIds["claims"]!;
      return {
        claimDraftId: inputs.draftId,
        claim: { claimId, text: inputs.canonicalText },
        dialogue: {
          npcId: selection.npcId,
          text: selection.text,
          responseMode: selection.responseMode,
        },
        promiseOffers: [],
      } satisfies ActionResultByKind["tell"];
    },
    reasonMessage: (code) =>
      TELL_DENIAL_MESSAGES[code] ?? "That cannot be told right now.",
    resolveVisitId: (inputs) => inputs.visitId,
  };
}
