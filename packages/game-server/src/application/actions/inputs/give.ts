/**
 * `give`'s narrow Observe -> Decide -> Select -> Persist composition
 * (`P4-15`). `planGive` computes every deterministic effect — custody,
 * the `requested_item_given` bonus, and any promise fulfil/break — before
 * any model call; this loader resolves exactly the database and content
 * state that pure function needs. The model is consulted only for the
 * NPC's own reactive line.
 */

import {
  BELL_MYSTERY_V1,
  requestedItemBindingForNpc,
} from "@the-town-remembers/content";
import { IdSchema, type ActionResultByKind } from "@the-town-remembers/http-contracts";
import type { AssembledDialogueContext } from "@the-town-remembers/model-runtime";
import {
  applyGiveSelection,
  isRepeatRelationshipContribution,
  planGive,
  type ExternalSelectionRequired,
  type GiveDialogueSelection,
  type GivePromiseResolution,
  type ReasonCode,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import { resolveEntityKeysByIds } from "../../../persistence/drafts.js";
import { readRelationshipChangeKeys } from "../../../persistence/evidence.js";
import {
  isCoLocated,
  readActiveVisitLocation,
  readItemCustody,
  readNpcSnapshot,
  type NpcSnapshot,
} from "../../../persistence/npc-state.js";
import { readActivePromiseForItem } from "../../../persistence/promises.js";
import { readRelationshipScores } from "../../../persistence/relationships.js";
import { buildNpcDialogueContext } from "../../npc/context.js";
import type { LoadInputsContext } from "../executor.js";
import type { ModelActionHandler, RunModelSelectionParams } from "../model-executor.js";

export interface GiveDialogueSelectionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly npcKey: string;
  readonly assembled: AssembledDialogueContext;
  readonly pending: ExternalSelectionRequired;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
  /** Whether custody actually transfers — selects the authored fallback's `responseKind`/outcome. */
  readonly npcAcceptsItem: boolean;
}

export interface GiveActionDependencies {
  selectDialogue(params: GiveDialogueSelectionParams): Promise<GiveDialogueSelection>;
}

export interface GiveLoadedInputs {
  readonly townId: string;
  readonly actionId: string;
  readonly playerId: string;
  readonly itemId: string;
  readonly visitId: string | null;
  readonly npc: NpcSnapshot | undefined;
  readonly npcKey: string | null;
  readonly npcPresent: boolean;
  readonly itemHeldByPlayer: boolean;
  readonly npcAcceptsItem: boolean;
  readonly itemRevision: number;
  readonly relationshipReasons: readonly "requested_item_given"[];
  readonly relationship: { trustScore: number; suspicionScore: number; revision: number };
  readonly promiseResolution: GivePromiseResolution | undefined;
  readonly promiseNpc: NpcSnapshot | undefined;
  readonly loadedAt: Date;
}

function emptyLoadedInputs(
  context: LoadInputsContext,
  itemId: string,
  npc: NpcSnapshot | undefined,
  visitId: string | null,
): GiveLoadedInputs {
  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    itemId,
    visitId,
    npc,
    npcKey: npc?.characterKey ?? null,
    npcPresent: false,
    itemHeldByPlayer: false,
    npcAcceptsItem: false,
    itemRevision: 0,
    relationshipReasons: [],
    relationship: { trustScore: 0, suspicionScore: 0, revision: 0 },
    promiseResolution: undefined,
    promiseNpc: undefined,
    loadedAt: context.now,
  };
}

async function loadAuthorizedGiveInputs(
  pool: Pool,
  context: LoadInputsContext,
  itemId: string,
  npc: NpcSnapshot,
  visitId: string,
): Promise<GiveLoadedInputs> {
  const [custodyByItem, entityKeyById, activePromise, relationship, relationshipKeys] =
    await Promise.all([
      readItemCustody(pool, context.townId, [itemId]),
      resolveEntityKeysByIds(pool, context.townId, [itemId]),
      readActivePromiseForItem(pool, context.townId, itemId),
      readRelationshipScores(pool, context.townId, npc.npcId, context.playerId),
      readRelationshipChangeKeys(pool, context.townId, npc.npcId, context.playerId),
    ]);

  const custody = custodyByItem.get(itemId);
  const itemHeldByPlayer = custody?.heldByActorId === context.playerId;
  const itemEntityKey = entityKeyById.get(itemId);
  const requestedBinding = requestedItemBindingForNpc(npc.characterKey);
  const isRequestedItem =
    requestedBinding !== undefined && requestedBinding.itemKey === itemEntityKey;

  const npcAcceptsItem = isRequestedItem || activePromise !== undefined;

  const relationshipReasons: readonly "requested_item_given"[] =
    npcAcceptsItem &&
    isRequestedItem &&
    !isRepeatRelationshipContribution(
      relationshipKeys.map((row) => ({
        reasonKind: row.reasonKind,
        npcId: npc.npcId,
        playerId: context.playerId,
        claimId: row.claimId,
        clueId: row.clueId,
      })),
      {
        reasonKind: "requested_item_given",
        npcId: npc.npcId,
        playerId: context.playerId,
        requestItemKey: itemEntityKey,
      },
    )
      ? ["requested_item_given"]
      : [];

  let promiseResolution: GivePromiseResolution | undefined;
  let promiseNpc: NpcSnapshot | undefined;
  if (npcAcceptsItem && activePromise !== undefined) {
    const [promiseNpcRelationship, resolvedPromiseNpc] = await Promise.all([
      readRelationshipScores(pool, context.townId, activePromise.promiseNpcId, context.playerId),
      readNpcSnapshot(pool, context.townId, activePromise.promiseNpcId),
    ]);
    promiseNpc = resolvedPromiseNpc;
    promiseResolution = {
      promiseId: activePromise.promiseId,
      promiseNpcId: activePromise.promiseNpcId,
      relationship: promiseNpcRelationship,
    };
  }

  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    itemId,
    visitId,
    npc,
    npcKey: npc.characterKey,
    npcPresent: true,
    itemHeldByPlayer,
    npcAcceptsItem,
    itemRevision: custody?.revision ?? 0,
    relationshipReasons,
    relationship,
    promiseResolution,
    promiseNpc,
    loadedAt: context.now,
  };
}

