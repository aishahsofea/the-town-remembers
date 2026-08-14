/**
 * Deterministic post-selection effects for model-backed actions.
 *
 * The model may select authored renderings, but it never invents causal
 * state. `applyAskSelection` receives only already-validated, real disclosure
 * records and projects their interaction, provenance, board, and memory rows
 * as plain effect data.
 */

import { PROMISE_TERMS } from "@the-town-remembers/content";
import type { PromiseOfferView } from "@the-town-remembers/http-contracts";

import {
  entryKindForSourceKind,
  isBoardEligibleTransmission,
  verificationStatusFor,
} from "../board/provenance.js";
import { mirrorWeightFor, type ClaimRelationKind } from "../claims/relations.js";
import { beliefLabelFor } from "../beliefs/labels.js";
import {
  corroborationWeight,
  playerTestimonyBase,
  testimonyWeight,
} from "../beliefs/evidence.js";
import {
  relationshipDeltaFor,
  type RelationshipSnapshot,
} from "../beliefs/relationships.js";
import type { ApprovedDisclosure } from "../disclosure/bundle.js";
import type { EffectPlanEntry, PlanRef } from "../kernel/effects.js";
import { sumEventContributions } from "../kernel/numeric.js";
import { RULES_REGISTRY } from "../kernel/version.js";
import { importanceMinimumFor } from "../recall/scoring.js";
import {
  encodePromiseOffer,
  hasActivePromise,
  type PromiseKey,
} from "../world/promises.js";
import type { ValidatedDialogueResume } from "./dispatcher.js";
import { relationshipStateChangeEffects } from "./relationship-effects.js";

export interface AskDialogueSelection extends ValidatedDialogueResume {
  /** Real disclosure rows, deduplicated in selected-rendering order. */
  readonly expressedDisclosures: readonly ApprovedDisclosure[];
}

export interface ParentTransmissionProvenance {
  readonly rootTransmissionId: string;
  readonly hopCount: number;
}

export interface AskPromiseOfferState {
  readonly npcKey: string;
  readonly trust: number;
  readonly suspicion: number;
  readonly bellRevealed: boolean;
  readonly activePromises: readonly PromiseKey[];
  readonly oldChapelKey:
    | {
        readonly itemId: string;
        readonly displayName: string;
        readonly heldByActorId: string | null;
      }
    | undefined;
  readonly larkDamageClaim:
    | {
        readonly claimId: string;
        readonly text: string;
        readonly previouslyDisclosedToPlayer: boolean;
      }
    | undefined;
}

export interface ApplyAskSelectionInputs {
  readonly actionId: string;
  readonly visitId: string;
  readonly playerId: string;
  readonly npcId: string;
  readonly npcCharacterEntityId: string;
  readonly locationEntityId: string;
  readonly question: string;
  readonly occurredAt: Date;
  readonly selection: AskDialogueSelection;
  readonly parentTransmissionById: ReadonlyMap<string, ParentTransmissionProvenance>;
}

function interactionSummary(text: string): string {
  return `A visitor asked a question. I replied: ${text}`;
}

/**
 * Derives the ordered, saved offer descriptors produced by one Ask. Offer
 * availability is deterministic state, never a model choice: Nessa's key
 * offer follows the authored custody/relationship/reveal gates, while Mara's
 * secrecy offer is attached only to the first selected confidential disclosure
 * of Lark's claim. P4-16 consumes these retained descriptors when accepting an
 * offer; it must not reconstruct them from then-current content.
 */
