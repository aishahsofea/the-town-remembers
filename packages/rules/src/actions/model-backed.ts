/**
 * Pure planners for `http-contracts#MODEL_BACKED_ACTION_KINDS`
 * (`ask`/`normalize_claim`/`tell`/`show`/`give`/`accept_promise`): each
 * validates authority and computes deterministic effects, then hands the
 * bounded `ApprovedDisclosureBundle` to the caller as
 * `external_selection_required` rather than calling a model itself.
 */

import { buildApprovedDisclosureBundle } from "../disclosure/bundle.js";
import type {
  ApprovedDisclosureBundle,
  ApprovedEpisodeSummary,
  ApprovedOutcome,
  DisclosureCandidateInput,
} from "../disclosure/bundle.js";
import { beliefLabelFor } from "../beliefs/labels.js";
import {
  relationshipDeltaFor,
  type RelationshipScores,
} from "../beliefs/relationships.js";
import { deniedResult } from "../kernel/decision.js";
import type { EffectPlanEntry } from "../kernel/effects.js";
import { sumEventContributions } from "../kernel/numeric.js";
import { RULES_REGISTRY } from "../kernel/version.js";
import {
  isShowAuthorized,
  planGiveCustody,
  planShowStructuredEffect,
  type ClueClaimEffectLink,
} from "../world/clues.js";
import { type ActionPlanResult, dispatcherTrace as makeTrace } from "./dispatcher.js";
import { relationshipStateChangeEffects } from "./relationship-effects.js";

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

/**
 * One authored `clue_claim_effects` linkage: a clue may support or
 * contradict several claims at once, so a single `clueId` can appear more
 * than once across this list, each with a different `claimId`.
 */
export interface ShowClueEvidenceLink extends ClueClaimEffectLink {
  readonly signedWeight: number;
}

/** Already-recorded evidence for one (npc, claim, clue) triple, so a repeat Show is skipped. */
export interface ShowAlreadyRecordedEvidence {
  readonly claimId: string;
  readonly clueId: string;
}

/** The listening NPC's current belief state on one claim, prior to this Show. */
export interface ShowClaimBeliefState {
  readonly claimId: string;
  readonly score: number;
  readonly revision: number;
}

/**
 * The three reasons a `Show` can produce, each carrying exactly the keys
 * `ck_relationship_changes__shape` requires of it — a discriminated union
 * rather than optional fields, so a row that would violate the constraint
 * cannot be constructed in the first place.
 */
export type ShowRelationshipReason =
  | {
      readonly reasonKind: "verified_testimony";
      readonly claimId: string;
      readonly clueId: string;
      readonly sourceRootTransmissionId: string;
    }
  | { readonly reasonKind: "evidence_presented"; readonly clueId: string }
  | {
      readonly reasonKind: "lie_established";
      readonly claimId: string;
      readonly sourceRootTransmissionId: string;
    };

export interface ShowInputs extends DisclosureBundleInputs {
  readonly evidenceKind: "clue" | "item";
  readonly clueDiscoveredInTown: boolean;
  readonly itemCurrentlyHeldByPlayer: boolean;
  readonly shownClueIds: readonly string[];
  readonly clueClaimEffects: readonly ShowClueEvidenceLink[];
  readonly alreadyRecordedEvidence: readonly ShowAlreadyRecordedEvidence[];
  readonly claimBeliefs: readonly ShowClaimBeliefState[];
  readonly relationshipReasons: readonly ShowRelationshipReason[];
  /**
   * The listening NPC's current relationship scores with this player,
   * advanced by this plan. The pair is already named by `npcId`/`playerId`,
   * so it cannot disagree with the row this plan writes.
   */
  readonly relationship: RelationshipScores;
  readonly playerId: string;
  /** The NPC being shown evidence. */
  readonly npcId: string;
  /** The pre-allocated id of the `evidence_shown` event this plan creates. */
  readonly evidenceShownEventId: string;
}

/** The reason-specific provenance columns, keyed off the discriminant. */
function relationshipProvenanceFor(
  reason: ShowRelationshipReason,
): Readonly<Record<string, string | null>> {
  switch (reason.reasonKind) {
    case "verified_testimony":
      return {
        claim_id: reason.claimId,
        clue_id: reason.clueId,
        source_root_transmission_id: reason.sourceRootTransmissionId,
      };
    case "evidence_presented":
      return { claim_id: null, clue_id: reason.clueId };
    case "lie_established":
      return {
        claim_id: reason.claimId,
        clue_id: null,
        source_root_transmission_id: reason.sourceRootTransmissionId,
      };
  }
}

interface ShowScoreContribution {
  readonly claimId: string;
  readonly delta: number;
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
    const appliedClueIds = new Set(structuredEffectPlan.appliedClueIds);
    const alreadyRecordedKeys = new Set(
      inputs.alreadyRecordedEvidence.map((entry) => `${entry.claimId}:${entry.clueId}`),
    );
    const beliefByClaimId = new Map(
      inputs.claimBeliefs.map((belief) => [belief.claimId, belief]),
    );

