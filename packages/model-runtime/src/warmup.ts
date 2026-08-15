/**
 * Structured-output grammar warmup (`P4-06`, `D4-U`; docs/010
 * "Warmup and cold-start mitigation").
 *
 * Bedrock can spend minutes compiling a new `(model, schema)` structured
 * output grammar, which cannot fit inside the player-facing deadline
 * budget. A warmup call sends a tiny synthetic input against the exact
 * checked-in schema and prompt — the same wire contract a real call uses —
 * so the grammar is already compiled by the time a player needs it. It is
 * scored only on latency and success, never on the semantic quality of
 * whatever the model returns for a synthetic input designed to be
 * meaningless (docs/010).
 *
 * `WARMUP_PAIRS` (`model-contracts/versions.ts`) names four pairs, but only
 * three are runnable here: `claim_normalization_v1` and `npc_dialogue_v1`
 * (twice, once per model role) have a real prompt and input builder
 * (`P4-01`). The fourth pair, `ambient_choice_v1`, has neither — ambient
 * ticks are not wired up until the EventBridge-scheduled warmup and the
 * ambient job pipeline itself both exist, which is Phase 7's job (cloud
 * deployment), not this phase's. `runWarmup` below skips that pair and
 * `RUNNABLE_WARMUP_PAIRS`/`DEFERRED_WARMUP_PAIRS` make the split explicit
 * rather than silent, so a future Phase 7 session has one place to look
 * for what still needs finishing.
 */

import {
  buildClaimNormalizationInput,
  buildNpcDialogueInput,
  CLAIM_NORMALIZATION_PROMPT_V1_0_0,
  CLAIM_PREDICATE_SIGNATURE_ENTRIES,
  ClaimNormalizationV1Schema,
  INFERENCE_SETTINGS,
  NPC_DIALOGUE_PROMPT_V1_0_0,
  NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
  NPC_RESPONSE_KINDS,
  NpcDialogueV1Schema,
  OUTPUT_SCHEMA_DESCRIPTIONS,
  OUTPUT_SCHEMA_NAMES,
  OUTPUT_SCHEMAS,
  toBedrockJsonSchema,
  WARMUP_PAIRS,
  type OutputSchemaName,
} from "@the-town-remembers/model-contracts";

import {
  converse,
  resolveModelForRole,
  type BedrockConverseClient,
  type ChatModelRole,
  type ModelResolutionConfig,
} from "./bedrock/index.js";
import { settledMicroUsd } from "./cost/index.js";

/** The three of `WARMUP_PAIRS`' four entries this module can actually run — see module doc. */
export const RUNNABLE_WARMUP_PAIRS = WARMUP_PAIRS.filter(
  (pair) => pair.schema !== OUTPUT_SCHEMA_NAMES.ambientChoice,
);

/** The one entry deferred to Phase 7, alongside the EventBridge schedule itself. */
export const DEFERRED_WARMUP_PAIRS = WARMUP_PAIRS.filter(
  (pair) => pair.schema === OUTPUT_SCHEMA_NAMES.ambientChoice,
);

export interface WarmupPairResult {
  readonly modelRole: ChatModelRole;
  readonly schema: OutputSchemaName;
  readonly outcome: "success" | "failure";
  readonly latencyMs: number;
  readonly estimatedCostMicroUsd: number;
}

export interface RunWarmupParams {
  readonly client: BedrockConverseClient;
  readonly config: ModelResolutionConfig;
  readonly now: () => Date;
  readonly abortSignal: AbortSignal;
  /** Generous on purpose: warmup has no player-facing 24-second budget to share. */
  readonly deadlineMs: number;
}

const TINY_CLAIM_NORMALIZATION_INPUT = buildClaimNormalizationInput({
  trustedContext: {
    speaker_actor_id: "warmup_speaker",
    canonical_entities: [],
    canonical_actors: [],
    predicate_signatures: CLAIM_PREDICATE_SIGNATURE_ENTRIES,
    allowed_contexts: [],
    default_context_key: "warmup_context",
  },
  untrustedPlayerText: "warmup",
});