export function buildAskPromiseOffers(
  actionId: string,
  npcId: string,
  state: AskPromiseOfferState,
  selection: AskDialogueSelection,
): PromiseOfferView[] {
  const offers: Omit<PromiseOfferView, "offerId" | "sourceActionId" | "ordinal">[] = [];

  const key = state.oldChapelKey;
  if (
    state.npcKey === PROMISE_TERMS.returnChapelKey.npcKey &&
    key !== undefined &&
    key.heldByActorId === npcId &&
    state.trust >= 40 &&
    state.suspicion < 40 &&
    !state.bellRevealed &&
    !hasActivePromise(state.activePromises, {
      npcId,
      kind: PROMISE_TERMS.returnChapelKey.kind,
      protectedItemId: key.itemId,
    })
  ) {
    offers.push({
      npcId,
      kind: PROMISE_TERMS.returnChapelKey.kind,
      termsVersion: PROMISE_TERMS.returnChapelKey.termsVersion,
      summary: PROMISE_TERMS.returnChapelKey.summary,
      subject: {
        kind: "item",
        itemId: key.itemId,
        displayName: key.displayName,
      },
    });
  }

  const claim = state.larkDamageClaim;
  if (
    state.npcKey === PROMISE_TERMS.keepLarkAccidentSecret.npcKey &&
    claim !== undefined &&
    !claim.previouslyDisclosedToPlayer &&
    selection.expressedDisclosures.some(
      (disclosure) =>
        disclosure.claimId === claim.claimId && disclosure.tier === "confidential",
    ) &&
    !hasActivePromise(state.activePromises, {
      npcId,
      kind: PROMISE_TERMS.keepLarkAccidentSecret.kind,
      protectedClaimId: claim.claimId,
    })
  ) {
    offers.push({
      npcId,
      kind: PROMISE_TERMS.keepLarkAccidentSecret.kind,
      termsVersion: PROMISE_TERMS.keepLarkAccidentSecret.termsVersion,
      summary: PROMISE_TERMS.keepLarkAccidentSecret.summary,
      subject: {
        kind: "claim",
        claimId: claim.claimId,
        text: claim.text,
      },
    });
  }

  return offers.map((offer, ordinal) => ({
    ...offer,
    offerId: encodePromiseOffer(actionId, ordinal),
    sourceActionId: actionId,
    ordinal,
  }));
}

/**
 * Applies one accepted Ask selection. Disclosures without either a direct
 * source episode or a repeatable parent transmission remain voiced prose but
 * produce no transmission: a missing provenance row is never fabricated.
 */
export function applyAskSelection(
  inputs: ApplyAskSelectionInputs,
): readonly EffectPlanEntry[] {
  const effects: EffectPlanEntry[] = [
    { kind: "event_origin", eventType: "npc_interaction", effectIndex: 0 },
    {
      kind: "insert",
      table: "npc_interactions",
      ref: "ask-interaction",
      row: {
        player_action_id: inputs.actionId,
        visit_id: inputs.visitId,
        player_id: inputs.playerId,
        npc_id: inputs.npcId,
        input_kind: "ask",
        player_text: inputs.question,
        npc_text: inputs.selection.text,
        response_mode: inputs.selection.responseMode,
      },
    },
  ];

  const expressedClaimIds: string[] = [];
  let ordinal = 0;
  for (const disclosure of inputs.selection.expressedDisclosures) {
    const parent =
      disclosure.parentTransmissionId === null
        ? undefined
        : inputs.parentTransmissionById.get(disclosure.parentTransmissionId);
    const hasDirectSource =
      disclosure.parentTransmissionId === null && disclosure.sourceEpisodeId !== null;

    if (!hasDirectSource && parent === undefined) continue;

    const transmissionRef = `ask-transmission-${ordinal}`;
    const sourceKind = hasDirectSource
      ? ("direct_observation" as const)
      : ("repeated_testimony" as const);
    const hopCount = hasDirectSource ? 0 : parent!.hopCount + 1;
    if (hopCount > 4) continue;

    effects.push({
      kind: "insert",
      table: "claim_transmissions",
      ref: transmissionRef,
      row: {
        claim_id: disclosure.claimId,
        speaker_actor_id: inputs.npcId,
        recipient_actor_id: inputs.playerId,
        recipient_actor_type: "player",
        parent_transmission_id: hasDirectSource
          ? null
          : disclosure.parentTransmissionId,
        parent_is_eligible: hasDirectSource ? null : true,
        root_transmission_id: hasDirectSource
          ? { $planRef: transmissionRef }
          : parent!.rootTransmissionId,
        source_episode_id: hasDirectSource ? disclosure.sourceEpisodeId : null,
        alleged_source_actor_id: null,
        source_kind: sourceKind,
        hop_count: hopCount,
        interaction_id: { $planRef: "ask-interaction" },
        ordinal,
      },
    });

    if (isBoardEligibleTransmission("player", "npc", disclosure.tier)) {
      const entryKind = entryKindForSourceKind(sourceKind);
      effects.push({
        kind: "insert",
        table: "case_board_entries",
        row: {
          entry_kind: entryKind,
          contributed_by_player_id: inputs.playerId,
          clue_id: null,
          claim_id: disclosure.claimId,
          transmission_id: { $planRef: transmissionRef },
          note_text: null,
          verification_status: verificationStatusFor(entryKind),
        },
      });
    }

    expressedClaimIds.push(disclosure.claimId);
    ordinal += 1;
  }

  effects.push({
    kind: "insert",
    table: "episodes",
    ref: "ask-episode",
    row: {
      npc_id: inputs.npcId,
      episode_kind: "player_interaction",
      summary: interactionSummary(inputs.selection.text),
      importance: importanceMinimumFor("ordinary_interaction"),
      occurred_at: inputs.occurredAt,
      embedding_status: "pending",
      updated_at: inputs.occurredAt,
    },
  });
  effects.push(
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "ask-episode" },
        reference_kind: "participant",
        entity_id: inputs.npcCharacterEntityId,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "ask-episode" },
        reference_kind: "location",
        entity_id: inputs.locationEntityId,
      },
    },
  );
  for (const claimId of new Set(expressedClaimIds)) {
    effects.push({
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "ask-episode" },
        reference_kind: "claim",
        claim_id: claimId,
      },
    });
  }

  return effects;
}

