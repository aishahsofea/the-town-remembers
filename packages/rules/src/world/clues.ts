/**
 * Clue discovery, inspection, item custody, `Show`/`Give` authorization, and
 * chapel access — Decision 008/009's exact rules.
 */

import { RULES_REGISTRY } from "../kernel/version.js";

// --- Inspection and discovery --------------------------------------------------

export type InspectDiscovery =
  "new_to_town" | "new_to_player" | "already_discovered_by_player" | "none";

export interface InspectionState {
  readonly hasInspectable: boolean;
  readonly hasClue: boolean;
  readonly clueAlreadyDiscoveredInTown: boolean;
  readonly clueAlreadyDiscoveredByThisPlayer: boolean;
}

/** Matches the HTTP contract's `inspect` result exactly. */
export function classifyInspectDiscovery(state: InspectionState): InspectDiscovery {
  if (!state.hasInspectable || !state.hasClue) return "none";
  if (state.clueAlreadyDiscoveredByThisPlayer) return "already_discovered_by_player";
  if (state.clueAlreadyDiscoveredInTown) return "new_to_player";
  return "new_to_town";
}

/** Only a genuinely new discovery for this player is worth recording — no repeat write. */
export function shouldRecordClueDiscovery(discovery: InspectDiscovery): boolean {
  return discovery === "new_to_town" || discovery === "new_to_player";
}

export interface ClueDiscoveryRecord {
  readonly playerId: string;
  readonly discoverySequence: number;
}

/** The player whose discovery has the lowest sequence number gets board attribution. */
export function firstDiscoverer(
  discoveries: readonly ClueDiscoveryRecord[],
): ClueDiscoveryRecord | undefined {
  return discoveries.toSorted(
    (left, right) => left.discoverySequence - right.discoverySequence,
  )[0];
}

// --- Item custody ---------------------------------------------------------------

export type ItemCustody =
  | { readonly kind: "player_inventory" }
  | { readonly kind: "location"; readonly locationId: string };

export interface ItemCustodyState {
  readonly heldByActorId: string | null;
  readonly locationEntityId: string | null;
}

export function custodyFor(item: ItemCustodyState): ItemCustody {
  if (item.heldByActorId !== null) return { kind: "player_inventory" };
  return { kind: "location", locationId: item.locationEntityId ?? "" };
}

// --- Show authorization and structured effect -----------------------------------

export interface ShowAuthorizationInputs {
  readonly clueDiscoveredInTown: boolean;
  readonly itemCurrentlyHeldByPlayer: boolean;
}

/** `Show` is authorized by a town-discovered clue, or a currently-held item. */
export function isShowAuthorized(
  evidenceKind: "clue" | "item",
  inputs: ShowAuthorizationInputs,
): boolean {
  return evidenceKind === "clue"
    ? inputs.clueDiscoveredInTown
    : inputs.itemCurrentlyHeldByPlayer;
}

export interface ClueClaimEffectLink {
  readonly clueId: string;
  readonly claimId: string;
}

export interface ShowStructuredEffectPlan {
  readonly structuredEffect: "applied" | "none";
  readonly appliedClueIds: readonly string[];
}

/**
 * Matches `structuredEffect: applied | none` and the sorted,
 * nonempty-iff-applied `appliedClueIds`: a `Show` produces a structured
 * effect only through real `clue_claim_effects` linkage, never from the
 * clue's mere presentation.
 */
export function planShowStructuredEffect(
  shownClueIds: readonly string[],
  effects: readonly ClueClaimEffectLink[],
): ShowStructuredEffectPlan {
  const linkedClueIds = new Set(effects.map((effect) => effect.clueId));
  const appliedClueIds = [
    ...new Set(shownClueIds.filter((id) => linkedClueIds.has(id))),
  ].toSorted();
  return {
    structuredEffect: appliedClueIds.length > 0 ? "applied" : "none",
    appliedClueIds,
  };
}

// --- Give custody transfer -------------------------------------------------------

export interface GiveInputs {
  readonly itemHeldByPlayer: boolean;
  readonly npcAcceptsItem: boolean;
}

export function planGiveCustody(inputs: GiveInputs): "transferred" | "unchanged" {
  return inputs.itemHeldByPlayer && inputs.npcAcceptsItem ? "transferred" : "unchanged";
}

// --- Chapel access (Decision 009) -------------------------------------------------

/**
 * Either holding the physical key or holding the `enter_old_chapel`
 * capability suffices — the two routes are independent and neither is
 * primary.
 */
export function hasChapelAccess(
  holdsChapelKey: boolean,
  hasEnterChapelCapability: boolean,
): boolean {
  return holdsChapelKey || hasEnterChapelCapability;
}

/** Nessa's key-loan gate (Route A). */
export function nessaKeyLoanEligible(trust: number, suspicion: number): boolean {
  const { minimumTrust, maximumSuspicionExclusive } =
    RULES_REGISTRY.chapelAccess.nessaRouteA;
  return trust >= minimumTrust && suspicion < maximumSuspicionExclusive;
}

/**
 * Corin's capability grant (Route B): a required clue presented this action,
 * evaluated against the *post-action* trust/suspicion — note the
 * asymmetric suspicion ceiling versus Route A (`< 20` here, `< 40` there) is
 * intentional, not a typo to reconcile. Once granted, the capability row
 * simply exists — nothing in this module (or any caller of
 * `hasChapelAccess`) ever re-evaluates trust to revoke it, which is what
 * makes the grant permanent.
 */
export function corinCapabilityGrantEligible(
  presentedRequiredClueThisAction: boolean,
  postActionTrust: number,
  postActionSuspicion: number,
): boolean {
  if (!presentedRequiredClueThisAction) return false;
  const { minimumTrust, maximumSuspicionExclusive } =
    RULES_REGISTRY.chapelAccess.corinRouteB;
  return (
    postActionTrust >= minimumTrust && postActionSuspicion < maximumSuspicionExclusive
  );
}
