/**
 * Promise-offer retrieval and re-validation for `accept_promise` (`P4-16`).
 *
 * `D4-S`: an offer descriptor is decoded (`decodePromiseOffer`) and then
 * retrieved verbatim from the **saved source action's response** — never
 * rebuilt from current content — so a descriptor saved under an older
 * content version is honored exactly as presented. Only the *gate* (trust,
 * suspicion, custody, confrontation state) is re-checked against the
 * current town, since that can legitimately have moved since the offer was
 * shown.
 */

import {
  CompletedActionResponseSchema,
  PromiseOfferViewSchema,
  type PromiseOfferView,
} from "@the-town-remembers/http-contracts";
import {
  decodePromiseOffer,
  meetsDisclosureTier,
  nessaKeyLoanEligible,
  type PromiseKey,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { readActionForPlayer } from "../../persistence/actions.js";
import { readConfrontationGateStatus } from "../../persistence/view-queries.js";
import { readItemCustody, type NpcSnapshot } from "../../persistence/npc-state.js";
import { readActivePromises, toPromiseKeys } from "../../persistence/promises.js";
import {
  hasEverBrokenPromiseToNpc,
  readRelationshipScores,
} from "../../persistence/relationships.js";

/**
 * The offer descriptor exactly as saved in the source action's completed
 * response, or `undefined` for anything a caller must treat as a uniform
 * "invalid offer" denial — a forged, malformed, cross-action, or
 * out-of-range `offerId` are indistinguishable from here on, by design
 * (`P4-16` acceptance 1: reveals nothing about which part failed).
 */
export async function retrieveSavedPromiseOffer(
  pool: Pool,
  townId: string,
  playerId: string,
  offerId: string,
): Promise<PromiseOfferView | undefined> {
  const decoded = decodePromiseOffer(offerId);
  if (decoded === undefined) return undefined;

  const action = await readActionForPlayer(pool, townId, playerId, decoded.sourceActionId);
  if (action === undefined || action.status !== "completed") return undefined;

  const parsed = CompletedActionResponseSchema.safeParse(action.responsePayload);
  if (!parsed.success || parsed.data.outcome === "denied") return undefined;

  const result = parsed.data.result as Readonly<Record<string, unknown>>;
  const offers = result["promiseOffers"];
  if (!Array.isArray(offers)) return undefined;
  const candidate = offers[decoded.ordinal] as unknown;
  const offer = PromiseOfferViewSchema.safeParse(candidate);
  if (!offer.success || offer.data.offerId !== offerId) return undefined;
  return offer.data;
}

export interface PromiseGateState {
  readonly npc: NpcSnapshot;
  readonly playerId: string;
  readonly trust: number;
  readonly suspicion: number;
  readonly everBrokenPromiseToThisNpc: boolean;
  readonly activePromises: readonly PromiseKey[];
}

export interface ReValidatedOffer {
  readonly gateMet: boolean;
  /** Present only for a `return_item` offer whose item is still available exactly where the offer said it was. */
  readonly itemStillAvailable: boolean;
  readonly itemRevision: number | undefined;
}

/**
 * Re-checks the offer's own gate against *current* state — never the
 * snapshot the offer was originally built from. The subject identity
 * (item/claim id, NPC id, terms) is trusted verbatim from the saved
 * descriptor; only whether the player still qualifies is re-derived.
 */
export async function reValidatePromiseOffer(
  pool: Pool,
  townId: string,
  offer: PromiseOfferView,
  state: PromiseGateState,
): Promise<ReValidatedOffer> {
  if (offer.kind === "return_item" && offer.subject.kind === "item") {
    const [confrontation, custodyByItem] = await Promise.all([
      readConfrontationGateStatus(pool, townId),
      readItemCustody(pool, townId, [offer.subject.itemId]),
    ]);
    const custody = custodyByItem.get(offer.subject.itemId);
    const itemStillAvailable = custody?.heldByActorId === state.npc.npcId;
    const gateMet =
      itemStillAvailable &&
      !confrontation.bellRevealed &&
      nessaKeyLoanEligible(state.trust, state.suspicion);
    return { gateMet, itemStillAvailable, itemRevision: custody?.revision };
  }

  if (offer.kind === "keep_secret") {
    const gateMet = meetsDisclosureTier("confidential", {
      isRelevantToRequest: true,
      trust: state.trust,
      suspicion: state.suspicion,
      verifiedCluePresentedThisAction: false,
      everBrokenPromiseToThisNpc: state.everBrokenPromiseToThisNpc,
      isCorinsCoverStoryClaim: false,
      confrontationGateOpen: false,
    });
    return { gateMet, itemStillAvailable: false, itemRevision: undefined };
  }

  return { gateMet: false, itemStillAvailable: false, itemRevision: undefined };
}

export function promiseKeyFor(offer: PromiseOfferView): PromiseKey {
  return {
    npcId: offer.npcId,
    kind: offer.kind,
    protectedClaimId: offer.subject.kind === "claim" ? offer.subject.claimId : null,
    protectedItemId: offer.subject.kind === "item" ? offer.subject.itemId : null,
  };
}

export async function loadPromiseGateState(
  pool: Pool,
  townId: string,
  playerId: string,
  npc: NpcSnapshot,
): Promise<PromiseGateState> {
  const [relationship, everBroken, activePromiseRows] = await Promise.all([
    readRelationshipScores(pool, townId, npc.npcId, playerId),
    hasEverBrokenPromiseToNpc(pool, townId, npc.npcId, playerId),
    readActivePromises(pool, townId, npc.npcId, playerId),
  ]);
  return {
    npc,
    playerId,
    trust: relationship.trustScore,
    suspicion: relationship.suspicionScore,
    everBrokenPromiseToThisNpc: everBroken,
    activePromises: toPromiseKeys(npc.npcId, activePromiseRows),
  };
}