// --- tell ---------------------------------------------------------------------------------

export type TellDialogueSelection = ValidatedDialogueResume;

/** One authored `claims` tuple, already normalized by an earlier `normalize_claim` and stored on the confirmed draft. */
export interface TellClaimTuple {
  readonly subjectEntityId: string;
  readonly subjectEntityType: string;
  readonly predicate: string;
  readonly objectEntityId: string;
  readonly objectEntityType: string;
  readonly polarity: string;
  readonly contextKey: string;
  readonly normalizedKey: string;
}

/** Whether a `claims` row for `TellClaimTuple.normalizedKey` already exists — `undefined` `claimId` iff `exists` is `false`. */
export interface TellClaimIdentity extends TellClaimTuple {
  readonly exists: boolean;
  readonly claimId: string | undefined;
}

/** One claim related to the primary told claim via a seeded `claim_relations` row (`D2-Q`; runtime never creates a new relation — see `claims/relations.ts`'s module comment). */
export interface TellRelatedClaim {
  readonly claimId: string;
  readonly relationKind: ClaimRelationKind;
}

/** The current `npc_beliefs` row for one claim (primary or related) — `exists: false` means the first-ever evidence for this pair is about to be written. */
export interface TellClaimBeliefRow {
  readonly claimId: string;
  readonly exists: boolean;
  readonly score: number;
  readonly revision: number;
}

/** Existing primary support mirrored onto a claim whose relation is created by this Tell. */
export interface TellBackfillEvidence {
  readonly evidenceId: string;
  readonly npcId: string;
  readonly sourceClaimId: string;
  readonly signedWeight: number;
}

/** One active keep-secret promise this structured transmission resolves as broken. */
export interface TellBrokenPromise {
  readonly promiseId: string;
  readonly npcId: string;
  readonly relationship: RelationshipSnapshot;
}

export interface ApplyTellSelectionInputs {
  readonly actionId: string;
  readonly visitId: string;
  readonly playerId: string;
  readonly npcId: string;
  readonly npcCharacterEntityId: string;
  readonly locationEntityId: string;
  readonly occurredAt: Date;
  readonly selection: TellDialogueSelection;

  readonly draftId: string;
  readonly claim: TellClaimIdentity;
  readonly canonicalText: string;
  /** Copied verbatim onto the transmission (docs/005) — never inferred from dialogue. */
  readonly allegedSourceActorId: string | null;

