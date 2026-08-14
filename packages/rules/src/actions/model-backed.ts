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
import { planCorroborationAdjustment } from "../beliefs/evidence.js";
import {
  aggregateRelationshipUpdates,
  relationshipDeltaFor,
  type RelationshipScores,
} from "../beliefs/relationships.js";
import { deniedResult } from "../kernel/decision.js";
import type { EffectPlanEntry } from "../kernel/effects.js";
import { sumEventContributions } from "../kernel/numeric.js";
import { RULES_REGISTRY } from "../kernel/version.js";
import {
  corinCapabilityGrantEligible,
  isShowAuthorized,
  planGiveCustody,
  planShowStructuredEffect,
  type ClueClaimEffectLink,
} from "../world/clues.js";
import { returnItemTransferOutcome } from "../world/promises.js";
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

/**
 * `tell`'s own deterministic gate (`D4-K`'s `denied_draft_state`, though this
 * planner never actually reaches dialogue selection for these four cases —
 * see the class comment). All four checks are read at `loadInputs` time,
 * before any model call, matching docs/005: "the visit must still be active
 * and co-located with that NPC; changing target or editing the text requires
 * a new draft".
 */
export interface TellInputs extends DisclosureBundleInputs {
  readonly claimDraftExists: boolean;
  readonly claimDraftExpired: boolean;
  readonly claimDraftAlreadyConfirmed: boolean;
  readonly claimDraftWrongNpc: boolean;
}

/**
 * Authority only — `event_origin`, the claim upsert, transmission, episode,
 * evidence, and belief recompute all depend on nothing the model selects, but
 * they live in `applyTellSelection` (`rules/actions/selection.ts`) rather
 * than here, matching every other model-backed planner's split (`planAsk`'s
 * own `effects: []`): the *rich* effects are built once, alongside the
 * `npc_interactions` row they share a conversational turn with, not
 * duplicated across two pure stages.
 *
 * A stale, expired, changed-NPC, or already-confirmed draft is a plain
 * `deniedResult` with no dialogue call at all — docs/005 states plainly that
 * such a draft "creates no claim transmission" and, by the same reasoning,
 * no `npc_interactions` row either, so there is nothing for a model to react
 * to. `D4-K`'s `denied_draft_state` gate result is therefore not produced by
 * this corpus's `tell`: it stays reserved for a future caller that routes a
 * draft-state failure through dialogue instead.
 */
