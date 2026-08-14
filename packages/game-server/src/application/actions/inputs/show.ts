/**
 * `show`'s narrow Observe -> Decide -> Select -> Persist composition
 * (`P4-14`). Every deterministic effect — the structured clue link, `D2-J`'s
 * caught-lie reversal, the relationship consequence, and Corin's capability
 * grant — is computed once, before any model call, by `rules/actions/
 * model-backed.ts#planShow`; this loader's only job is resolving exactly the
 * database state that pure function needs. The model is consulted only for
 * the NPC's own reactive line (`applyShowSelection` records that turn).
 */

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";
import {
  EvidenceRefSchema,
  IdSchema,
  type ActionResultByKind,
  type EvidenceRef,
} from "@the-town-remembers/http-contracts";
import type { AssembledDialogueContext } from "@the-town-remembers/model-runtime";
import {
  applyShowSelection,
  establishesKnowingLie,
  isRepeatRelationshipContribution,
  planShow,
  planShowStructuredEffect,
  type ExternalSelectionRequired,
  type ReasonCode,
  type RelationshipContributionKey,
  type ShowCapabilityGrant,
  type ShowClaimBeliefState,
  type ShowClueEvidenceLink,
  type ShowDialogueSelection,
  type ShowInputs,
  type ShowRelationshipReason,
  type ShowSourceReversal,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import { readNpcBeliefs } from "../../../persistence/beliefs.js";
import { readActiveTestimonySources } from "../../../persistence/claims.js";
import { readClueDiscoveries } from "../../../persistence/discoveries.js";
import {
  readActiveContributionsForReversal,
  readActivePlayerTestimonyRootTransmission,
  readAlreadyRecordedEvidence,
  readClueClaimEffects,
  readClueForRevealedItem,
  readCluesByIds,
  readEarliestOriginalAssertions,
  readPlayerClueDiscoveredAt,
  readRelationshipChangeKeys,
} from "../../../persistence/evidence.js";
import {
  hasCapability,
  isCoLocated,
  readActiveVisitLocation,
  readGrantedCapabilities,
  readItemCustody,
  readNpcSnapshot,
  type NpcSnapshot,
} from "../../../persistence/npc-state.js";
import { readRelationshipScores } from "../../../persistence/relationships.js";
import { buildNpcDialogueContext } from "../../npc/context.js";
import type { LoadInputsContext } from "../executor.js";
import type { ModelActionHandler, RunModelSelectionParams } from "../model-executor.js";

const CORIN_CAPABILITY_KEY = "enter_old_chapel";
const CORIN_NPC_KEY = "corin_hale";

export interface ShowDialogueSelectionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly npcKey: string;
  readonly assembled: AssembledDialogueContext;
  readonly pending: ExternalSelectionRequired;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
}

export interface ShowActionDependencies {
  selectDialogue(params: ShowDialogueSelectionParams): Promise<ShowDialogueSelection>;
}

export interface ShowLoadedInputs extends ShowInputs {
  readonly townId: string;
  readonly actionId: string;
  readonly playerId: string;
  readonly evidenceRef: EvidenceRef;
  readonly visitId: string | null;
  readonly npc: NpcSnapshot | undefined;
  readonly npcKey: string | null;
  readonly loadedAt: Date;
}

function emptyLoadedInputs(
  context: LoadInputsContext,
  evidenceRef: EvidenceRef,
  npc: NpcSnapshot | undefined,
  visitId: string | null,
): ShowLoadedInputs {
  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    evidenceRef,
    visitId,
    npc,
    npcKey: npc?.characterKey ?? null,
    npcPresent: false,
    evidenceKind: evidenceRef.kind,
    clueDiscoveredInTown: false,
    itemCurrentlyHeldByPlayer: false,
    shownClueIds: [],
    clueClaimEffects: [],
    alreadyRecordedEvidence: [],
    claimBeliefs: [],
    relationshipReasons: [],
    relationship: { trustScore: 0, suspicionScore: 0, revision: 0 },
    npcId: npc?.npcId ?? "",
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
    loadedAt: context.now,
  };
}