  readonly playerTrust: number;
  /**
   * `true` when this exact `(npc, claim, player)` testimony is already an
   * active `belief_evidence` contribution — the same claim told twice by the
   * same player adds no second evidence row (`P4-13` acceptance 3). The
   * claim, transmission, episode, and interaction are still created; only
   * the evidentiary effects below are skipped.
   */
  readonly isRepeatContribution: boolean;
  readonly priorIndependentSourceCount: number;
  readonly newIndependentSourceCount: number;
  readonly relatedClaims: readonly TellRelatedClaim[];
  /** Relations to insert in both directions; populated only when `claim.exists` is false. */
  readonly newRelations: readonly TellRelatedClaim[];
  readonly backfillEvidence: readonly TellBackfillEvidence[];
  /** The primary claim's own row plus every entry of `relatedClaims`, keyed by claim id. */
  readonly beliefStates: readonly TellClaimBeliefRow[];
  readonly brokenPromises: readonly TellBrokenPromise[];
}

function tellInteractionSummary(text: string): string {
  return `A visitor told me something. I said: ${text}`;
}

/** `{ $planRef }` when the claim is new this plan, the real id otherwise — every later reference to the told claim goes through this one helper so the two cases can never drift apart. */
function claimIdReference(claim: TellClaimIdentity): string | PlanRef {
  return claim.exists ? claim.claimId! : { $planRef: "tell-claim" };
}

/**
 * Applies one confirmed `tell`: the claim (upserted by `normalized_key`, at
 * most one new row per never-before-told proposition), the player-to-NPC
 * transmission, the NPC's own `heard_claim` episode, the shared
 * `npc_interactions` turn, and — unless this is a repeat contribution — the
 * testimony evidence, its immediate contradiction mirrors (`D2-Q`), a
 * corroboration adjustment, and the resulting belief recompute for the
 * primary claim and every related claim. Every row here is fully
 * deterministic given the confirmed draft; nothing depends on which
 * rendering the model selected for `selection.text` beyond the text itself.
 */