export async function loadGiveInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<GiveLoadedInputs> {
  const npcId = IdSchema.parse(context.requestPayload["npcId"]);
  const itemId = IdSchema.parse(context.requestPayload["itemId"]);
  const [npc, visit] = await Promise.all([
    readNpcSnapshot(pool, context.townId, npcId),
    readActiveVisitLocation(pool, context.townId, context.playerId),
  ]);

  if (!isCoLocated(visit, npc) || npc === undefined || visit === undefined) {
    return emptyLoadedInputs(context, itemId, npc, visit?.visitId ?? null);
  }

  return loadAuthorizedGiveInputs(pool, context, itemId, npc, visit.visitId);
}

/** Resolves the request target before `player_actions.target_actor_id` is written. */
export async function resolveGiveTarget(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<string | null> {
  return (await readNpcSnapshot(pool, townId, npcId))?.npcId ?? null;
}

const GIVE_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  NPC_NOT_PRESENT: "That person is not here to receive anything.",
  ITEM_NOT_HELD: "You are not carrying that item.",
};

export function createGiveActionHandler(
  dependencies: GiveActionDependencies,
): ModelActionHandler<"give", GiveLoadedInputs, GiveDialogueSelection> {
  return {
    kind: "give",
    loadInputs: loadGiveInputs,
    plan: (inputs) =>
      planGive({
        npcPresent: inputs.npcPresent,
        itemHeldByPlayer: inputs.itemHeldByPlayer,
        npcAcceptsItem: inputs.npcAcceptsItem,
        itemId: inputs.itemId,
        itemRevision: inputs.itemRevision,
        recipientActorId: inputs.npc?.npcId ?? "",
        playerId: inputs.playerId,
        relationshipReasons: inputs.relationshipReasons,
        relationship: inputs.relationship,
        ...(inputs.promiseResolution === undefined
          ? {}
          : { promiseResolution: inputs.promiseResolution }),
        disclosureCandidates: [],
        requiredDisclosureIds: [],
        approvedOutcomes: [],
        requiredOutcomeIds: [],
        approvedEpisodes: [],
      }),
    async runModelSelection(
      params: RunModelSelectionParams<GiveLoadedInputs>,
    ): Promise<GiveDialogueSelection> {
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
          verifiedCluePresentedThisAction: false,
          everBrokenPromiseToThisNpc: false,
          confrontationGateOpen: false,
          beliefByClaimId: new Map(),
        },
        playerAction: {
          actionKind: "give",
          targetEntityIds: [inputs.npc.characterEntityId],
        },
        dialogueDirective: {
          requiredAct: inputs.npcAcceptsItem
            ? "Acknowledge receiving the item."
            : "Decline the item without accepting it.",
          gateResult: "passed",
        },
        allowedResponseKinds: inputs.npcAcceptsItem ? ["acknowledge"] : ["refuse"],
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
        npcAcceptsItem: inputs.npcAcceptsItem,
      });
    },
    applySelection(inputs, _pending, selection) {
      if (inputs.npc === undefined || inputs.visitId === null) return [];
      const custodyTransferred = inputs.itemHeldByPlayer && inputs.npcAcceptsItem;
      return applyGiveSelection({
        actionId: inputs.actionId,
        visitId: inputs.visitId,
        playerId: inputs.playerId,
        npcId: inputs.npc.npcId,
        npcCharacterEntityId: inputs.npc.characterEntityId,
        locationEntityId: inputs.npc.locationEntityId,
        itemEntityId: inputs.itemId,
        occurredAt: inputs.loadedAt,
        selection,
        custodyTransferred,
        ...(custodyTransferred &&
        inputs.promiseResolution !== undefined &&
        inputs.promiseNpc !== undefined
          ? {
              promiseResolution: {
                outcome:
                  inputs.npc.npcId === inputs.promiseResolution.promiseNpcId
                    ? ("fulfilled" as const)
                    : ("broken" as const),
                promiseNpcId: inputs.promiseNpc.npcId,
                promiseNpcCharacterEntityId: inputs.promiseNpc.characterEntityId,
              },
            }
          : {}),
      });
    },
    buildResult(inputs, _effects, _insertIds, selection) {
      if (selection === undefined) throw internalError();
      return {
        itemId: inputs.itemId,
        custody: inputs.itemHeldByPlayer && inputs.npcAcceptsItem ? "transferred" : "unchanged",
        dialogue: {
          npcId: selection.npcId,
          text: selection.text,
          responseMode: selection.responseMode,
        },
        promiseOffers: [],
      } satisfies ActionResultByKind["give"];
    },
    reasonMessage: (code) =>
      GIVE_DENIAL_MESSAGES[code] ?? "That cannot be given right now.",
    resolveVisitId: (inputs) => inputs.visitId,
    eventMetadata: (inputs) => ({
      actorId: inputs.playerId,
      targetActorId: inputs.npc?.npcId ?? null,
      locationEntityId: inputs.npc?.locationEntityId ?? null,
    }),
  };
}