function relationshipContributionKeys(
  rows: readonly {
    readonly reasonKind: RelationshipContributionKey["reasonKind"];
    readonly claimId: string | null;
    readonly clueId: string | null;
  }[],
  npcId: string,
  playerId: string,
): readonly RelationshipContributionKey[] {
  return rows.map((row) => ({
    reasonKind: row.reasonKind,
    npcId,
    playerId,
    claimId: row.claimId,
    clueId: row.clueId,
  }));
}

interface RelationshipConsequence {
  readonly relationshipReasons: readonly ShowRelationshipReason[];
  readonly sourceReversals: readonly ShowSourceReversal[];
}

/**
 * `D2-J` plus docs/008's exclusivity: when any newly-linked contradiction
 * catches a lie, the whole Show event's relationship consequence collapses
 * to `lie_established` row(s) only — never additionally `verified_testimony`
 * or `evidence_presented` in the same event.
 */
async function computeRelationshipConsequence(
  pool: Pool,
  townId: string,
  npc: NpcSnapshot,
  playerId: string,
  newLinks: readonly ShowClueEvidenceLink[],
  shownClueIds: readonly string[],
  appliedClueIds: ReadonlySet<string>,
): Promise<RelationshipConsequence> {
  const existingKeysRaw = await readRelationshipChangeKeys(pool, townId, npc.npcId, playerId);
  const existingKeys = relationshipContributionKeys(existingKeysRaw, npc.npcId, playerId);
  const priorLieClaimIds = new Set(
    existingKeysRaw
      .filter((row) => row.reasonKind === "lie_established" && row.claimId !== null)
      .map((row) => row.claimId as string),
  );

  const negativeClaimIds = [
    ...new Set(newLinks.filter((link) => link.signedWeight < 0).map((link) => link.claimId)),
  ].toSorted();
  const negativeLinkClueByClaimId = new Map(
    newLinks
      .filter((link) => link.signedWeight < 0)
      .map((link) => [link.claimId, link.clueId] as const),
  );

  const [confirmations, discoveredAtByClue] = await Promise.all([
    readEarliestOriginalAssertions(pool, townId, npc.npcId, playerId, negativeClaimIds),
    readPlayerClueDiscoveredAt(pool, townId, playerId, [
      ...new Set(negativeLinkClueByClaimId.values()),
    ]),
  ]);

  const caughtLieClaims: { claimId: string; rootTransmissionId: string }[] = [];
  for (const claimId of negativeClaimIds) {
    const confirmation = confirmations.get(claimId);
    const clueId = negativeLinkClueByClaimId.get(claimId);
    if (confirmation === undefined || clueId === undefined) continue;
    const discoveredAt = discoveredAtByClue.get(clueId);
    const caught = establishesKnowingLie({
      playerConfirmedClaimToThisNpc: true,
      contradictingClueVerifiedAndVisibleAtConfirmation:
        discoveredAt !== undefined && discoveredAt < confirmation.confirmedAt,
      npcLaterPresentedClueOrHadDirectKnowledge: true,
      priorLieEstablishedForThisPlayerNpcClaim: priorLieClaimIds.has(claimId),
    });
    if (caught) {
      caughtLieClaims.push({ claimId, rootTransmissionId: confirmation.transmissionId });
    }
  }

  if (caughtLieClaims.length > 0) {
    const sourceReversals = await Promise.all(
      caughtLieClaims.map(async ({ claimId }) => {
        const [activeContributions, activeSources] = await Promise.all([
          readActiveContributionsForReversal(pool, townId, npc.npcId, claimId, playerId),
          readActiveTestimonySources(pool, townId, npc.npcId, claimId),
        ]);
        const priorIndependentSourceCount = new Set(activeSources).size;
        const newIndependentSourceCount = new Set(
          activeSources.filter((sourceId) => sourceId !== playerId),
        ).size;
        return {
          claimId,
          activeContributions,
          priorIndependentSourceCount,
          newIndependentSourceCount,
        } satisfies ShowSourceReversal;
      }),
    );
    return {
      relationshipReasons: caughtLieClaims.map((caught) => ({
        reasonKind: "lie_established" as const,
        claimId: caught.claimId,
        sourceRootTransmissionId: caught.rootTransmissionId,
      })),
      sourceReversals,
    };
  }

  // Scoped to `newLinks` (this Show's own not-yet-recorded contribution),
  // not every claim `appliedClueIds` touches: unlike `evidence_presented`
  // above, a second player earning their own first `verified_testimony` on a
  // claim someone else already structurally recorded is a rarer cross-player
  // interaction this loader does not yet resolve — a known, narrow gap, not
  // an oversight, left for a future pass if it proves to matter in practice.
  const positiveClaimIds = [
    ...new Set(newLinks.filter((link) => link.signedWeight >= 0).map((link) => link.claimId)),
  ].toSorted();
  const verifiedTestimonyClaimIds: string[] = [];
  if (positiveClaimIds.length > 0) {
    const activeSourcesByClaim = await Promise.all(
      positiveClaimIds.map(async (claimId) => ({
        claimId,
        sources: await readActiveTestimonySources(pool, townId, npc.npcId, claimId),
      })),
    );
    for (const { claimId, sources } of activeSourcesByClaim) {
      if (!sources.includes(playerId)) continue;
      const candidateKey: RelationshipContributionKey = {
        reasonKind: "verified_testimony",
        npcId: npc.npcId,
        playerId,
        claimId,
      };
      if (!isRepeatRelationshipContribution(existingKeys, candidateKey)) {
        verifiedTestimonyClaimIds.push(claimId);
      }
    }
  }

  const rootTransmissionByClaimId = new Map(
    await Promise.all(
      verifiedTestimonyClaimIds.map(async (claimId) => {
        const rootTransmissionId = await readActivePlayerTestimonyRootTransmission(
          pool,
          townId,
          npc.npcId,
          claimId,
          playerId,
        );
        return [claimId, rootTransmissionId] as const;
      }),
    ),
  );
  const reasons: ShowRelationshipReason[] = verifiedTestimonyClaimIds.flatMap((claimId) => {
    const link = newLinks.find((entry) => entry.claimId === claimId);
    const rootTransmissionId = rootTransmissionByClaimId.get(claimId);
    // Both lookups are guaranteed by construction (this claim came from
    // `newLinks`, and `readActiveTestimonySources` just confirmed an active
    // player-testimony row exists) — the guard is defense in depth, not an
    // expected path.
    if (link === undefined || rootTransmissionId === undefined) return [];
    return [
      {
        reasonKind: "verified_testimony" as const,
        claimId,
        clueId: link.clueId,
        sourceRootTransmissionId: rootTransmissionId,
      },
    ];
  });

  // Gated on `appliedClueIds` (does this clue have any authored effect at
  // all) rather than `newLinks` (did *this* Show add a not-yet-recorded
  // belief_evidence row) — docs/008 scopes the repeat key to (npc, player,
  // clue), so a second player's first-ever presentation of an
  // already-structurally-recorded clue still earns them their own row.
  const primaryClueId = shownClueIds[0];
  if (
    primaryClueId !== undefined &&
    appliedClueIds.has(primaryClueId) &&
    !isRepeatRelationshipContribution(existingKeys, {
      reasonKind: "evidence_presented",
      npcId: npc.npcId,
      playerId,
      clueId: primaryClueId,
    })
  ) {
    reasons.push({ reasonKind: "evidence_presented", clueId: primaryClueId });
  }

  return { relationshipReasons: reasons, sourceReversals: [] };
}

