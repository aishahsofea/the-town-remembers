/**
 * Immutable version identity for every Bedrock task accepted by Decision 010.
 *
 * Deployed prompt versions never change in place. A resolved model ID or
 * inference-profile ARN is deployment configuration and is deliberately absent
 * here, but every run records both alongside these constants.
 */

/** Semantic prompt versions. There are four prompts but three result shapes. */
export const PROMPT_VERSIONS = {
  claimNormalization: "claim-normalization/1.0.0",
  npcDialogue: "npc-dialogue/1.0.0",
  ambientChoice: "ambient-choice/1.0.0",
  structuredRepair: "structured-repair/1.0.0",
} as const;

/** Version of the JSON user-message contract sent to each prompt. */
export const TASK_INPUT_VERSIONS = {
  claimNormalization: "claim-normalization-input/1",
  npcDialogue: "npc-dialogue-input/1",
  ambientChoice: "ambient-choice-input/1",
  structuredRepair: "structured-repair-input/1",
} as const;

/**
 * Semantic validator versions, tracked independently of prompt text so a
 * changed validator can be correlated with an unchanged prompt. Repair has no
 * validator of its own: it inherits the target task's version.
 */
export const VALIDATION_POLICY_VERSIONS = {
  claimNormalization: "claim-normalization-validator/1.0.0",
  npcDialogue: "npc-dialogue-validator/1.0.0",
  ambientChoice: "ambient-choice-validator/1.0.0",
} as const;

/** Stable schema names supplied to Bedrock structured output. */
export const OUTPUT_SCHEMA_NAMES = {
  claimNormalization: "claim_normalization_v1",
  npcDialogue: "npc_dialogue_v1",
  ambientChoice: "ambient_choice_v1",
} as const;

/** Descriptions supplied with each schema in the Bedrock `outputConfig`. */
export const OUTPUT_SCHEMA_DESCRIPTIONS = {
  claimNormalization: "Normalize one utterance into one bounded claim result",
  npcDialogue: "Select and order exact application-supplied NPC renderings",
  ambientChoice: "Select up to two application-supplied ambient action candidates",
} as const;

/** Inference settings. Repair reuses its target task's output-token budget. */
export const INFERENCE_SETTINGS = {
  claimNormalization: { temperature: 0, maximumOutputTokens: 256 },
  npcDialogue: { temperature: 0.4, maximumOutputTokens: 384 },
  ambientChoice: { temperature: 0.2, maximumOutputTokens: 128 },
  structuredRepair: { temperature: 0 },
} as const;

/**
 * The stable validation error codes a repair call may be told about. A repair
 * message carries the code, a JSON path, and a sanitized explanation only; it
 * never carries a secret or additional world knowledge.
 */
export const REPAIR_VALIDATION_ERROR_CODES = [
  "schema_mismatch",
  "invalid_status_combination",
  "unknown_entity_id",
  "invalid_context_key",
  "unknown_disclosure_id",
  "unknown_rendering_id",
  "unknown_episode_id",
  "invalid_predicate_signature",
  "missing_required_disclosure",
  "missing_required_outcome",
  "rendering_limit_exceeded",
  "response_kind_conflict",
  "response_too_long",
  "invalid_choice_id",
  "duplicate_choice",
  "repeated_claim_hop",
  "repeated_speaker",
  "gate_result_conflict",
] as const;

/** Outcome recorded on every `agent_runs` row. */
export const AGENT_RUN_OUTCOMES = [
  "accepted",
  "repaired",
  "rejected",
  "fallback",
  "failed",
  "superseded",
] as const;

/**
 * `(resolved model, schema)` grammar pairs kept warm. Bedrock can spend minutes
 * compiling a new structured-output grammar, which cannot fit inside the
 * 24-second application budget.
 */
export const WARMUP_PAIRS = [
  { modelRole: "haiku", schema: OUTPUT_SCHEMA_NAMES.claimNormalization },
  { modelRole: "haiku", schema: OUTPUT_SCHEMA_NAMES.ambientChoice },
  { modelRole: "haiku", schema: OUTPUT_SCHEMA_NAMES.npcDialogue },
  { modelRole: "sonnet", schema: OUTPUT_SCHEMA_NAMES.npcDialogue },
] as const;

export const WARMUP_INTERVAL_HOURS = 20;

export type PromptVersion = (typeof PROMPT_VERSIONS)[keyof typeof PROMPT_VERSIONS];
export type TaskInputVersion =
  (typeof TASK_INPUT_VERSIONS)[keyof typeof TASK_INPUT_VERSIONS];
export type ValidationPolicyVersion =
  (typeof VALIDATION_POLICY_VERSIONS)[keyof typeof VALIDATION_POLICY_VERSIONS];
export type OutputSchemaName =
  (typeof OUTPUT_SCHEMA_NAMES)[keyof typeof OUTPUT_SCHEMA_NAMES];
export type RepairValidationErrorCode = (typeof REPAIR_VALIDATION_ERROR_CODES)[number];
export type AgentRunOutcome = (typeof AGENT_RUN_OUTCOMES)[number];
