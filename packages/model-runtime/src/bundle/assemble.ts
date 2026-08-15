/**
 * `assembleDialogueContext`: the one function that turns an
 * `ApprovedDisclosureBundle` (`rules`), an NPC profile (`content`), and a set
 * of candidate renderings into the exact `npc-dialogue-input/1` envelope
 * `model-contracts` will send to Bedrock.
 *
 * Every parameter accepts only {@link PlayerSafeText} or an explicitly named
 * `untrustedPlayerText`, and disclosure/outcome/episode candidates are
 * addressed by their real, stable keys — `D4-H`'s ephemeral `d1`/`o1`/`e1`/
 * `r1` ids are assigned here, once, over the sorted set the bundle actually
 * approved, and never accepted as caller input. `game-server`'s
 * `NpcContextBuilder` (`P4-09`) composes this from database reads; this
 * function touches no database and no network.
 */

import {
  buildNpcDialogueInput,
  NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
  type NpcDialogueInputV1,
  type NpcDialogueTrustedContext,
} from "@the-town-remembers/model-contracts";
import { isGateResult, type ApprovedDisclosureBundle } from "@the-town-remembers/rules";

import {
  assignDisclosureIds,
  assignEpisodeIds,
  assignOutcomeIds,
  assignRenderingIds,
} from "./ids.js";
import {
  buildRendering,
  type RenderingBundleSets,
  type RenderingRecord,
} from "./renderings.js";
import { type AuthoredTemplateText, type PlayerSafeText } from "./safe-text.js";

const MAXIMUM_REQUIRED_DISCLOSURES = 4;
const MAXIMUM_REQUIRED_OUTCOMES = 3;
const MAXIMUM_APPROVED_EPISODES = 8;

export type TrustedContextAssemblyErrorCode =
  | "too_many_required_disclosures"
  | "too_many_required_outcomes"
  | "too_many_episodes"
  | "unknown_disclosure_claim"
  | "unknown_outcome_key"
  | "unknown_episode_key"
  | "unsupported_gate_result";

export class TrustedContextAssemblyError extends Error {
  readonly code: TrustedContextAssemblyErrorCode;

  constructor(code: TrustedContextAssemblyErrorCode, detail: string) {
    super(detail);
    this.name = "TrustedContextAssemblyError";
    this.code = code;
  }
}

export interface NpcProfileInput {
  readonly npcId: string;
  readonly displayName: PlayerSafeText;
  readonly voiceRules: readonly PlayerSafeText[];
  readonly currentLocationId: string;
}

export interface PlayerActionInput {
  readonly actionKind: string;
  readonly targetEntityIds: readonly string[];
}

export interface DialogueDirectiveInput {
  readonly requiredAct: string;
  readonly gateResult: string;
}

export interface CanonicalNamedEntityInput {
  readonly entityId: string;
  readonly displayName: PlayerSafeText;
}

export interface ApprovedActorInput {
  readonly actorId: string;
  readonly displayName: PlayerSafeText;
}

/**
 * One candidate rendering, addressed by real stable keys. `assembleDialogueContext`
 * translates `disclosureClaimKeys`/`outcomeKeys`/`episodeKeys` into the
 * bundle's ephemeral ids before validating and including it.
 */
export interface RenderingCandidateInput {
  readonly templateKey: string;
  readonly text: AuthoredTemplateText;
  readonly responseKind: string;
  readonly disclosureClaimKeys: readonly string[];
  readonly outcomeKeys: readonly string[];
  readonly episodeKeys: readonly string[];
  readonly entityIds: readonly string[];
  readonly actorIds: readonly string[];
  readonly styleTags: readonly string[];
}

export interface AssembleDialogueContextParams {
  readonly disclosureBundle: ApprovedDisclosureBundle;
  readonly npcProfile: NpcProfileInput;
  readonly playerAction: PlayerActionInput;
  readonly relationshipStance: PlayerSafeText;
  readonly dialogueDirective: DialogueDirectiveInput;
  readonly allowedResponseKinds: readonly string[];
  readonly renderingCandidates: readonly RenderingCandidateInput[];
  readonly canonicalEntities: readonly CanonicalNamedEntityInput[];
  readonly approvedActors: readonly ApprovedActorInput[];
  /** Present only when raw player text is needed for candidate selection (Decision 010). */
  readonly untrustedPlayerText?: string;
}

