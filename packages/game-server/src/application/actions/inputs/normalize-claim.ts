/**
 * `normalize_claim`'s narrow Observe -> Decide -> Select -> Persist
 * composition (`P4-12`). Unlike `ask`, there is no disclosure bundle and no
 * NPC dialogue: the model classifies one player utterance into a bounded
 * claim tuple, a clarification request, or an unsupported result, and the
 * only persisted effect on success is one ten-minute `claim_drafts` row.
 * `planNormalizeClaim` (`rules/actions/model-backed.ts`) still requires a
 * `DisclosureBundleInputs` shape structurally (the six model-backed kinds
 * share one planner return type) — this loader satisfies it with the empty
 * bundle it actually has, and `runModelSelection` never reads
 * `pending.trustedContext`.
 */

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";
import type { EntityType } from "@the-town-remembers/content";
import {
  ClaimTextSchema,
  type ActionResultByKind,
} from "@the-town-remembers/http-contracts";
import {
  CLAIM_PREDICATE_SIGNATURE_ENTRIES,
  type ClaimNormalizationTrustedContext,
  type ClaimPredicate,
} from "@the-town-remembers/model-runtime";
import {
  planNormalizeClaim,
  type NormalizeClaimInputs,
  type ReasonCode,
  type ValidatedDialogueResume,
} from "@the-town-remembers/rules";
import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import {
  isCoLocated,
  readActiveVisitLocation,
  readNpcSnapshot,
  type NpcSnapshot,
} from "../../../persistence/npc-state.js";
import type { LoadInputsContext } from "../executor.js";
import type { ModelActionHandler, RunModelSelectionParams } from "../model-executor.js";

export type NormalizeClaimOutcome =
  | {
      readonly kind: "normalized";
      readonly subjectEntityId: string;
      readonly subjectEntityType: EntityType;
      readonly predicate: ClaimPredicate;
      readonly objectEntityId: string;
      readonly objectEntityType: EntityType;
      readonly polarity: "positive" | "negative";
      readonly contextKey: string;
      readonly normalizedKey: string;
      readonly allegedSource: {
        readonly id: string;
        readonly displayName: string;
      } | null;
      readonly canonicalText: string;
      readonly expiresAt: Date;
    }
  | {
      readonly kind: "needs_revision";
      readonly explanation: string;
    };

export interface NormalizeClaimSelection extends ValidatedDialogueResume {
  readonly outcome: NormalizeClaimOutcome;
}

export interface NormalizeClaimSelectionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly trustedContext: ClaimNormalizationTrustedContext;
  readonly untrustedPlayerText: string;
  readonly deadlineAt: number;
  readonly attempt: number;
  readonly now: Date;
}

export interface NormalizeClaimActionDependencies {
  /** Never resolves to an invalid result — repair failure throws `ModelSelectionUnavailableError` (`D4-O`) instead. */
  normalizeClaim(
    params: NormalizeClaimSelectionParams,
  ): Promise<NormalizeClaimSelection>;
}

export interface NormalizeClaimLoadedInputs extends NormalizeClaimInputs {
  readonly townId: string;
  readonly actionId: string;
  readonly playerId: string;
  readonly text: string;
  readonly visitId: string | null;
  readonly npc: NpcSnapshot | undefined;
  readonly loadedAt: Date;
}

export async function loadNormalizeClaimInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<NormalizeClaimLoadedInputs> {
  const text = ClaimTextSchema.parse(context.requestPayload["text"]);
  const npcId = context.requestPayload["npcId"] as string;
  const [npc, visit] = await Promise.all([
    readNpcSnapshot(pool, context.townId, npcId),
    readActiveVisitLocation(pool, context.townId, context.playerId),
  ]);
  const npcPresent = isCoLocated(visit, npc) && npc !== undefined;

  return {
    townId: context.townId,
    actionId: context.actionId,
    playerId: context.playerId,
    text,
    visitId: visit?.visitId ?? null,
    npc: npcPresent ? npc : undefined,
    npcPresent,
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
    loadedAt: context.now,
  };
}