async function loadAuthorizedShowInputs(
  pool: Pool,
  context: LoadInputsContext,
  evidenceRef: EvidenceRef,
  npc: NpcSnapshot,
  visitId: string,
): Promise<ShowLoadedInputs> {
  const evidenceAuthorization =
    evidenceRef.kind === "clue"
      ? await (async () => {
          const discoveries = await readClueDiscoveries(
            pool,
            context.townId,
            evidenceRef.clueId,
          );
          return {
            clueDiscoveredInTown: discoveries.length > 0,
            itemCurrentlyHeldByPlayer: false,
            shownClueIds: [evidenceRef.clueId],
          };
        })()
      : await (async () => {
          const custody = await readItemCustody(pool, context.townId, [evidenceRef.itemId]);
          const revealedClueId = await readClueForRevealedItem(
            pool,
            context.townId,
            evidenceRef.itemId,
          );
          return {
            clueDiscoveredInTown: false,
            itemCurrentlyHeldByPlayer:
              custody.get(evidenceRef.itemId)?.heldByActorId === context.playerId,
            shownClueIds: revealedClueId === undefined ? [] : [revealedClueId],
          };
        })();
  const { clueDiscoveredInTown, itemCurrentlyHeldByPlayer, shownClueIds } =
    evidenceAuthorization;

  const [clueClaimEffects, clueRows, alreadyRecordedEvidence, relationship, grantedCapabilities] =
    await Promise.all([
      readClueClaimEffects(pool, context.townId, shownClueIds),
      readCluesByIds(pool, context.townId, shownClueIds),
      readAlreadyRecordedEvidence(pool, context.townId, npc.npcId, shownClueIds),
      readRelationshipScores(pool, context.townId, npc.npcId, context.playerId),
      npc.characterKey === CORIN_NPC_KEY
        ? readGrantedCapabilities(pool, context.townId, context.playerId)
        : Promise.resolve([]),
    ]);

  const structuredEffectPlan = planShowStructuredEffect(shownClueIds, clueClaimEffects);
  const appliedClueIds = new Set(structuredEffectPlan.appliedClueIds);
  const alreadyRecordedKeys = new Set(
    alreadyRecordedEvidence.map((entry) => `${entry.claimId}:${entry.clueId}`),
  );
  const newLinks = clueClaimEffects.filter(
    (link) =>
      appliedClueIds.has(link.clueId) &&
      !alreadyRecordedKeys.has(`${link.claimId}:${link.clueId}`),
  );

  const { relationshipReasons, sourceReversals } = await computeRelationshipConsequence(
    pool,
    context.townId,
    npc,
    context.playerId,
    newLinks,
    shownClueIds,
    appliedClueIds,
  );

  const affectedClaimIds = [
    ...new Set([
      ...newLinks.map((link) => link.claimId),
      ...sourceReversals.map((reversal) => reversal.claimId),
    ]),
  ];
  const beliefRows = await readNpcBeliefs(pool, context.townId, npc.npcId, affectedClaimIds);
  const claimBeliefs: ShowClaimBeliefState[] = affectedClaimIds.map((claimId) => {
    const row = beliefRows.get(claimId);
    return row === undefined
      ? { claimId, exists: false, score: 0, revision: 0 }
      : { claimId, exists: true, score: row.score, revision: row.revision };
  });

  const presentedRequiredClueThisAction = shownClueIds.some(
    (clueId) => clueRows.get(clueId)?.requiredForResolution === true,
  );
  const capabilityGrant: ShowCapabilityGrant | undefined =
    npc.characterKey === CORIN_NPC_KEY
      ? {
          capabilityKey: CORIN_CAPABILITY_KEY,
          alreadyGranted: hasCapability(grantedCapabilities, CORIN_CAPABILITY_KEY),
          presentedRequiredClueThisAction,
        }
      : undefined;

  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    evidenceRef,
    visitId,
    npc,
    npcKey: npc.characterKey,
    npcPresent: true,
    evidenceKind: evidenceRef.kind,
    clueDiscoveredInTown,
    itemCurrentlyHeldByPlayer,
    shownClueIds,
    clueClaimEffects,
    alreadyRecordedEvidence,
    claimBeliefs,
    relationshipReasons,
    relationship,
    npcId: npc.npcId,
    sourceReversals,
    ...(capabilityGrant === undefined ? {} : { capabilityGrant }),
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
    loadedAt: context.now,
  };
}