export function applyTellSelection(
  inputs: ApplyTellSelectionInputs,
): readonly EffectPlanEntry[] {
  const claimRef = claimIdReference(inputs.claim);
  const effects: EffectPlanEntry[] = [];

  if (!inputs.claim.exists) {
    effects.push({
      kind: "insert",
      table: "claims",
      ref: "tell-claim",
      row: {
        subject_entity_id: inputs.claim.subjectEntityId,
        subject_entity_type: inputs.claim.subjectEntityType,
        predicate: inputs.claim.predicate,
        object_entity_id: inputs.claim.objectEntityId,
        object_entity_type: inputs.claim.objectEntityType,
        polarity: inputs.claim.polarity,
        context_key: inputs.claim.contextKey,
        normalized_key: inputs.claim.normalizedKey,
      },
    });
  }

  effects.push({
    kind: "event_origin",
    eventType: "claim_transmitted",
    effectIndex: 0,
    ref: "tell-event",
    metadata: {
      actorId: inputs.playerId,
      targetActorId: inputs.npcId,
      locationEntityId: inputs.locationEntityId,
      claimId: claimRef,
    },
  });

  for (const related of inputs.newRelations.toSorted((left, right) =>
    left.claimId.localeCompare(right.claimId),
  )) {
    effects.push(
      {
        kind: "insert",
        table: "claim_relations",
        row: {
          claim_a_id: claimRef,
          claim_b_id: related.claimId,
          relation_kind: related.relationKind,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      },
      {
        kind: "insert",
        table: "claim_relations",
        row: {
          claim_a_id: related.claimId,
          claim_b_id: claimRef,
          relation_kind: related.relationKind,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      },
    );
  }

  effects.push({
    kind: "insert",
    table: "npc_interactions",
    ref: "tell-interaction",
    row: {
      player_action_id: inputs.actionId,
      visit_id: inputs.visitId,
      player_id: inputs.playerId,
      npc_id: inputs.npcId,
      input_kind: "tell",
      player_text: inputs.canonicalText,
      npc_text: inputs.selection.text,
      response_mode: inputs.selection.responseMode,
    },
  });

  const isAllegedHearsay = inputs.allegedSourceActorId !== null;
  const hopCount = isAllegedHearsay ? 1 : 0;
  effects.push({
    kind: "insert",
    table: "claim_transmissions",
    ref: "tell-transmission",
    row: {
      claim_id: claimRef,
      speaker_actor_id: inputs.playerId,
      recipient_actor_id: inputs.npcId,
      recipient_actor_type: "npc",
      parent_transmission_id: null,
      parent_is_eligible: null,
      root_transmission_id: { $planRef: "tell-transmission" },
      source_episode_id: null,
      alleged_source_actor_id: inputs.allegedSourceActorId,
      source_kind: isAllegedHearsay ? "alleged_hearsay" : "original_assertion",
      hop_count: hopCount,
      interaction_id: { $planRef: "tell-interaction" },
      ordinal: 0,
    },
  });

  effects.push({
    kind: "conditional_state_change",
    table: "claim_drafts",
    key: { id: inputs.draftId, status: "pending" },
    change: {
      status: "confirmed",
      confirmed_by_action_id: inputs.actionId,
      confirmed_claim_id: claimRef,
      updated_at: inputs.occurredAt,
    },
  });

  effects.push({
    kind: "insert",
    table: "episodes",
    ref: "tell-episode",
    row: {
      npc_id: inputs.npcId,
      episode_kind: "heard_claim",
      summary: tellInteractionSummary(inputs.canonicalText),
      importance: importanceMinimumFor(
        hopCount === 0 ? "hop0_heard_testimony" : "hop1_heard_testimony",
      ),
      occurred_at: inputs.occurredAt,
      embedding_status: "pending",
      updated_at: inputs.occurredAt,
    },
  });
  effects.push(
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "tell-episode" },
        reference_kind: "participant",
        entity_id: inputs.npcCharacterEntityId,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "tell-episode" },
        reference_kind: "location",
        entity_id: inputs.locationEntityId,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "tell-episode" },
        reference_kind: "claim",
        claim_id: claimRef,
      },
    },
  );

  const primaryBase = playerTestimonyBase(inputs.playerTrust);
  const primaryWeight = testimonyWeight(primaryBase, hopCount);
  const corroborationDelta = inputs.isRepeatContribution
    ? 0
    : corroborationWeight(inputs.newIndependentSourceCount) -
      corroborationWeight(inputs.priorIndependentSourceCount);

  type BeliefTarget = string | PlanRef;
  interface BeliefContributionTarget {
    readonly npcId: string;
    readonly claimId: BeliefTarget;
    readonly deltas: number[];
  }
  const beliefContributions = new Map<string, BeliefContributionTarget>();
  function contributionKey(npcId: string, claimId: BeliefTarget): string {
    return `${npcId.length}:${npcId}:${typeof claimId === "string" ? claimId : "$tell-claim"}`;
  }
  function addBeliefContribution(npcId: string, claimId: BeliefTarget, delta: number) {
    if (delta === 0) return;
    const key = contributionKey(npcId, claimId);
    const target = beliefContributions.get(key) ?? { npcId, claimId, deltas: [] };
    target.deltas.push(delta);
    beliefContributions.set(key, target);
  }

  // A new deterministic relation must be order-independent: mirror older,
  // unreversed primary support onto the just-created claim before applying
  // this Tell's own testimony.
  for (const support of inputs.backfillEvidence.toSorted(
    (left, right) =>
      left.npcId.localeCompare(right.npcId) ||
      left.evidenceId.localeCompare(right.evidenceId),
  )) {
    effects.push({
      kind: "insert",
      table: "belief_evidence",
      row: {
        npc_id: support.npcId,
        claim_id: claimRef,
        episode_id: null,
        transmission_id: null,
        source_root_transmission_id: null,
        independent_source_actor_id: null,
        corroboration_threshold: null,
        clue_id: null,
        evidence_kind: "contradiction",
        signed_weight: -support.signedWeight,
        trust_snapshot: null,
        hop_count: null,
        mirrors_evidence_id: support.evidenceId,
        reverses_evidence_id: null,
        rule_version: RULES_REGISTRY.rulesVersion,
      },
    });
    addBeliefContribution(support.npcId, claimRef, -support.signedWeight);
  }

  const sortedRelated = inputs.relatedClaims.toSorted((left, right) =>
    left.claimId.localeCompare(right.claimId),
  );

  if (!inputs.isRepeatContribution) {
    effects.push({
      kind: "insert",
      table: "belief_evidence",
      ref: "tell-primary-evidence",
      row: {
        npc_id: inputs.npcId,
        claim_id: claimRef,
        episode_id: null,
        transmission_id: { $planRef: "tell-transmission" },
        source_root_transmission_id: { $planRef: "tell-transmission" },
        independent_source_actor_id: inputs.playerId,
        corroboration_threshold: null,
        clue_id: null,
        evidence_kind: "player_testimony",
        signed_weight: primaryWeight,
        trust_snapshot: inputs.playerTrust,
        hop_count: hopCount,
        mirrors_evidence_id: null,
        reverses_evidence_id: null,
        rule_version: RULES_REGISTRY.rulesVersion,
      },
    });
    addBeliefContribution(inputs.npcId, claimRef, primaryWeight);

    if (corroborationDelta !== 0) {
      effects.push({
        kind: "insert",
        table: "belief_evidence",
        row: {
          npc_id: inputs.npcId,
          claim_id: claimRef,
          episode_id: null,
          transmission_id: null,
          source_root_transmission_id: null,
          independent_source_actor_id: inputs.playerId,
          corroboration_threshold: inputs.newIndependentSourceCount,
          clue_id: null,
          evidence_kind: "corroboration",
          signed_weight: corroborationDelta,
          trust_snapshot: null,
          hop_count: null,
          mirrors_evidence_id: null,
          reverses_evidence_id: null,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      });
      addBeliefContribution(inputs.npcId, claimRef, corroborationDelta);
    }

    for (const related of sortedRelated) {
      const signedWeight = mirrorWeightFor(related.relationKind, primaryWeight);
      if (signedWeight === 0) continue;
      effects.push({
        kind: "insert",
        table: "belief_evidence",
        row: {
          npc_id: inputs.npcId,
          claim_id: related.claimId,
          episode_id: null,
          transmission_id: null,
          source_root_transmission_id: null,
          independent_source_actor_id: null,
          corroboration_threshold: null,
          clue_id: null,
          evidence_kind: "contradiction",
          signed_weight: signedWeight,
          trust_snapshot: null,
          hop_count: null,
          mirrors_evidence_id: { $planRef: "tell-primary-evidence" },
          reverses_evidence_id: null,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      });
      addBeliefContribution(inputs.npcId, related.claimId, signedWeight);
    }
  }

  const beliefByClaimId = new Map(inputs.beliefStates.map((row) => [row.claimId, row]));
  for (const target of [...beliefContributions.values()].toSorted((left, right) =>
    contributionKey(left.npcId, left.claimId).localeCompare(
      contributionKey(right.npcId, right.claimId),
    ),
  )) {
    const state =
      target.npcId === inputs.npcId && typeof target.claimId === "string"
        ? beliefByClaimId.get(target.claimId)
        : undefined;
    const newScore = sumEventContributions(
      [
        ...(state?.exists ? [{ target: "belief", delta: state.score }] : []),
        ...target.deltas.map((delta) => ({ target: "belief", delta })),
      ],
      (contribution) => contribution.target,
      (contribution) => contribution.delta,
    ).get("belief")!;
    if (state?.exists) {
      effects.push({
        kind: "conditional_state_change",
        table: "npc_beliefs",
        key: { npc_id: target.npcId, claim_id: target.claimId },
        expectedRevision: state.revision,
        change: { score: newScore, label: beliefLabelFor(newScore) },
      });
    } else {
      effects.push({
        kind: "insert",
        table: "npc_beliefs",
        row: {
          npc_id: target.npcId,
          claim_id: target.claimId,
          score: newScore,
          label: beliefLabelFor(newScore),
        },
      });
    }
  }

  for (const [index, promise] of inputs.brokenPromises.entries()) {
    const eventRef = `tell-promise-broken-${index}`;
    const eventIdRef = { $planRef: eventRef } as const;
    const delta = relationshipDeltaFor("promise_broken");
    effects.push(
      {
        kind: "event_origin",
        eventType: "promise_broken",
        effectIndex: index + 1,
        ref: eventRef,
        metadata: {
          actorId: inputs.playerId,
          targetActorId: promise.npcId,
          claimId: claimRef,
          promiseId: promise.promiseId,
        },
      },
      {
        kind: "conditional_state_change",
        table: "promises",
        key: { id: promise.promiseId, status: "active" },
        change: {
          status: "broken",
          resolved_event_id: eventIdRef,
          updated_at: inputs.occurredAt,
        },
      },
      {
        kind: "insert",
        table: "relationship_changes",
        row: {
          npc_id: promise.npcId,
          player_id: inputs.playerId,
          event_id: eventIdRef,
          trust_delta: delta.trust,
          suspicion_delta: delta.suspicion,
          reason_kind: "promise_broken",
          claim_id: null,
          clue_id: null,
          item_id: null,
          promise_id: promise.promiseId,
          source_root_transmission_id: null,
          rule_version: RULES_REGISTRY.rulesVersion,
        },
      },
      ...relationshipStateChangeEffects(
        [promise.relationship],
        [
          {
            npcId: promise.npcId,
            playerId: inputs.playerId,
            reasonKind: "promise_broken",
          },
        ],
        eventIdRef,
      ),
    );
  }

  return effects;
}

// --- show ---------------------------------------------------------------------------------

export type ShowDialogueSelection = ValidatedDialogueResume;

export interface ApplyShowSelectionInputs {
  readonly actionId: string;
  readonly visitId: string;
  readonly playerId: string;
  readonly npcId: string;
  readonly npcCharacterEntityId: string;
  readonly locationEntityId: string;
  readonly occurredAt: Date;
  readonly selection: ShowDialogueSelection;
  /** Every claim `planShow` actually recomputed a belief for — the direct link(s) and any caught-lie reversal. */
  readonly affectedClaimIds: readonly string[];
}

function showInteractionSummary(text: string): string {
  return `A visitor showed me evidence. I said: ${text}`;
}

/**
 * The dialogue turn's audit trail and recall memory. `planShow` already
 * computed every causal effect (belief, relationship, capability) before any
 * model call — this only records the conversational exchange itself, sharing
 * the same `evidence_shown` event `planShow` originated rather than raising
 * a second one (`EVENT_FOREIGN_KEY_COLUMN` backfills both inserts' event
 * columns from that one event once this plan's effects are appended after
 * `planShow`'s own).
 */
export function applyShowSelection(
  inputs: ApplyShowSelectionInputs,
): readonly EffectPlanEntry[] {
  const effects: EffectPlanEntry[] = [
    {
      kind: "insert",
      table: "npc_interactions",
      row: {
        player_action_id: inputs.actionId,
        visit_id: inputs.visitId,
        player_id: inputs.playerId,
        npc_id: inputs.npcId,
        input_kind: "show",
        player_text: null,
        npc_text: inputs.selection.text,
        response_mode: inputs.selection.responseMode,
      },
    },
    {
      kind: "insert",
      table: "episodes",
      ref: "show-episode",
      row: {
        npc_id: inputs.npcId,
        episode_kind: "direct_observation",
        summary: showInteractionSummary(inputs.selection.text),
        importance: importanceMinimumFor("direct_observation"),
        occurred_at: inputs.occurredAt,
        embedding_status: "pending",
        updated_at: inputs.occurredAt,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "show-episode" },
        reference_kind: "participant",
        entity_id: inputs.npcCharacterEntityId,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "show-episode" },
        reference_kind: "location",
        entity_id: inputs.locationEntityId,
      },
    },
  ];
  for (const claimId of [...new Set(inputs.affectedClaimIds)].toSorted()) {
    effects.push({
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "show-episode" },
        reference_kind: "claim",
        claim_id: claimId,
      },
    });
  }
  return effects;
}

