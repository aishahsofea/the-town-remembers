/**
 * `accept_promise`'s narrow Observe -> Decide -> Select -> Persist
 * composition (`P4-16`). `planAcceptPromise` computes every deterministic
 * effect — the promise row and, for a `return_item` offer, the atomic item
 * custody transfer — before any model call; this loader's job is retrieving
 * the saved offer descriptor (`application/npc/offers.ts`), re-validating
 * its gate against current state, and resolving the identity the pure
 * planner needs.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";
import type { ActionResultByKind } from "@the-town-remembers/http-contracts";
import type { AssembledDialogueContext } from "@the-town-remembers/model-runtime";
import {
  applyAcceptPromiseSelection,
  hasActivePromise,
  planAcceptPromise,
  type AcceptPromiseDialogueSelection,
  type AcceptPromiseItemTransfer,
  type ExternalSelectionRequired,
  type ReasonCode,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import {
  loadPromiseGateState,
  promiseKeyFor,
  retrieveSavedPromiseOffer,
  reValidatePromiseOffer,
  type PromiseGateState,
} from "../../npc/offers.js";
import {
  isCoLocated,
  readActiveVisitLocation,
  readNpcSnapshot,
  type NpcSnapshot,
} from "../../../persistence/npc-state.js";
import { buildNpcDialogueContext } from "../../npc/context.js";
import type { LoadInputsContext } from "../executor.js";
import type { ModelActionHandler, RunModelSelectionParams } from "../model-executor.js";

export interface AcceptPromiseDialogueSelectionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly npcKey: string;
  readonly assembled: AssembledDialogueContext;
  readonly pending: ExternalSelectionRequired;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
  /** Selects the authored fallback's required outcome — `chapel_key_lent` vs. `keep_secret_promise_accepted`. */
  readonly promiseKind: "keep_secret" | "return_item";
}

export interface AcceptPromiseActionDependencies {
  selectDialogue(
    params: AcceptPromiseDialogueSelectionParams,
  ): Promise<AcceptPromiseDialogueSelection>;
}

interface ResolvedOffer {
  readonly offerId: string;
  readonly npc: NpcSnapshot;
  readonly npcDisplayName: string;
  readonly visitId: string;
  readonly kind: "keep_secret" | "return_item";
  readonly termsVersion: string;
  readonly summary: string;
  readonly subject:
    | { readonly kind: "claim"; readonly claimId: string; readonly text: string }
    | { readonly kind: "item"; readonly itemId: string; readonly displayName: string };
  readonly gateState: PromiseGateState;
  readonly hasActivePromiseAlready: boolean;
  readonly gateMet: boolean;
  readonly itemRevision: number | undefined;
}

export interface AcceptPromiseLoadedInputs {
  readonly townId: string;
  readonly actionId: string;
  readonly playerId: string;
  readonly offerId: string;
  readonly resolved: ResolvedOffer | undefined;
  readonly loadedAt: Date;
}

async function resolveOffer(
  pool: Pool,
  townId: string,
  playerId: string,
  offerId: string,
): Promise<ResolvedOffer | undefined> {
  const offer = await retrieveSavedPromiseOffer(pool, townId, playerId, offerId);
  if (offer === undefined) return undefined;

  const [npc, visit] = await Promise.all([
    readNpcSnapshot(pool, townId, offer.npcId),
    readActiveVisitLocation(pool, townId, playerId),
  ]);
  if (npc === undefined || !isCoLocated(visit, npc) || visit === undefined) return undefined;

  const displayNameResult = await pool.query<{ readonly display_name: string }>(
    `SELECT display_name FROM public.actors WHERE town_id = $1 AND id = $2`,
    [townId, npc.npcId],
  );
  const npcDisplayName = displayNameResult.rows[0]?.display_name ?? "";

  const gateState = await loadPromiseGateState(pool, townId, playerId, npc);
  const hasActivePromiseAlready = hasActivePromise(gateState.activePromises, promiseKeyFor(offer));
  const revalidated = await reValidatePromiseOffer(pool, townId, offer, gateState);

  return {
    offerId,
    npc,
    npcDisplayName,
    visitId: visit.visitId,
    kind: offer.kind,
    termsVersion: offer.termsVersion,
    summary: offer.summary,
    subject: offer.subject,
    gateState,
    hasActivePromiseAlready,
    gateMet: revalidated.gateMet,
    itemRevision: revalidated.itemRevision,
  };
}

export async function loadAcceptPromiseInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<AcceptPromiseLoadedInputs> {
  const offerId = z.string().min(1).parse(context.requestPayload["offerId"]);
  const resolved = await resolveOffer(pool, context.townId, context.playerId, offerId);
  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    offerId,
    resolved,
    loadedAt: context.now,
  };
}

/** Resolves the request target before `player_actions.target_actor_id` is written — the saved offer's own NPC, since the request carries only an opaque `offerId`. */
export async function resolveAcceptPromiseTarget(
  pool: Pool,
  townId: string,
  playerId: string,
  offerId: string,
): Promise<string | null> {
  const offer = await retrieveSavedPromiseOffer(pool, townId, playerId, offerId);
  return offer?.npcId ?? null;
}

const ACCEPT_PROMISE_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  PROMISE_OFFER_INVALID: "That offer is no longer available.",
  PROMISE_ALREADY_ACTIVE: "You already have an active promise with that person.",
};

export function createAcceptPromiseActionHandler(
  dependencies: AcceptPromiseActionDependencies,
): ModelActionHandler<
  "accept_promise",
  AcceptPromiseLoadedInputs,
  AcceptPromiseDialogueSelection