export async function loadShowInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<ShowLoadedInputs> {
  const evidenceRef = EvidenceRefSchema.parse(context.requestPayload["evidenceRef"]);
  const npcId = IdSchema.parse(context.requestPayload["npcId"]);
  const [npc, visit] = await Promise.all([
    readNpcSnapshot(pool, context.townId, npcId),
    readActiveVisitLocation(pool, context.townId, context.playerId),
  ]);

  if (!isCoLocated(visit, npc) || npc === undefined || visit === undefined) {
    return emptyLoadedInputs(context, evidenceRef, npc, visit?.visitId ?? null);
  }

  return loadAuthorizedShowInputs(pool, context, evidenceRef, npc, visit.visitId);
}

/** Resolves the request target before `player_actions.target_actor_id` is written. */
export async function resolveShowTarget(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<string | null> {
  return (await readNpcSnapshot(pool, townId, npcId))?.npcId ?? null;
}

const SHOW_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  NPC_NOT_PRESENT: "That person is not here to be shown anything.",
  EVIDENCE_NOT_AUTHORIZED:
    "You do not have that evidence available to show right now.",
};

export function createShowActionHandler(
  dependencies: ShowActionDependencies,
): ModelActionHandler<"show", ShowLoadedInputs, ShowDialogueSelection> {
  return {
    kind: "show",
    loadInputs: loadShowInputs,
    plan: planShow,
    async runModelSelection(
      params: RunModelSelectionParams<ShowLoadedInputs>,
    ): Promise<ShowDialogueSelection> {
      const { inputs, pending } = params;
      if (inputs.npc === undefined || inputs.npcKey === null) throw internalError();
      const assembled = buildNpcDialogueContext({
        npcKey: inputs.npcKey,
        npcId: inputs.npc.npcId,
        currentLocationId: inputs.npc.locationEntityId,
        disclosureSources: [],
        content: BELL_MYSTERY_V1,
        disclosureGateContext: {
          isRelevantToRequest: () => false,
          trust: inputs.relationship.trustScore,
          suspicion: inputs.relationship.suspicionScore,
          verifiedCluePresentedThisAction: inputs.shownClueIds.length > 0,
          everBrokenPromiseToThisNpc: false,
          confrontationGateOpen: false,
          beliefByClaimId: new Map(),
        },
        playerAction: {
          actionKind: "show",
          targetEntityIds: [inputs.npc.characterEntityId],
        },
        dialogueDirective: {
          requiredAct: "Acknowledge the evidence you were just shown and react to it.",
          gateResult: "passed",
        },
        allowedResponseKinds: ["acknowledge"],
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
      if (inputs.npc === undefined || inputs.visitId === null) return [];
      const affectedClaimIds = [
        ...new Set([
          ...inputs.claimBeliefs.map((belief) => belief.claimId),
          ...(inputs.sourceReversals ?? []).map((reversal) => reversal.claimId),
        ]),
      ];
      return applyShowSelection({
        actionId: inputs.actionId,
        visitId: inputs.visitId,
        playerId: inputs.playerId,
        npcId: inputs.npc.npcId,
        npcCharacterEntityId: inputs.npc.characterEntityId,
        locationEntityId: inputs.npc.locationEntityId,
        occurredAt: inputs.loadedAt,
        selection,
        affectedClaimIds,
      });
    },
    buildResult(inputs, _effects, _insertIds, selection) {
      if (selection === undefined) throw internalError();
      // `planShowStructuredEffect` only knows whether a shown clue has *any*
      // authored link — it cannot see which pairs this exact Show newly
      // recorded. Filtering to not-yet-recorded pairs first is what turns a
      // repeat Show of an already-recorded clue into `structuredEffect:
      // "none"` for the player, matching the belief effects `planShow`
      // itself actually emitted.
      const alreadyRecordedKeys = new Set(
        inputs.alreadyRecordedEvidence.map((entry) => `${entry.claimId}:${entry.clueId}`),
      );
      const newClueClaimEffects = inputs.clueClaimEffects.filter(
        (link) => !alreadyRecordedKeys.has(`${link.claimId}:${link.clueId}`),
      );
      const structuredEffectPlan = planShowStructuredEffect(
        inputs.shownClueIds,
        newClueClaimEffects,
      );
      return {
        evidenceRef: inputs.evidenceRef,
        structuredEffect: structuredEffectPlan.structuredEffect,
        appliedClueIds: [...structuredEffectPlan.appliedClueIds],
        dialogue: {
          npcId: selection.npcId,
          text: selection.text,
          responseMode: selection.responseMode,
        },
        promiseOffers: [],
      } satisfies ActionResultByKind["show"];
    },
    reasonMessage: (code) =>
      SHOW_DENIAL_MESSAGES[code] ?? "That cannot be shown right now.",
    resolveVisitId: (inputs) => inputs.visitId,
    eventMetadata: (inputs) => ({
      actorId: inputs.playerId,
      targetActorId: inputs.npc?.npcId ?? null,
      locationEntityId: inputs.npc?.locationEntityId ?? null,
    }),
  };
}