    // A clue can support or contradict several claims, so every matching
    // link is applied — not just the first one found for its clue.
    const newLinks = inputs.clueClaimEffects
      .filter((link) => appliedClueIds.has(link.clueId))
      .filter((link) => !alreadyRecordedKeys.has(`${link.claimId}:${link.clueId}`))
      .toSorted(
        (left, right) =>
          left.claimId.localeCompare(right.claimId) ||
          left.clueId.localeCompare(right.clueId),
      );

    for (const link of newLinks) {
      effects.push({
        kind: "insert",
        table: "belief_evidence",
        row: {
          npc_id: inputs.npcId,
          claim_id: link.claimId,
          clue_id: link.clueId,
          evidence_kind: link.signedWeight < 0 ? "contradiction" : "physical_clue",
          signed_weight: link.signedWeight,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      });
    }

    // Multiple new links to the same claim (from one clue or several) are
    // summed against that claim's pre-effect score from one snapshot and
    // clamped once, never clamped per contribution.
    const affectedClaimIds = [
      ...new Set(newLinks.map((link) => link.claimId)),
    ].toSorted();
    const contributions: ShowScoreContribution[] = [];
    for (const claimId of affectedClaimIds) {
      const belief = beliefByClaimId.get(claimId);
      if (belief === undefined) continue;
      contributions.push({ claimId, delta: belief.score });
    }
    for (const link of newLinks) {
      contributions.push({ claimId: link.claimId, delta: link.signedWeight });
    }
    const newScoresByClaimId = sumEventContributions(
      contributions,
      (contribution) => contribution.claimId,
      (contribution) => contribution.delta,
    );

    for (const claimId of affectedClaimIds) {
      const belief = beliefByClaimId.get(claimId);
      const newScore = newScoresByClaimId.get(claimId);
      if (belief === undefined || newScore === undefined) continue;
      effects.push({
        kind: "conditional_state_change",
        table: "npc_beliefs",
        key: { npc_id: inputs.npcId, claim_id: claimId },
        expectedRevision: belief.revision,
        change: {
          score: newScore,
          label: beliefLabelFor(newScore),
          updated_event_id: inputs.evidenceShownEventId,
        },
      });
    }
  }
  for (const reason of inputs.relationshipReasons) {
    const delta = relationshipDeltaFor(reason.reasonKind);
    effects.push({
      kind: "insert",
      table: "relationship_changes",
      row: {
        npc_id: inputs.npcId,
        player_id: inputs.playerId,
        reason_kind: reason.reasonKind,
        rule_version: RULES_REGISTRY.rulesVersion,
        ...relationshipProvenanceFor(reason),
        trust_delta: delta.trust,
        suspicion_delta: delta.suspicion,
      },
    });
  }
  effects.push(
    ...relationshipStateChangeEffects(
      [{ npcId: inputs.npcId, playerId: inputs.playerId, ...inputs.relationship }],
      inputs.relationshipReasons.map((reason) => ({
        npcId: inputs.npcId,
        playerId: inputs.playerId,
        reasonKind: reason.reasonKind,
      })),
      inputs.evidenceShownEventId,
    ),
  );

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
  readonly itemRevision: number;
  /** The NPC receiving custody on a successful transfer. */
  readonly recipientActorId: string;
  readonly playerId: string;
  /**
   * A Give produces at most `requested_item_given`, whose
   * `ck_relationship_changes__shape` branch takes the item and nothing else.
   * Widening this to every reason kind would let a caller ask for a row this
   * planner cannot fill the provenance columns for.
   */
  readonly relationshipReasons: readonly "requested_item_given"[];
  /** The recipient NPC's current relationship scores with this player. */
  readonly relationship: RelationshipScores;
  /** The pre-allocated id of the `item_transferred` event this plan creates. */
  readonly itemTransferredEventId: string;
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
      expectedRevision: inputs.itemRevision,
      change: { held_by_actor_id: inputs.recipientActorId },
    });
  }
  for (const reasonKind of inputs.relationshipReasons) {
    const delta = relationshipDeltaFor(reasonKind);
    effects.push({
      kind: "insert",
      table: "relationship_changes",
      row: {
        npc_id: inputs.recipientActorId,
        player_id: inputs.playerId,
        reason_kind: reasonKind,
        rule_version: RULES_REGISTRY.rulesVersion,
        item_id: inputs.itemId,
        trust_delta: delta.trust,
        suspicion_delta: delta.suspicion,
      },
    });
  }
  effects.push(
    ...relationshipStateChangeEffects(
      [
        {
          npcId: inputs.recipientActorId,
          playerId: inputs.playerId,
          ...inputs.relationship,
        },
      ],
      inputs.relationshipReasons.map((reasonKind) => ({
        npcId: inputs.recipientActorId,
        playerId: inputs.playerId,
        reasonKind,
      })),
      inputs.itemTransferredEventId,
    ),
  );

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
