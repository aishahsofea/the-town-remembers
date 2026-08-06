/**
 * `npc_dialogue_v1`, the Bedrock structured output accepted by Decision 010.
 *
 * The model selects and orders exact application-supplied rendering IDs. It
 * never writes player-visible prose. Rendering membership, required disclosure
 * and outcome coverage, and the derived length limits are deterministic
 * application checks owned by Phase 4; this schema only fixes the wire shape.
 */

import { z } from "zod";

export const NPC_RESPONSE_KINDS = [
  "answer",
  "acknowledge",
  "refuse",
  "deflect",
  "ask_clarification",
  "react",
] as const;

/** Bundle limits fixed by the accepted `response_limits` contract. */
export const NPC_DIALOGUE_RESPONSE_LIMITS = {
  minimumRenderings: 1,
  maximumRenderings: 3,
  maximumSentences: 3,
  maximumWords: 80,
  maximumDisclosures: 4,
  maximumOutcomes: 3,
  maximumEpisodeReferences: 8,
  maximumEntityReferences: 8,
  maximumActorReferences: 8,
} as const;

/** Caps on what a bundle may require the response to express. */
export const NPC_DIALOGUE_REQUIRED_LIMITS = {
  maximumRequiredDisclosures: 4,
  maximumRequiredOutcomes: 3,
} as const;

export const NpcDialogueV1Schema = z
  .strictObject({
    response_kind: z.enum(NPC_RESPONSE_KINDS),
    rendering_ids: z
      .array(z.string())
      .describe(
        "Ordered distinct IDs of exact application-supplied rendering records. Application code concatenates their immutable text and derives all disclosure, outcome, episode, entity, and actor grounding from those records.",
      ),
  })
  .describe("Selection of one or more exact application-supplied NPC renderings.");

export type NpcDialogueV1 = z.infer<typeof NpcDialogueV1Schema>;
export type NpcResponseKind = (typeof NPC_RESPONSE_KINDS)[number];
