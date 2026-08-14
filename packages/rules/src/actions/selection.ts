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
import type { ApprovedDisclosure } from "../disclosure/bundle.js";
import type { EffectPlanEntry } from "../kernel/effects.js";
import { importanceMinimumFor } from "../recall/scoring.js";
import {
  encodePromiseOffer,
  hasActivePromise,
  type PromiseKey,
} from "../world/promises.js";
import type { ValidatedDialogueResume } from "./dispatcher.js";

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