// --- give ---------------------------------------------------------------------------------

export type GiveDialogueSelection = ValidatedDialogueResume;

export interface ApplyGiveSelectionInputs {
  readonly actionId: string;
  readonly visitId: string;
  readonly playerId: string;
  readonly npcId: string;
  readonly npcCharacterEntityId: string;
  readonly locationEntityId: string;
  readonly itemEntityId: string;
  readonly occurredAt: Date;
  readonly selection: GiveDialogueSelection;
  readonly custodyTransferred: boolean;
  /**
   * Present only when custody transferred and a promise actually resolved
   * this turn. `promiseNpcId` is the promise's own NPC, not necessarily
   * `npcId` — breaking the promise by giving the item to a *different* NPC
   * still records the consequence for the NPC the promise was made to.
   */
  readonly promiseResolution?: {
    readonly outcome: "fulfilled" | "broken";
    readonly promiseNpcId: string;
    readonly promiseNpcCharacterEntityId: string;
  };
}

function giveInteractionSummary(text: string): string {
  return `A visitor offered me an item. I said: ${text}`;
}

/**
 * The dialogue turn's audit trail and recall memory — `planGive` already
 * committed every causal effect (custody, relationship, promise
 * resolution) before any model call. An item transfer and a promise
 * resolution are recorded as two distinct episodes (`item_transfer` /
 * `promise_consequence`) since Decision 008 gives them different importance
 * floors; a declined item produces no episode at all — nothing happened
 * for the NPC to remember.
 */
