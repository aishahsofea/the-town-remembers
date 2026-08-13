/**
 * `npc-dialogue-input/1`, the exact user-message shape sent to
 * `npc-dialogue/1.0.0` (Decision 010, "NPC dialogue selection / Purpose and
 * input").
 *
 * Every ID in `trusted_context` is opaque and ephemeral, scoped to one
 * bundle (`D4-H`); this schema fixes their wire shape only. Assembling a real
 * bundle from application state — `ApprovedDisclosureBundle`, disclosure
 * tiers, gate results — is `model-runtime/bundle/assemble.ts` (`P4-02`),
 * which this package must not import (`D4-B`).
 */

import { z } from "zod";

import { NPC_DIALOGUE_RESPONSE_LIMITS, NPC_RESPONSE_KINDS } from "../npc-dialogue.js";
import { TASK_INPUT_VERSIONS } from "../versions.js";

export const NPC_DIALOGUE_INPUT_VERSION = TASK_INPUT_VERSIONS.npcDialogue;

const NpcProfileInputSchema = z.strictObject({
  npc_id: z.string().min(1),
  display_name: z.string().min(1),
  voice_rules: z.array(z.string().min(1)),
  current_location_id: z.string().min(1),
});

const PlayerActionInputSchema = z.strictObject({
  action_kind: z.string().min(1),
  target_entity_ids: z.array(z.string().min(1)),
});

const DialogueDirectiveInputSchema = z.strictObject({
  required_act: z.string().min(1),
  gate_result: z.string().min(1),
});

const ApprovedDisclosureInputSchema = z.strictObject({
  disclosure_id: z.string().min(1),
  claim_id: z.string().min(1),
  stance: z.string().min(1),
  source_episode_id: z.union([z.string().min(1), z.null()]),
  parent_transmission_id: z.union([z.string().min(1), z.null()]),
  tier: z.string().min(1),
  permitted_entity_ids: z.array(z.string().min(1)),
});

const ApprovedOutcomeInputSchema = z.strictObject({
  outcome_id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1),
});

const ApprovedRenderingInputSchema = z.strictObject({
  rendering_id: z.string().min(1),
  text: z.string().min(1),
  response_kind: z.enum(NPC_RESPONSE_KINDS),
  disclosure_ids: z.array(z.string().min(1)),
  outcome_ids: z.array(z.string().min(1)),
  episode_ids: z.array(z.string().min(1)),
  entity_ids: z.array(z.string().min(1)),
  actor_ids: z.array(z.string().min(1)),
  style_tags: z.array(z.string().min(1)),
});

const ApprovedEpisodeInputSchema = z.strictObject({
  episode_id: z.string().min(1),
  summary: z.string().min(1),
});

const CanonicalNamedEntityInputSchema = z.strictObject({
  entity_id: z.string().min(1),
  display_name: z.string().min(1),
});

const ApprovedActorInputSchema = z.strictObject({
  actor_id: z.string().min(1),
  display_name: z.string().min(1),
});

const ResponseLimitsInputSchema = z.strictObject({
  minimum_renderings: z.number().int().positive(),
  maximum_renderings: z.number().int().positive(),
  maximum_sentences: z.number().int().positive(),
  maximum_words: z.number().int().positive(),
  maximum_disclosures: z.number().int().nonnegative(),
  maximum_outcomes: z.number().int().nonnegative(),
  maximum_episode_references: z.number().int().nonnegative(),
  maximum_entity_references: z.number().int().nonnegative(),
  maximum_actor_references: z.number().int().nonnegative(),
});

const NpcDialogueTrustedContextSchema = z.strictObject({
  npc_profile: NpcProfileInputSchema,
  player_action: PlayerActionInputSchema,
  relationship_stance: z.string().min(1),
  dialogue_directive: DialogueDirectiveInputSchema,
  allowed_response_kinds: z.array(z.enum(NPC_RESPONSE_KINDS)).min(1),
  approved_disclosures: z.array(ApprovedDisclosureInputSchema),
  required_disclosure_ids: z.array(z.string().min(1)),
  approved_outcomes: z.array(ApprovedOutcomeInputSchema),
  required_outcome_ids: z.array(z.string().min(1)),
  approved_renderings: z.array(ApprovedRenderingInputSchema),
  approved_episodes: z.array(ApprovedEpisodeInputSchema),
  canonical_entities: z.array(CanonicalNamedEntityInputSchema),
  approved_actors: z.array(ApprovedActorInputSchema),
  response_limits: ResponseLimitsInputSchema,
});

export type NpcDialogueTrustedContext = z.infer<typeof NpcDialogueTrustedContextSchema>;

export const NpcDialogueInputV1Schema = z.strictObject({
  task_input_version: z.literal(NPC_DIALOGUE_INPUT_VERSION),
  trusted_context: NpcDialogueTrustedContextSchema,
  untrusted_player_text: z.string().optional(),
});

export type NpcDialogueInputV1 = z.infer<typeof NpcDialogueInputV1Schema>;

/**
 * `NPC_DIALOGUE_RESPONSE_LIMITS` reshaped for the wire so the sent value can
 * never drift from the canonical limits.
 */
export const NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY: z.infer<
  typeof ResponseLimitsInputSchema
> = {
  minimum_renderings: NPC_DIALOGUE_RESPONSE_LIMITS.minimumRenderings,
  maximum_renderings: NPC_DIALOGUE_RESPONSE_LIMITS.maximumRenderings,
  maximum_sentences: NPC_DIALOGUE_RESPONSE_LIMITS.maximumSentences,
  maximum_words: NPC_DIALOGUE_RESPONSE_LIMITS.maximumWords,
  maximum_disclosures: NPC_DIALOGUE_RESPONSE_LIMITS.maximumDisclosures,
  maximum_outcomes: NPC_DIALOGUE_RESPONSE_LIMITS.maximumOutcomes,
  maximum_episode_references: NPC_DIALOGUE_RESPONSE_LIMITS.maximumEpisodeReferences,
  maximum_entity_references: NPC_DIALOGUE_RESPONSE_LIMITS.maximumEntityReferences,
  maximum_actor_references: NPC_DIALOGUE_RESPONSE_LIMITS.maximumActorReferences,
};

export interface BuildNpcDialogueInputParams {
  readonly trustedContext: NpcDialogueTrustedContext;
  /** Present only when raw player text is needed for candidate selection. */
  readonly untrustedPlayerText?: string;
}

export function buildNpcDialogueInput(
  params: BuildNpcDialogueInputParams,
): NpcDialogueInputV1 {
  return NpcDialogueInputV1Schema.parse({
    task_input_version: NPC_DIALOGUE_INPUT_VERSION,
    trusted_context: params.trustedContext,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrusted_player_text: params.untrustedPlayerText }),
  });
}