const TINY_NPC_DIALOGUE_INPUT = buildNpcDialogueInput({
  trustedContext: {
    npc_profile: {
      npc_id: "warmup_npc",
      display_name: "Warmup",
      voice_rules: ["Be terse."],
      current_location_id: "warmup_location",
    },
    player_action: { action_kind: "ask", target_entity_ids: [] },
    relationship_stance: "neutral",
    dialogue_directive: { required_act: "answer", gate_result: "no_gate" },
    allowed_response_kinds: [NPC_RESPONSE_KINDS[0]],
    approved_disclosures: [],
    required_disclosure_ids: [],
    approved_outcomes: [],
    required_outcome_ids: [],
    approved_renderings: [],
    approved_episodes: [],
    canonical_entities: [],
    approved_actors: [],
    response_limits: NPC_DIALOGUE_RESPONSE_LIMITS_ENTRY,
  },
  untrustedPlayerText: "warmup",
});

interface RunnableWarmupPair {
  readonly modelRole: ChatModelRole;
  readonly schema: OutputSchemaName;
}

async function runOnePair(
  pair: RunnableWarmupPair,
  params: RunWarmupParams,
): Promise<WarmupPairResult> {
  const resolved = resolveModelForRole(pair.modelRole, params.config);
  const startedAt = params.now();
  const deadlineAt = new Date(startedAt.getTime() + params.deadlineMs);

  // The fit check always admits: warmup shares no budget with a player turn,
  // so `worstCaseMs`/`reserveMs` are both zero and the only real constraint
  // is `deadlineAt` itself.
  const fitCheck = {
    now: startedAt,
    applicationDeadlineAt: deadlineAt,
    worstCaseMs: 0,
    reserveMs: 0,
  };

  const outcome =
    pair.schema === OUTPUT_SCHEMA_NAMES.npcDialogue
      ? await converse(
          params.client,
          {
            modelId: resolved.modelId,
            systemPrompt: NPC_DIALOGUE_PROMPT_V1_0_0,
            userMessageJson: JSON.stringify(TINY_NPC_DIALOGUE_INPUT),
            outputSchemaName: OUTPUT_SCHEMA_NAMES.npcDialogue,
            outputSchemaDescription: OUTPUT_SCHEMA_DESCRIPTIONS.npcDialogue,
            jsonSchema: toBedrockJsonSchema(
              OUTPUT_SCHEMAS[OUTPUT_SCHEMA_NAMES.npcDialogue],
            ),
            outputSchema: NpcDialogueV1Schema,
            temperature: INFERENCE_SETTINGS.npcDialogue.temperature,
            maxTokens: INFERENCE_SETTINGS.npcDialogue.maximumOutputTokens,
            abortSignal: params.abortSignal,
            worstCaseMs: params.deadlineMs,
          },
          fitCheck,
        )
      : await converse(
          params.client,
          {
            modelId: resolved.modelId,
            systemPrompt: CLAIM_NORMALIZATION_PROMPT_V1_0_0,
            userMessageJson: JSON.stringify(TINY_CLAIM_NORMALIZATION_INPUT),
            outputSchemaName: OUTPUT_SCHEMA_NAMES.claimNormalization,
            outputSchemaDescription: OUTPUT_SCHEMA_DESCRIPTIONS.claimNormalization,
            jsonSchema: toBedrockJsonSchema(
              OUTPUT_SCHEMAS[OUTPUT_SCHEMA_NAMES.claimNormalization],
            ),
            outputSchema: ClaimNormalizationV1Schema,
            temperature: INFERENCE_SETTINGS.claimNormalization.temperature,
            maxTokens: INFERENCE_SETTINGS.claimNormalization.maximumOutputTokens,
            abortSignal: params.abortSignal,
            worstCaseMs: params.deadlineMs,
          },
          fitCheck,
        );

  const latencyMs = params.now().getTime() - startedAt.getTime();
  const estimatedCostMicroUsd =
    outcome.kind === "accepted"
      ? settledMicroUsd(pair.modelRole, {
          inputTokens: outcome.usage.inputTokens,
          outputTokens: outcome.usage.outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        })
      : 0;

  return {
    modelRole: pair.modelRole,
    schema: pair.schema,
    outcome: outcome.kind === "accepted" ? "success" : "failure",
    latencyMs,
    estimatedCostMicroUsd,
  };
}

/** Runs every runnable warmup pair in sequence — deliberately not concurrent, so one pair's cold-start compile cannot compete with another's for the same account-level Bedrock concurrency quota. */
export async function runWarmup(
  params: RunWarmupParams,
): Promise<readonly WarmupPairResult[]> {
  const results: WarmupPairResult[] = [];
  for (const pair of RUNNABLE_WARMUP_PAIRS) {
    results.push(await runOnePair(pair, params));
  }
  return results;
}