export function applyGiveSelection(
  inputs: ApplyGiveSelectionInputs,
): readonly EffectPlanEntry[] {
  const effects: EffectPlanEntry[] = [
    {
      kind: "insert",
      table: "npc_interactions",
      row: {
        player_action_id: inputs.actionId,
        visit_id: inputs.visitId,
        player_id: inputs.playerId,
        npc_id: inputs.npcId,
        input_kind: "give",
        player_text: null,
        npc_text: inputs.selection.text,
        response_mode: inputs.selection.responseMode,
      },
    },
  ];

  if (!inputs.custodyTransferred) return effects;

  effects.push(
    {
      kind: "insert",
      table: "episodes",
      ref: "give-transfer-episode",
      row: {
        npc_id: inputs.npcId,
        episode_kind: "item_transfer",
        summary: giveInteractionSummary(inputs.selection.text),
        importance: importanceMinimumFor("unique_item_transfer"),
        occurred_at: inputs.occurredAt,
        embedding_status: "pending",
        updated_at: inputs.occurredAt,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "give-transfer-episode" },
        reference_kind: "participant",
        entity_id: inputs.npcCharacterEntityId,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "give-transfer-episode" },
        reference_kind: "location",
        entity_id: inputs.locationEntityId,
      },
    },
    {
      kind: "insert",
      table: "episode_references",
      row: {
        episode_id: { $planRef: "give-transfer-episode" },
        reference_kind: "item",
        entity_id: inputs.itemEntityId,
      },
    },
  );

  const promiseResolution = inputs.promiseResolution;
  if (promiseResolution !== undefined) {
    effects.push(
      {
        kind: "insert",
        table: "episodes",
        ref: "give-promise-episode",
        row: {
          npc_id: promiseResolution.promiseNpcId,
          episode_kind: "promise_consequence",
          summary: giveInteractionSummary(inputs.selection.text),
          importance: importanceMinimumFor(
            promiseResolution.outcome === "fulfilled"
              ? "fulfilled_promise"
              : "broken_promise",
          ),
          occurred_at: inputs.occurredAt,
          embedding_status: "pending",
          updated_at: inputs.occurredAt,
        },
      },
      {
        kind: "insert",
        table: "episode_references",
        row: {
          episode_id: { $planRef: "give-promise-episode" },
          reference_kind: "participant",
          entity_id: promiseResolution.promiseNpcCharacterEntityId,
        },
      },
    );
  }

  return effects;
}