/** Frozen content only — no `pool`, matching Decision 010's "trusted context from frozen content". */
export function buildClaimNormalizationTrustedContext(
  playerId: string,
): ClaimNormalizationTrustedContext {
  return {
    speaker_actor_id: playerId,
    canonical_entities: BELL_MYSTERY_V1.storyEntities.map((entity) => ({
      entity_id: entity.entityKey,
      kind: entity.entityType,
      display_name: entity.displayName,
      aliases: [...entity.aliases],
    })),
    canonical_actors: BELL_MYSTERY_V1.npcs.map((npc) => {
      const character = BELL_MYSTERY_V1.characters.find(
        (candidate) => candidate.entityKey === npc.characterKey,
      );
      if (character === undefined) throw internalError();
      return {
        actor_id: npc.npcKey,
        actor_kind: "npc",
        display_name: character.displayName,
        aliases: [...character.aliases],
      };
    }),
    predicate_signatures: CLAIM_PREDICATE_SIGNATURE_ENTRIES,
    allowed_contexts: BELL_MYSTERY_V1.claimContexts.map((claimContext) => ({
      context_key: claimContext.contextKey,
      aliases: [...claimContext.aliases],
    })),
    default_context_key: BELL_MYSTERY_V1.defaultContextKey,
  };
}

const NORMALIZE_CLAIM_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  NPC_NOT_PRESENT: "That person is not here to hear it.",
};

export function createNormalizeClaimActionHandler(
  dependencies: NormalizeClaimActionDependencies,
): ModelActionHandler<
  "normalize_claim",
  NormalizeClaimLoadedInputs,
  NormalizeClaimSelection
> {
  return {
    kind: "normalize_claim",
    loadInputs: loadNormalizeClaimInputs,
    plan: planNormalizeClaim,
    runModelSelection(
      params: RunModelSelectionParams<NormalizeClaimLoadedInputs>,
    ): Promise<NormalizeClaimSelection> {
      const { inputs } = params;
      return dependencies.normalizeClaim({
        townId: inputs.townId,
        actionId: inputs.actionId,
        trustedContext: buildClaimNormalizationTrustedContext(inputs.playerId),
        untrustedPlayerText: inputs.text,
        deadlineAt: params.deadlineAt,
        attempt: params.attempt,
        now: inputs.loadedAt,
      });
    },
    applySelection(inputs, _pending, selection) {
      if (selection.outcome.kind !== "normalized" || inputs.npc === undefined)
        return [];
      const outcome = selection.outcome;
      return [
        {
          kind: "insert",
          table: "claim_drafts",
          row: {
            player_id: inputs.playerId,
            visit_id: inputs.visitId,
            target_npc_id: inputs.npc.npcId,
            original_text: inputs.text,
            subject_entity_id: outcome.subjectEntityId,
            subject_entity_type: outcome.subjectEntityType,
            predicate: outcome.predicate,
            object_entity_id: outcome.objectEntityId,
            object_entity_type: outcome.objectEntityType,
            polarity: outcome.polarity,
            context_key: outcome.contextKey,
            normalized_key: outcome.normalizedKey,
            alleged_source_actor_id: outcome.allegedSource?.id ?? null,
            status: "pending",
            expires_at: outcome.expiresAt,
            normalization_action_id: inputs.actionId,
            updated_at: inputs.loadedAt,
          },
        },
      ];
    },
    allocateInsertIds() {
      return { claim_drafts: randomUUID() };
    },
    buildResult(_inputs, _effects, insertIds, selection) {
      if (selection === undefined) throw internalError();
      if (selection.outcome.kind === "needs_revision") {
        return {
          normalizationStatus: "needs_revision",
          explanation: selection.outcome.explanation,
        } satisfies ActionResultByKind["normalize_claim"];
      }
      const outcome = selection.outcome;
      return {
        normalizationStatus: "drafted",
        claimDraftId: insertIds["claim_drafts"]!,
        canonicalText: outcome.canonicalText,
        ...(outcome.allegedSource === null
          ? {}
          : {
              allegedSource: {
                id: outcome.allegedSource.id,
                actorType: "npc" as const,
                displayName: outcome.allegedSource.displayName,
              },
            }),
        expiresAt: outcome.expiresAt.toISOString(),
      } satisfies ActionResultByKind["normalize_claim"];
    },
    reasonMessage: (code) =>
      NORMALIZE_CLAIM_DENIAL_MESSAGES[code] ?? "That cannot be recorded right now.",
    resolveVisitId: (inputs) => inputs.visitId,
  };
}

/** Resolves the request target before `player_actions.target_actor_id` is written. */
export async function resolveNormalizeClaimTarget(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<string | null> {
  return (await readNpcSnapshot(pool, townId, npcId))?.npcId ?? null;
}
