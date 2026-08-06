/**
 * Generation of the JSON Schema documents supplied to Bedrock structured
 * output, plus the normalization used to compare them with the checked-in
 * snapshots under `docs/schemas/`.
 *
 * The checked-in files remain the authority. Generation exists so a Zod change
 * that would silently alter the wire contract fails a test instead.
 */

import { z } from "zod";

import { AmbientChoiceV1Schema } from "./ambient-choice.js";
import { ClaimNormalizationV1Schema } from "./claim-normalization.js";
import { NpcDialogueV1Schema } from "./npc-dialogue.js";
import { OUTPUT_SCHEMA_NAMES } from "./versions.js";

/** Zod source of truth for each accepted output schema name. */
export const OUTPUT_SCHEMAS = {
  [OUTPUT_SCHEMA_NAMES.claimNormalization]: ClaimNormalizationV1Schema,
  [OUTPUT_SCHEMA_NAMES.npcDialogue]: NpcDialogueV1Schema,
  [OUTPUT_SCHEMA_NAMES.ambientChoice]: AmbientChoiceV1Schema,
} as const;

/**
 * Keys that describe the document rather than the contract. The checked-in
 * snapshots omit them, so generation drops them before comparison.
 */
const NON_CONTRACT_ROOT_KEYS = ["$schema", "id", "$id", "title"] as const;

/**
 * Produces the exact document sent to Bedrock as
 * `outputConfig.textFormat.structure.jsonSchema.schema`.
 */
export function toBedrockJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  }) as Record<string, unknown>;

  for (const key of NON_CONTRACT_ROOT_KEYS) delete generated[key];
  return generated;
}
