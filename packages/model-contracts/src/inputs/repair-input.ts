/**
 * `structured-repair-input/1`, the exact user-message shape sent alongside
 * `structured-repair/1.0.0` (Decision 010, "Structured repair").
 *
 * This module fixes the wire envelope only: the same `trusted_context` as
 * the original task, the rejected output, and a sanitized error list.
 * Deciding *whether* a repair may be attempted at all — refusing a
 * repair-of-a-repair, sanitizing a validator's raw error into these fields —
 * needs the validator and the prior run's outcome, which live in
 * `model-runtime/validation/repair.ts` (`P4-03`), not this dependency-free
 * package (`D4-B`). `buildStructuredRepairInput` here is a pure, unconditional
 * constructor; it does not and cannot check that history.
 */

import { z } from "zod";

import {
  OUTPUT_SCHEMA_NAMES,
  PROMPT_VERSIONS,
  REPAIR_VALIDATION_ERROR_CODES,
  TASK_INPUT_VERSIONS,
} from "../versions.js";
import {
  ClaimNormalizationInputV1Schema,
  type ClaimNormalizationTrustedContext,
} from "./normalization-input.js";
import {
  NpcDialogueInputV1Schema,
  type NpcDialogueTrustedContext,
} from "./dialogue-input.js";

export const STRUCTURED_REPAIR_INPUT_VERSION = TASK_INPUT_VERSIONS.structuredRepair;

const RepairValidationErrorSchema = z.strictObject({
  code: z.enum(REPAIR_VALIDATION_ERROR_CODES),
  path: z.string(),
  explanation: z.string(),
});

export type RepairValidationError = z.infer<typeof RepairValidationErrorSchema>;

/** Extracted so `trusted_context`'s inner shape reuses the original task's own schema, never a redeclared copy. */
const ORIGINAL_TRUSTED_CONTEXT_SHAPES = {
  claim_normalization: ClaimNormalizationInputV1Schema.shape.trusted_context,
  npc_dialogue: NpcDialogueInputV1Schema.shape.trusted_context,
} as const;

function repairEnvelopeSchema<
  TargetTask extends keyof typeof ORIGINAL_TRUSTED_CONTEXT_SHAPES,
>(targetTask: TargetTask, targetPromptVersion: string, targetSchemaName: string) {
  return z.strictObject({
    task_input_version: z.literal(STRUCTURED_REPAIR_INPUT_VERSION),
    target_task: z.literal(targetTask),
    target_prompt_version: z.literal(targetPromptVersion),
    target_schema_name: z.literal(targetSchemaName),
    trusted_context: ORIGINAL_TRUSTED_CONTEXT_SHAPES[targetTask],
    untrusted_player_text: z.string().optional(),
    untrusted_invalid_output: z.string(),
    validation_errors: z.array(RepairValidationErrorSchema).min(1),
  });
}

export const ClaimNormalizationRepairInputV1Schema = repairEnvelopeSchema(
  "claim_normalization",
  PROMPT_VERSIONS.claimNormalization,
  OUTPUT_SCHEMA_NAMES.claimNormalization,
);
export type ClaimNormalizationRepairInputV1 = z.infer<
  typeof ClaimNormalizationRepairInputV1Schema
>;

export const NpcDialogueRepairInputV1Schema = repairEnvelopeSchema(
  "npc_dialogue",
  PROMPT_VERSIONS.npcDialogue,
  OUTPUT_SCHEMA_NAMES.npcDialogue,
);
export type NpcDialogueRepairInputV1 = z.infer<typeof NpcDialogueRepairInputV1Schema>;

interface BuildRepairInputParams<TrustedContext> {
  readonly trustedContext: TrustedContext;
  readonly untrustedPlayerText?: string;
  readonly untrustedInvalidOutput: string;
  readonly validationErrors: readonly RepairValidationError[];
}

export function buildClaimNormalizationRepairInput(
  params: BuildRepairInputParams<ClaimNormalizationTrustedContext>,
): ClaimNormalizationRepairInputV1 {
  return ClaimNormalizationRepairInputV1Schema.parse({
    task_input_version: STRUCTURED_REPAIR_INPUT_VERSION,
    target_task: "claim_normalization",
    target_prompt_version: PROMPT_VERSIONS.claimNormalization,
    target_schema_name: OUTPUT_SCHEMA_NAMES.claimNormalization,
    trusted_context: params.trustedContext,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrusted_player_text: params.untrustedPlayerText }),
    untrusted_invalid_output: params.untrustedInvalidOutput,
    validation_errors: params.validationErrors,
  });
}

export function buildNpcDialogueRepairInput(
  params: BuildRepairInputParams<NpcDialogueTrustedContext>,
): NpcDialogueRepairInputV1 {
  return NpcDialogueRepairInputV1Schema.parse({
    task_input_version: STRUCTURED_REPAIR_INPUT_VERSION,
    target_task: "npc_dialogue",
    target_prompt_version: PROMPT_VERSIONS.npcDialogue,
    target_schema_name: OUTPUT_SCHEMA_NAMES.npcDialogue,
    trusted_context: params.trustedContext,
    ...(params.untrustedPlayerText === undefined
      ? {}
      : { untrusted_player_text: params.untrustedPlayerText }),
    untrusted_invalid_output: params.untrustedInvalidOutput,
    validation_errors: params.validationErrors,
  });
}
