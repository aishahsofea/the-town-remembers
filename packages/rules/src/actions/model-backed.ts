/**
 * Pure planners for `http-contracts#MODEL_BACKED_ACTION_KINDS`
 * (`ask`/`normalize_claim`/`tell`/`show`/`give`/`accept_promise`): each
 * validates authority and computes deterministic effects, then hands the
 * bounded `ApprovedDisclosureBundle` to the caller as
 * `external_selection_required` rather than calling a model itself.
 */

import type { RelationshipReasonKind } from "@the-town-remembers/database/domains";

import { buildApprovedDisclosureBundle } from "../disclosure/bundle.js";
import type {
  ApprovedDisclosureBundle,
  ApprovedEpisodeSummary,
  ApprovedOutcome,
  DisclosureCandidateInput,
} from "../disclosure/bundle.js";
import { sumRelationshipDeltas } from "../beliefs/relationships.js";
import { deniedResult } from "../kernel/decision.js";
import type { EffectPlanEntry } from "../kernel/effects.js";
import {
  isShowAuthorized,
  planGiveCustody,
  planShowStructuredEffect,
  type ClueClaimEffectLink,
} from "../world/clues.js";
import { type ActionPlanResult, dispatcherTrace as makeTrace } from "./dispatcher.js";

export interface DisclosureBundleInputs {
  readonly disclosureCandidates: readonly DisclosureCandidateInput[];
  readonly requiredDisclosureIds: readonly string[];
  readonly approvedOutcomes: readonly ApprovedOutcome[];
  readonly requiredOutcomeIds: readonly string[];
  readonly approvedEpisodes: readonly ApprovedEpisodeSummary[];
}

function buildBundle(inputs: DisclosureBundleInputs): ApprovedDisclosureBundle {
  return buildApprovedDisclosureBundle(
    inputs.disclosureCandidates,
    inputs.requiredDisclosureIds,
    inputs.approvedOutcomes,
    inputs.requiredOutcomeIds,
    inputs.approvedEpisodes,
  );
}

// --- ask --------------------------------------------------------------------------------

export interface AskInputs extends DisclosureBundleInputs {
  readonly npcPresent: boolean;
}

export function planAsk(inputs: AskInputs): ActionPlanResult {
  const trace = makeTrace("actions.ask");
  if (!inputs.npcPresent) return deniedResult("NPC_NOT_PRESENT", trace, {});
  return {
    kind: "external_selection_required",
    effects: [],
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- normalize_claim -----------------------------------------------------------------------

export interface NormalizeClaimInputs extends DisclosureBundleInputs {
  readonly npcPresent: boolean;
}

export function planNormalizeClaim(inputs: NormalizeClaimInputs): ActionPlanResult {
  const trace = makeTrace("actions.normalize_claim");
  if (!inputs.npcPresent) return deniedResult("NPC_NOT_PRESENT", trace, {});
  return {
    kind: "external_selection_required",
    effects: [],
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- tell -------------------------------------------------------------------------------------

export interface TellInputs extends DisclosureBundleInputs {
  readonly claimDraftExists: boolean;
  readonly claimDraftExpired: boolean;
  readonly claimDraftAlreadyConfirmed: boolean;
}

export function planTell(inputs: TellInputs): ActionPlanResult {
  const trace = makeTrace("actions.tell");
  if (!inputs.claimDraftExists) return deniedResult("CLAIM_DRAFT_NOT_FOUND", trace, {});
  if (inputs.claimDraftExpired) return deniedResult("CLAIM_DRAFT_EXPIRED", trace, {});
  if (inputs.claimDraftAlreadyConfirmed) {
    return deniedResult("CLAIM_DRAFT_ALREADY_CONFIRMED", trace, {});
  }

  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "claim_transmitted", effectIndex: 0 },
  ];
  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- show -------------------------------------------------------------------------------------

export interface ShowInputs extends DisclosureBundleInputs {
  readonly evidenceKind: "clue" | "item";
  readonly clueDiscoveredInTown: boolean;
  readonly itemCurrentlyHeldByPlayer: boolean;
  readonly shownClueIds: readonly string[];
  readonly clueClaimEffects: readonly ClueClaimEffectLink[];
  readonly relationshipReasons: readonly RelationshipReasonKind[];
}

export function planShow(inputs: ShowInputs): ActionPlanResult {
  const trace = makeTrace("actions.show");
  if (
    !isShowAuthorized(inputs.evidenceKind, {
      clueDiscoveredInTown: inputs.clueDiscoveredInTown,
      itemCurrentlyHeldByPlayer: inputs.itemCurrentlyHeldByPlayer,
    })
  ) {
    return deniedResult("EVIDENCE_NOT_AUTHORIZED", trace, {});
  }

  const structuredEffectPlan = planShowStructuredEffect(
    inputs.shownClueIds,
    inputs.clueClaimEffects,
  );
  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "evidence_shown", effectIndex: 0 },
  ];
  if (structuredEffectPlan.structuredEffect === "applied") {
    effects.push({
      kind: "insert",
      table: "clue_claim_effects",
      row: { clue_ids: structuredEffectPlan.appliedClueIds },
    });
  }
  if (inputs.relationshipReasons.length > 0) {
    const delta = sumRelationshipDeltas(inputs.relationshipReasons);
    effects.push({
      kind: "insert",
      table: "relationship_changes",
      row: { trust_delta: delta.trust, suspicion_delta: delta.suspicion },
    });
  }

  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- give -------------------------------------------------------------------------------------

export interface GiveActionInputs extends DisclosureBundleInputs {
  readonly npcPresent: boolean;
  readonly itemHeldByPlayer: boolean;
  readonly npcAcceptsItem: boolean;
  readonly itemId: string;
  readonly relationshipReasons: readonly RelationshipReasonKind[];
}

export function planGive(inputs: GiveActionInputs): ActionPlanResult {
  const trace = makeTrace("actions.give", [inputs.itemId]);
  if (!inputs.npcPresent) return deniedResult("NPC_NOT_PRESENT", trace, {});
  if (!inputs.itemHeldByPlayer) return deniedResult("ITEM_NOT_HELD", trace, {});

  const custody = planGiveCustody({
    itemHeldByPlayer: inputs.itemHeldByPlayer,
    npcAcceptsItem: inputs.npcAcceptsItem,
  });
  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "item_transferred", effectIndex: 0 },
  ];
  if (custody === "transferred") {
    effects.push({
      kind: "conditional_state_change",
      table: "items",
      key: { id: inputs.itemId },
      expectedRevision: 0,
      change: { held_by_actor_id: null },
    });
  }
  if (inputs.relationshipReasons.length > 0) {
    const delta = sumRelationshipDeltas(inputs.relationshipReasons);
    effects.push({
      kind: "insert",
      table: "relationship_changes",
      row: { trust_delta: delta.trust, suspicion_delta: delta.suspicion },
    });
  }

  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- accept_promise -----------------------------------------------------------------------------

export interface AcceptPromiseInputs extends DisclosureBundleInputs {
  readonly offerIsValid: boolean;
  readonly hasActivePromiseAlready: boolean;
}

export function planAcceptPromise(inputs: AcceptPromiseInputs): ActionPlanResult {
  const trace = makeTrace("actions.accept_promise");
  if (!inputs.offerIsValid) return deniedResult("PROMISE_OFFER_INVALID", trace, {});
  if (inputs.hasActivePromiseAlready)
    return deniedResult("PROMISE_ALREADY_ACTIVE", trace, {});

  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "promise_accepted", effectIndex: 0 },
    { kind: "insert", table: "promises", row: { status: "active" } },
  ];
  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}