export interface AssembledDialogueContext {
  readonly trustedContext: NpcDialogueTrustedContext;
  readonly input: NpcDialogueInputV1;
  readonly renderings: readonly RenderingRecord[];
  /** `rendering_id` (ephemeral) -> the candidate's stable `templateKey`, used only in-process to resolve a model selection back to its authored source. */
  readonly renderingTemplateKeyById: ReadonlyMap<string, string>;
}

function translateKeys(
  keys: readonly string[],
  idByKey: ReadonlyMap<string, string>,
  code: TrustedContextAssemblyErrorCode,
  context: string,
): string[] {
  return keys.map((key) => {
    const id = idByKey.get(key);
    if (id === undefined) {
      throw new TrustedContextAssemblyError(
        code,
        `${context} references unknown key "${key}"`,
      );
    }
    return id;
  });
}

export function assembleDialogueContext(
  params: AssembleDialogueContextParams,
): AssembledDialogueContext {
  const { disclosureBundle } = params;

  if (disclosureBundle.requiredDisclosureIds.length > MAXIMUM_REQUIRED_DISCLOSURES) {
    throw new TrustedContextAssemblyError(
      "too_many_required_disclosures",
      `${disclosureBundle.requiredDisclosureIds.length} required disclosures, maximum ${MAXIMUM_REQUIRED_DISCLOSURES}`,
    );
  }
  if (disclosureBundle.requiredOutcomeIds.length > MAXIMUM_REQUIRED_OUTCOMES) {
    throw new TrustedContextAssemblyError(
      "too_many_required_outcomes",
      `${disclosureBundle.requiredOutcomeIds.length} required outcomes, maximum ${MAXIMUM_REQUIRED_OUTCOMES}`,
    );
  }
  if (disclosureBundle.approvedEpisodes.length > MAXIMUM_APPROVED_EPISODES) {
    throw new TrustedContextAssemblyError(
      "too_many_episodes",
      `${disclosureBundle.approvedEpisodes.length} approved episodes, maximum ${MAXIMUM_APPROVED_EPISODES}`,
    );
  }
  if (!isGateResult(params.dialogueDirective.gateResult)) {
    throw new TrustedContextAssemblyError(
      "unsupported_gate_result",
      params.dialogueDirective.gateResult,
    );
  }

  // D4-H: ephemeral ids assigned once, over the sorted real-key set the
  // bundle actually approved — never accepted as input, never a database id.
  const disclosureIds = assignDisclosureIds(
    disclosureBundle.approvedDisclosures.map((disclosure) => disclosure.claimId),
  );
  const outcomeIds = assignOutcomeIds(
    disclosureBundle.approvedOutcomes.map((outcome) => outcome.outcomeId),
  );
  const episodeIds = assignEpisodeIds(
    disclosureBundle.approvedEpisodes.map((episode) => episode.episodeId),
  );

  const approvedEntityIds = new Set(
    params.canonicalEntities.map((entity) => entity.entityId),
  );
  const approvedActorIds = new Set(params.approvedActors.map((actor) => actor.actorId));
  const allBundleIds = new Set([
    ...disclosureIds.orderedIds,
    ...outcomeIds.orderedIds,
    ...episodeIds.orderedIds,
  ]);

  const bundleSetsWithoutRenderingIds: Omit<RenderingBundleSets, "allBundleIds"> = {
    approvedDisclosureIds: new Set(disclosureIds.orderedIds),
    approvedOutcomeIds: new Set(outcomeIds.orderedIds),
    approvedEpisodeIds: new Set(episodeIds.orderedIds),
    approvedEntityIds,
    approvedActorIds,
  };

  const renderings = params.renderingCandidates.map((candidate) => {
    const translatedDisclosureIds = translateKeys(
      candidate.disclosureClaimKeys,
      disclosureIds.idByKey,
      "unknown_disclosure_claim",
      candidate.templateKey,
    );
    const translatedOutcomeIds = translateKeys(
      candidate.outcomeKeys,
      outcomeIds.idByKey,
      "unknown_outcome_key",
      candidate.templateKey,
    );
    const translatedEpisodeIds = translateKeys(
      candidate.episodeKeys,
      episodeIds.idByKey,
      "unknown_episode_key",
      candidate.templateKey,
    );

    return buildRendering(
      {
        templateKey: candidate.templateKey,
        text: candidate.text,
        responseKind: candidate.responseKind,
        disclosureIds: translatedDisclosureIds,
        outcomeIds: translatedOutcomeIds,
        episodeIds: translatedEpisodeIds,
        entityIds: candidate.entityIds,
        actorIds: candidate.actorIds,
        styleTags: candidate.styleTags,
      },
      { ...bundleSetsWithoutRenderingIds, allBundleIds },
    );
  });

  const renderingIds = assignRenderingIds(
    renderings.map((rendering) => rendering.templateKey),
  );
  const renderingTemplateKeyById = renderingIds.keyById;

  const trustedContext: NpcDialogueTrustedContext = {
    npc_profile: {
      npc_id: params.npcProfile.npcId,
      display_name: params.npcProfile.displayName,
      voice_rules: [...params.npcProfile.voiceRules],
      current_location_id: params.npcProfile.currentLocationId,
    },
    player_action: {
      action_kind: params.playerAction.actionKind,
      target_entity_ids: [...params.playerAction.targetEntityIds],
    },
    relationship_stance: params.relationshipStance,
    dialogue_directive: {
      required_act: params.dialogueDirective.requiredAct,
      gate_result: params.dialogueDirective.gateResult,
    },
    allowed_response_kinds:
      params.allowedResponseKinds as NpcDialogueTrustedContext["allowed_response_kinds"],
    approved_disclosures: disclosureBundle.approvedDisclosures.map((disclosure) => ({
      disclosure_id: disclosureIds.idByKey.get(disclosure.claimId)!,
      claim_id: disclosure.claimId,
      stance: disclosure.stance,
      source_episode_id:
        disclosure.sourceEpisodeId === null
          ? null
          : (episodeIds.idByKey.get(disclosure.sourceEpisodeId) ??
            disclosure.sourceEpisodeId),
      // Not one of D4-H's four remapped categories; passed through as-is
      // until a later phase decides whether transmission ids need the same
      // ephemeral treatment episodes/disclosures/outcomes/renderings get.
      parent_transmission_id: disclosure.parentTransmissionId,
      tier: disclosure.tier,
      permitted_entity_ids: [...disclosure.permittedEntityIds],
    })),
    required_disclosure_ids: translateKeys(
      disclosureBundle.requiredDisclosureIds,
      disclosureIds.idByKey,
      "unknown_disclosure_claim",
      "requiredDisclosureIds",
    ),
    approved_outcomes: disclosureBundle.approvedOutcomes.map((outcome) => ({
      outcome_id: outcomeIds.idByKey.get(outcome.outcomeId)!,
      // Content owns the real vocabulary (content/dialogue/outcomes.ts); this
      // layer only remaps ids, so kind/summary are left for the caller to
      // enrich if it has them. Placeholder text keeps the wire shape valid.
      kind: outcome.outcomeId,
      summary: outcome.outcomeId,
    })),
    required_outcome_ids: translateKeys(
      disclosureBundle.requiredOutcomeIds,
      outcomeIds.idByKey,
      "unknown_outcome_key",
      "requiredOutcomeIds",
    ),
    approved_renderings: renderings.map((rendering) => ({
      rendering_id: renderingIds.idByKey.get(rendering.templateKey)!,
      text: rendering.text,
      response_kind: rendering.responseKind,
      disclosure_ids: [...rendering.disclosureIds],
      outcome_ids: [...rendering.outcomeIds],
      episode_ids: [...rendering.episodeIds],
      entity_ids: [...rendering.entityIds],
      actor_ids: [...rendering.actorIds],
      style_tags: [...rendering.styleTags],
    })),
    approved_episodes: disclosureBundle.approvedEpisodes.map((episode) => ({
      episode_id: episodeIds.idByKey.get(episode.episodeId)!,
      summary: episode.spoilerSafeSummary,
    })),
    canonical_entities: params.canonicalEntities.map((entity) => ({
      entity_id: entity.entityId,
      display_name: entity.displayName,
    })),
    approved_actors: params.approvedActors.map((actor) => ({
      actor_id: actor.actorId,
      display_name: actor.displayName,
    })),
    response_limits: NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
  };

  const input = buildNpcDialogueInput({
    trustedContext,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrustedPlayerText: params.untrustedPlayerText }),
  });

  return {
    trustedContext,
    input,
    renderings,
    renderingTemplateKeyById,
  };
}
