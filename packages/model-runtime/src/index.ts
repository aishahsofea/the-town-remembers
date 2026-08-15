export * from "./bedrock/index.js";
export * from "./bundle/index.js";
export * from "./cost/index.js";
export * from "./validation/index.js";
export * from "./warmup.js";

// Contract primitives needed by the game-server orchestration layer. Keeping
// this narrow re-export preserves model-runtime as that layer's single model
// dependency rather than making callers reach through it to model-contracts.
export {
  buildClaimNormalizationInput,
  CLAIM_CLARIFICATION_REASON_CODES,
  CLAIM_NORMALIZATION_PROMPT_V1_0_0,
  CLAIM_PREDICATE_SIGNATURE_ENTRIES,
  CLAIM_UNSUPPORTED_REASON_CODES,
  ClaimNormalizationV1Schema,
  INFERENCE_SETTINGS,
  NPC_DIALOGUE_PROMPT_V1_0_0,
  NpcDialogueV1Schema,
  OUTPUT_SCHEMA_DESCRIPTIONS,
  OUTPUT_SCHEMA_NAMES,
  PROMPT_VERSIONS,
  promptHash,
  repairPromptHash,
  STRUCTURED_REPAIR_OVERLAY_V1_0_0,
  TASK_INPUT_VERSIONS,
  toBedrockJsonSchema,
  VALIDATION_POLICY_VERSIONS,
  type ClaimNormalizationReasonCode,
  type ClaimNormalizationTrustedContext,
  type ClaimPredicate,
} from "@the-town-remembers/model-contracts";