> {
  return {
    kind: "accept_promise",
    loadInputs: loadAcceptPromiseInputs,
    plan: (inputs) => {
      const resolved = inputs.resolved;
      if (resolved === undefined) {
        return planAcceptPromise({
          offerIsValid: false,
          hasActivePromiseAlready: false,
          npcId: "",
          playerId: inputs.playerId,
          kind: "keep_secret",
          termsVersion: "",
          disclosureCandidates: [],
          requiredDisclosureIds: [],
          approvedOutcomes: [],
          requiredOutcomeIds: [],
          approvedEpisodes: [],
        });
      }
      const itemTransfer: AcceptPromiseItemTransfer | undefined =
        resolved.kind === "return_item" && resolved.subject.kind === "item"
          ? { itemId: resolved.subject.itemId, itemRevision: resolved.itemRevision ?? 0 }
          : undefined;
      return planAcceptPromise({
        offerIsValid: resolved.gateMet,
        hasActivePromiseAlready: resolved.hasActivePromiseAlready,
        npcId: resolved.npc.npcId,
        playerId: inputs.playerId,
        kind: resolved.kind,
        termsVersion: resolved.termsVersion,
        ...(resolved.subject.kind === "claim"
          ? { protectedClaimId: resolved.subject.claimId }
          : {}),
        ...(itemTransfer === undefined ? {} : { itemTransfer }),
        disclosureCandidates: [],
        requiredDisclosureIds: [],
        approvedOutcomes: [],
        requiredOutcomeIds: [],
        approvedEpisodes: [],
      });
    },
    async runModelSelection(
      params: RunModelSelectionParams<AcceptPromiseLoadedInputs>,
    ): Promise<AcceptPromiseDialogueSelection> {
      const { inputs, pending } = params;
      const resolved = inputs.resolved;
      if (resolved === undefined) throw internalError();
      const assembled = buildNpcDialogueContext({
        npcKey: resolved.npc.characterKey,
        npcId: resolved.npc.npcId,
        currentLocationId: resolved.npc.locationEntityId,
        disclosureSources: [],
        content: BELL_MYSTERY_V1,
        disclosureGateContext: {
          isRelevantToRequest: () => false,
          trust: resolved.gateState.trust,
          suspicion: resolved.gateState.suspicion,
          verifiedCluePresentedThisAction: false,
          everBrokenPromiseToThisNpc: resolved.gateState.everBrokenPromiseToThisNpc,
          confrontationGateOpen: false,
          beliefByClaimId: new Map(),
        },
        playerAction: {
          actionKind: "accept_promise",
          targetEntityIds: [resolved.npc.characterEntityId],
        },
        dialogueDirective: {
          requiredAct: "Acknowledge accepting the promise.",
          gateResult: "passed",
        },
        allowedResponseKinds: ["answer"],
        canonicalEntities: [],
        approvedActors: [],
      });
      return dependencies.selectDialogue({
        townId: inputs.townId,
        actionId: inputs.actionId,
        npcKey: resolved.npc.characterKey,
        assembled,
        pending,
        deadlineAt: params.deadlineAt,
        attempt: params.attempt,
        now: inputs.loadedAt,
        promiseKind: resolved.kind,
      });
    },
    applySelection(inputs, _pending, selection) {
      const resolved = inputs.resolved;
      if (resolved === undefined) return [];
      return applyAcceptPromiseSelection({
        actionId: inputs.actionId,
        visitId: resolved.visitId,
        playerId: inputs.playerId,
        npcId: resolved.npc.npcId,
        npcCharacterEntityId: resolved.npc.characterEntityId,
        locationEntityId: resolved.npc.locationEntityId,
        occurredAt: inputs.loadedAt,
        selection,
      });
    },
    allocateInsertIds(inputs) {
      return inputs.resolved !== undefined ? { promises: randomUUID() } : {};
    },
    buildResult(inputs, _effects, insertIds, selection) {
      const resolved = inputs.resolved;
      if (resolved === undefined || selection === undefined) throw internalError();
      const promiseId = insertIds["promises"];
      if (promiseId === undefined) throw internalError();

      const itemTransfer =
        resolved.kind === "return_item" && resolved.subject.kind === "item"
          ? {
              itemId: resolved.subject.itemId,
              fromActorId: resolved.npc.npcId,
              toActorId: inputs.playerId,
            }
          : null;

      return {
        promise: {
          promiseId,
          npc: {
            id: resolved.npc.npcId,
            actorType: "npc" as const,
            displayName: resolved.npcDisplayName,
          },
          kind: resolved.kind,
          summary: resolved.summary,
          subject: resolved.subject,
          acceptedAt: inputs.loadedAt.toISOString(),
        },
        itemTransfer,
        dialogue: {
          npcId: selection.npcId,
          text: selection.text,
          responseMode: selection.responseMode,
        },
      } satisfies ActionResultByKind["accept_promise"];
    },
    reasonMessage: (code) =>
      ACCEPT_PROMISE_DENIAL_MESSAGES[code] ?? "That promise cannot be accepted right now.",
    resolveVisitId: (inputs) => inputs.resolved?.visitId ?? null,
    eventMetadata: (inputs) => ({
      actorId: inputs.playerId,
      targetActorId: inputs.resolved?.npc.npcId ?? null,
      locationEntityId: inputs.resolved?.npc.locationEntityId ?? null,
    }),
  };
}