export function planTell(inputs: TellInputs): ActionPlanResult {
  const trace = makeTrace("actions.tell");
  if (!inputs.claimDraftExists) return deniedResult("CLAIM_DRAFT_NOT_FOUND", trace, {});
  if (inputs.claimDraftExpired) return deniedResult("CLAIM_DRAFT_EXPIRED", trace, {});
  if (inputs.claimDraftWrongNpc) return deniedResult("CLAIM_DRAFT_WRONG_NPC", trace, {});
  if (inputs.claimDraftAlreadyConfirmed) {
    return deniedResult("CLAIM_DRAFT_ALREADY_CONFIRMED", trace, {});
  }

  return {
    kind: "external_selection_required",
    effects: [],
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
/** `exists: false` means no `npc_beliefs` row has ever been written for this (npc, claim) pair — `score`/`revision` are then unused placeholders. */
export interface ShowClaimBeliefState {
  readonly claimId: string;
  readonly exists: boolean;
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
  readonly npcPresent: boolean;
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
  /**
   * Present only for a claim this exact Show's `lie_established` reason
   * newly caught (`rules/world/lies.ts#establishesKnowingLie`). The loader
   * pre-scopes `activeContributions` to exactly this (npc, claim, player) —
   * `scopedSourceDiscreditedTarget`'s own scoping — so this planner never
   * reaches for a wider set itself.
   */
  readonly sourceReversals?: readonly ShowSourceReversal[];
  /** Present only when this NPC is the one authored route-B capability grantor. */
  readonly capabilityGrant?: ShowCapabilityGrant;
}

/** One active contribution eligible for exact-opposite reversal. */
export interface ShowSourceReversalContribution {
  readonly evidenceId: string;
  readonly signedWeight: number;
}

/**
 * `D2-J`'s knowing-lie consequence for one caught claim: the discredited
 * player's own active contribution(s) to `claimId` on this NPC (never a
 * different claim or a different NPC — Decision 008's "knowledge does not
 * teleport"), plus the independent-source counts needed to append the
 * resulting corroboration delta.
 */
export interface ShowSourceReversal {
  readonly claimId: string;
  readonly activeContributions: readonly ShowSourceReversalContribution[];
  readonly priorIndependentSourceCount: number;
  readonly newIndependentSourceCount: number;
}

/**
 * Corin's route-B chapel capability (`rules/world/clues.ts#corinCapabilityGrantEligible`).
 * The loader supplies this only when the shown NPC is the authored grantor;
 * `alreadyGranted` lets this stay idempotent without a second DB read here.
 */
export interface ShowCapabilityGrant {
  readonly capabilityKey: string;
  readonly alreadyGranted: boolean;
  readonly presentedRequiredClueThisAction: boolean;
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
  if (!inputs.npcPresent) return deniedResult("NPC_NOT_PRESENT", trace, {});
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
    {
      kind: "event_origin",
      eventType: "evidence_shown",
      effectIndex: 0,
      ref: "evidence-shown",
    },
  ];
  const beliefByClaimId = new Map(
    inputs.claimBeliefs.map((belief) => [belief.claimId, belief]),
  );
  const contributions: ShowScoreContribution[] = [];
  const affectedClaimIds = new Set<string>();

  if (structuredEffectPlan.structuredEffect === "applied") {
    const appliedClueIds = new Set(structuredEffectPlan.appliedClueIds);
    const alreadyRecordedKeys = new Set(
      inputs.alreadyRecordedEvidence.map((entry) => `${entry.claimId}:${entry.clueId}`),
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
      affectedClaimIds.add(link.claimId);
      contributions.push({ claimId: link.claimId, delta: link.signedWeight });
    }
  }

  // `D2-J`: reversing the discredited player's own active contribution(s) to
  // a caught claim, plus the resulting corroboration delta — scoped to
  // exactly the claim `relationshipReasons` cited a `lie_established` row
  // for, never a wider set (docs/008: "knowledge does not teleport").
  for (const reversal of inputs.sourceReversals ?? []) {
    affectedClaimIds.add(reversal.claimId);
    for (const contribution of reversal.activeContributions.toSorted((left, right) =>
      left.evidenceId.localeCompare(right.evidenceId),
    )) {
      effects.push({
        kind: "insert",
        table: "belief_evidence",
        row: {
          npc_id: inputs.npcId,
          claim_id: reversal.claimId,
          evidence_kind: "source_reversal",
          signed_weight: -contribution.signedWeight,
          reverses_evidence_id: contribution.evidenceId,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      });
      contributions.push({ claimId: reversal.claimId, delta: -contribution.signedWeight });
    }
    // `causalEventId` on the returned plan entry is never read below — this
    // planner builds the `belief_evidence` row itself and lets
    // `EVENT_FOREIGN_KEY_COLUMN` backfill `event_id` from the plan's own
    // `evidence_shown` event, exactly like every other row here.
    const corroboration = planCorroborationAdjustment(
      inputs.npcId,
      reversal.claimId,
      reversal.priorIndependentSourceCount,
      reversal.newIndependentSourceCount,
      "evidence-shown",
    );
    if (corroboration !== undefined) {
      effects.push({
        kind: "insert",
        table: "belief_evidence",
        row: {
          npc_id: inputs.npcId,
          claim_id: reversal.claimId,
          evidence_kind: "corroboration",
          signed_weight: corroboration.signedWeight,
          corroboration_threshold: reversal.newIndependentSourceCount,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      });
      contributions.push({
        claimId: reversal.claimId,
        delta: corroboration.signedWeight,
      });
    }
  }

  if (affectedClaimIds.size > 0) {
    // Every affected claim's pre-effect score seeds its own contribution
    // list, so a claim touched by more than one source (a direct link, a
    // reversal, a corroboration delta) is still summed against one snapshot
    // and clamped exactly once.
    for (const claimId of affectedClaimIds) {
      const belief = beliefByClaimId.get(claimId);
      if (belief?.exists) contributions.push({ claimId, delta: belief.score });
    }
    const newScoresByClaimId = sumEventContributions(
      contributions,
      (contribution) => contribution.claimId,
      (contribution) => contribution.delta,
    );

    for (const claimId of [...affectedClaimIds].toSorted()) {
      const belief = beliefByClaimId.get(claimId);
      const newScore = newScoresByClaimId.get(claimId);
      if (belief === undefined || newScore === undefined) continue;
      if (belief.exists) {
        effects.push({
          kind: "conditional_state_change",
          table: "npc_beliefs",
          key: { npc_id: inputs.npcId, claim_id: claimId },
          expectedRevision: belief.revision,
          change: {
            score: newScore,
            label: beliefLabelFor(newScore),
          },
        });
      } else {
        effects.push({
          kind: "insert",
          table: "npc_beliefs",
          row: {
            npc_id: inputs.npcId,
            claim_id: claimId,
            score: newScore,
            label: beliefLabelFor(newScore),
          },
        });
      }
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
  const relationshipSnapshot = {
    npcId: inputs.npcId,
    playerId: inputs.playerId,
    ...inputs.relationship,
  };
  const relationshipContributions = inputs.relationshipReasons.map((reason) => ({
    npcId: inputs.npcId,
    playerId: inputs.playerId,
    reasonKind: reason.reasonKind,
  }));
  const relationshipAggregate = aggregateRelationshipUpdates(
    [relationshipSnapshot],
    relationshipContributions,
  )[0];
  effects.push(
    ...(relationshipAggregate === undefined
      ? []
      : [
          {
            kind: "conditional_state_change" as const,
            table: "npc_player_relationships",
            key: { npc_id: inputs.npcId, player_id: inputs.playerId },
            expectedRevision: relationshipAggregate.expectedRevision,
            change: {
              trust_score: relationshipAggregate.trustScore,
              suspicion_score: relationshipAggregate.suspicionScore,
              updated_event_id: { $planRef: "evidence-shown" },
            },
          },
        ]),
  );

  const grant = inputs.capabilityGrant;
  if (grant !== undefined && !grant.alreadyGranted) {
    const postActionTrust = relationshipAggregate?.trustScore ?? inputs.relationship.trustScore;
    const postActionSuspicion =
      relationshipAggregate?.suspicionScore ?? inputs.relationship.suspicionScore;
    if (
      corinCapabilityGrantEligible(
        grant.presentedRequiredClueThisAction,
        postActionTrust,
        postActionSuspicion,
      )
    ) {
      effects.push({
        kind: "insert",
        table: "player_capabilities",
        row: {
          player_id: inputs.playerId,
          capability_key: grant.capabilityKey,
          status: "granted",
        },
      });
    }
  }

  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- give -------------------------------------------------------------------------------------

/**
 * An active `return_item` promise this exact item resolves, present only
 * when `itemId` matches its subject. `promiseNpcId` is the promise's own
 * NPC (who it was accepted from) — fulfilled iff this Give's recipient is
 * that same NPC, broken for any other recipient (docs/009 "Return the
 * chapel key"), never for the transfer to fail: custody still moves either
 * way, only the promise's terminal state differs.
 */
export interface GivePromiseResolution {
  readonly promiseId: string;
  readonly promiseNpcId: string;
  readonly relationship: RelationshipScores;
}

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
  readonly promiseResolution?: GivePromiseResolution;
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
    {
      kind: "event_origin",
      eventType: "item_transferred",
      effectIndex: 0,
      ref: "give-transfer",
    },
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
  if (inputs.relationshipReasons.length > 0) {
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
        { $planRef: "give-transfer" },
      ),
    );
  }

  const resolution = inputs.promiseResolution;
  if (custody === "transferred" && resolution !== undefined) {
    const transferOutcome = returnItemTransferOutcome(
      resolution.promiseNpcId,
      inputs.recipientActorId,
    );
    const reasonKind =
      transferOutcome === "fulfilled"
        ? ("promise_fulfilled" as const)
        : ("promise_broken" as const);
    const delta = relationshipDeltaFor(reasonKind);
    effects.push(
      {
        kind: "event_origin",
        eventType: reasonKind,
        effectIndex: 1,
        ref: "give-promise-event",
        metadata: {
          actorId: inputs.playerId,
          targetActorId: resolution.promiseNpcId,
          promiseId: resolution.promiseId,
        },
      },
      {
        kind: "conditional_state_change",
        table: "promises",
        key: { id: resolution.promiseId, status: "active" },
        change: {
          status: reasonKind === "promise_fulfilled" ? "fulfilled" : "broken",
          resolved_event_id: { $planRef: "give-promise-event" },
        },
      },
      {
        kind: "insert",
        table: "relationship_changes",
        row: {
          npc_id: resolution.promiseNpcId,
          player_id: inputs.playerId,
          reason_kind: reasonKind,
          rule_version: RULES_REGISTRY.rulesVersion,
          promise_id: resolution.promiseId,
          trust_delta: delta.trust,
          suspicion_delta: delta.suspicion,
        },
      },
      ...relationshipStateChangeEffects(
        [
          {
            npcId: resolution.promiseNpcId,
            playerId: inputs.playerId,
            ...resolution.relationship,
          },
        ],
        [{ npcId: resolution.promiseNpcId, playerId: inputs.playerId, reasonKind }],
        { $planRef: "give-promise-event" },
      ),
    );
  }

  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}

// --- accept_promise -----------------------------------------------------------------------------

/** Present only when accepting transfers custody of an item (the chapel-key loan). */
export interface AcceptPromiseItemTransfer {
  readonly itemId: string;
  readonly itemRevision: number;
}

export interface AcceptPromiseInputs extends DisclosureBundleInputs {
  readonly offerIsValid: boolean;
  readonly hasActivePromiseAlready: boolean;
  readonly npcId: string;
  readonly playerId: string;
  readonly kind: "keep_secret" | "return_item";
  readonly termsVersion: string;
  readonly protectedClaimId?: string;
  readonly itemTransfer?: AcceptPromiseItemTransfer;
}

export function planAcceptPromise(inputs: AcceptPromiseInputs): ActionPlanResult {
  const trace = makeTrace("actions.accept_promise");
  if (!inputs.offerIsValid) return deniedResult("PROMISE_OFFER_INVALID", trace, {});
  if (inputs.hasActivePromiseAlready)
    return deniedResult("PROMISE_ALREADY_ACTIVE", trace, {});

  const effects: EffectPlanEntry[] = [
    {
      kind: "event_origin",
      eventType: "promise_accepted",
      effectIndex: 0,
      ref: "accept-promise-event",
      metadata: { actorId: inputs.playerId, targetActorId: inputs.npcId },
    },
    {
      kind: "insert",
      table: "promises",
      ref: "accepted-promise",
      row: {
        npc_id: inputs.npcId,
        player_id: inputs.playerId,
        kind: inputs.kind,
        protected_claim_id: inputs.kind === "keep_secret" ? inputs.protectedClaimId : null,
        item_id: inputs.kind === "return_item" ? inputs.itemTransfer?.itemId : null,
        status: "active",
        terms_version: inputs.termsVersion,
      },
    },
  ];
  if (inputs.itemTransfer !== undefined) {
    effects.push({
      kind: "conditional_state_change",
      table: "items",
      key: { id: inputs.itemTransfer.itemId },
      expectedRevision: inputs.itemTransfer.itemRevision,
      change: { held_by_actor_id: inputs.playerId },
    });
  }
  return {
    kind: "external_selection_required",
    effects,
    trustedContext: buildBundle(inputs),
    trace,
  };
}
