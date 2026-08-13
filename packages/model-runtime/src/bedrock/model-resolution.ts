/**
 * Resolves which chat model answers a dialogue call. Sonnet is the default;
 * reduced-cost mode (`D4-M`'s three-threshold monthly-spend ladder, decided
 * elsewhere) switches to Haiku. Resolution only ever changes `modelId` —
 * `PROMPT_VERSIONS.npcDialogue`, `OUTPUT_SCHEMA_NAMES.npcDialogue`, and
 * `VALIDATION_POLICY_VERSIONS.npcDialogue` are the same fixed constants
 * regardless of which model answers, so a model change alone can never
 * silently change which prompt or validator is in effect.
 */

export type ChatModelRole = "haiku" | "sonnet";

export interface ModelResolutionConfig {
  readonly haikuModelId: string;
  readonly sonnetModelId: string;
  readonly haikuInferenceProfileArn: string | undefined;
  readonly sonnetInferenceProfileArn: string | undefined;
}

export interface ResolvedModel {
  readonly role: ChatModelRole;
  /** The value to send as the Converse request's `modelId`. */
  readonly modelId: string;
  /** `D4-N`: recorded on `agent_runs.inference_profile` — the resolved ARN when configured, the resolved model id otherwise. Never the empty string. */
  readonly inferenceProfile: string;
}

export function resolveModelForRole(
  role: ChatModelRole,
  config: ModelResolutionConfig,
): ResolvedModel {
  const modelId =
    role === "haiku"
      ? (config.haikuInferenceProfileArn ?? config.haikuModelId)
      : (config.sonnetInferenceProfileArn ?? config.sonnetModelId);
  return { role, modelId, inferenceProfile: modelId };
}

/** Sonnet by default; Haiku only under reduced-cost mode. */
export function resolveDialogueModelRole(reducedCostMode: boolean): ChatModelRole {
  return reducedCostMode ? "haiku" : "sonnet";
}
