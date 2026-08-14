/** Production Titan/Bedrock implementation behind Ask's injected seams. */

import { randomUUID } from "node:crypto";

import { BELL_MYSTERY_V1 as BELL_CONTENT } from "@the-town-remembers/content";
import { asVector256 } from "@the-town-remembers/database";
import {
  buildNpcDialogueRepairFromFailure,
  buildValidationError,
  converseWithRetry,
  createBedrockConverseClient,
  createTitanEmbedClient,
  embedTextWithRetry,
  INFERENCE_SETTINGS,
  NPC_DIALOGUE_PROMPT_V1_0_0,
  NpcDialogueV1Schema,
  OUTPUT_SCHEMA_DESCRIPTIONS,
  OUTPUT_SCHEMA_NAMES,
  PRICE_CATALOG_VERSION,
  PROMPT_VERSIONS,
  promptHash,
  reducedCostModeActive,
  repairPromptHash,
  resolveDialogueModelRole,
  resolveFallbackLine,
  resolveModelForRole,
  settledMicroUsd,
  STRUCTURED_REPAIR_OVERLAY_V1_0_0,
  TASK_INPUT_VERSIONS,
  toBedrockJsonSchema,
  validateNpcDialogueSelection,
  VALIDATION_POLICY_VERSIONS,
  worstCaseMicroUsd,
  type BedrockConverseClient,
  type ChatModelRole,
  type DialogueValidationFailure,
  type DialogueValidationSuccess,
  type TitanEmbedClient,
} from "@the-town-remembers/model-runtime";
import type { ModelConfig } from "@the-town-remembers/runtime-config/model";
import { MODEL_DEADLINES } from "@the-town-remembers/runtime-config/model";
import type { AskDialogueSelection } from "@the-town-remembers/rules";
import type { Pool } from "pg";

import {
  releaseModelCost,
  reserveModelCost,
  settleModelCost,
} from "../../persistence/model-cost.js";
import { appendRun } from "../../persistence/model-runs.js";
import {
  createAskActionHandler as createAskHandler,
  type AskActionDependencies,
  type AskDialogueSelectionParams,
  type AskQueryEmbeddingParams,
} from "./inputs/ask.js";

const EMBEDDING_PROMPT_VERSION = "titan-embed-text-v2";
const EMPTY_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
} as const;

export interface ProductionAskDependenciesParams {
  readonly pool: Pool;
  readonly modelConfig: ModelConfig;
  readonly converseClient: BedrockConverseClient;
  readonly titanClient: TitanEmbedClient;
  readonly now?: () => Date;
}

function boundedTimeoutMs(deadlineAt: number, capMs: number, now: Date): number {
  return Math.max(1, Math.min(capMs, deadlineAt - now.getTime()));
}

function validationCode(failure: DialogueValidationFailure): string {
  return failure.errors[0]?.code ?? "schema_mismatch";
}

function toAskSelection(
  validation: DialogueValidationSuccess,
  params: AskDialogueSelectionParams,
  responseMode: "selected" | "repaired",
): AskDialogueSelection {
  const disclosureByEphemeralId = new Map(
    params.assembled.trustedContext.approved_disclosures.map((entry) => [
      entry.disclosure_id,
      entry.claim_id,
    ]),
  );
  const approvedByClaimId = new Map(
    params.pending.trustedContext.approvedDisclosures.map((entry) => [
      entry.claimId,
      entry,
    ]),
  );
  return {
    npcId: params.assembled.trustedContext.npc_profile.npc_id,
    text: validation.concatenatedText,
    responseMode,
    expressedDisclosures: validation.expressedDisclosureIds.flatMap((ephemeralId) => {
      const claimId = disclosureByEphemeralId.get(ephemeralId);
      const disclosure =
        claimId === undefined ? undefined : approvedByClaimId.get(claimId);
      return disclosure === undefined ? [] : [disclosure];
    }),
  };
}

function fallbackSelection(params: AskDialogueSelectionParams): AskDialogueSelection {
  const gateResult = params.assembled.trustedContext.dialogue_directive.gate_result;
  const line = resolveFallbackLine(BELL_CONTENT, {
    npcKey: params.npcKey,
    actionKind: "ask",
    responseKind: "deflect",
    gateResult,
    requiredOutcomeIds: [],
  });
  return {
    npcId: params.assembled.trustedContext.npc_profile.npc_id,
    text: line.text,
    responseMode: "fallback",
    expressedDisclosures: [],
  };
}

async function embedQuery(
  dependencies: ProductionAskDependenciesParams,
  params: AskQueryEmbeddingParams,
): Promise<ReturnType<typeof asVector256> | undefined> {
  const now = (dependencies.now ?? (() => new Date()))();
  const reservationId = randomUUID();
  const maximumCostMicroUsd = worstCaseMicroUsd("query_embedding", "titan");
  const admission = await reserveModelCost(dependencies.pool, params.deadlineAt, {
    reservationId,
    source: {
      kind: "player_action",
      townId: params.townId,
      playerActionId: params.actionId,
    },
    attemptOrdinal: params.attempt,
    purpose: "query_embedding",
    model: "titan",
    inferenceProfile: dependencies.modelConfig.titanModelId,
    priceVersion: dependencies.modelConfig.priceCatalogVersion || PRICE_CATALOG_VERSION,
    maximumCostMicroUsd,
    now,
  });
  if (!admission.admitted) return undefined;

  const timeoutMs = boundedTimeoutMs(
    params.deadlineAt,
    MODEL_DEADLINES.titanQueryEmbeddingMs,
    now,
  );
  const startedAt = Date.now();
  const outcome = await embedTextWithRetry(
    dependencies.titanClient,
    {
      modelId: dependencies.modelConfig.titanModelId,
      inputText: params.question,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
    {
      now,
      applicationDeadlineAt: new Date(params.deadlineAt),
      worstCaseMs: MODEL_DEADLINES.titanQueryEmbeddingMs,
      reserveMs: 0,
    },
  );
  const runId = randomUUID();
  const recordedAt = (dependencies.now ?? (() => new Date()))();
  if (outcome.kind !== "accepted") {
    await appendRun(dependencies.pool, params.deadlineAt, {
      runId,
      townId: params.townId,
      playerActionId: params.actionId,
      model: "titan",
      inferenceProfile: dependencies.modelConfig.titanModelId,
      promptVersion: EMBEDDING_PROMPT_VERSION,
      purpose: "query_embedding",
      usage: EMPTY_USAGE,
      latencyMs: Math.max(0, Date.now() - startedAt),
      estimatedCostMicroUsd: 0,
      outcome: "failed",
      now: recordedAt,
    });
    await releaseModelCost(
      dependencies.pool,
      params.deadlineAt,
      reservationId,
      recordedAt,
    );
    return undefined;
  }

  const usage = {
    inputTokens: outcome.inputTextTokenCount,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const cost = settledMicroUsd("titan", usage);
  await appendRun(dependencies.pool, params.deadlineAt, {
    runId,
    townId: params.townId,
    playerActionId: params.actionId,
    model: "titan",
    inferenceProfile: dependencies.modelConfig.titanModelId,
    promptVersion: EMBEDDING_PROMPT_VERSION,
    purpose: "query_embedding",
    usage,
    latencyMs: Math.max(0, Date.now() - startedAt),
    estimatedCostMicroUsd: cost,
    outcome: "accepted",
    now: recordedAt,
  });
  await settleModelCost(dependencies.pool, params.deadlineAt, {
    reservationId,
    agentRunId: runId,
    settledCostMicroUsd: cost,
    now: recordedAt,
  });
  return asVector256(outcome.embedding);
}

interface ReservedChatCall {
  readonly reservationId: string;
  readonly role: ChatModelRole;
  readonly modelId: string;
  readonly inferenceProfile: string;
}

async function reserveChatCall(
  dependencies: ProductionAskDependenciesParams,
  params: AskDialogueSelectionParams,
  purpose: "dialogue_selection" | "structured_repair",
  requestedRole: ChatModelRole,
  attemptOrdinal: number,
): Promise<ReservedChatCall | undefined> {
  const resolved = resolveModelForRole(requestedRole, dependencies.modelConfig);
  const reservationId = randomUUID();
  const now = (dependencies.now ?? (() => new Date()))();
  const admission = await reserveModelCost(dependencies.pool, params.deadlineAt, {
    reservationId,
    source: {
      kind: "player_action",
      townId: params.townId,
      playerActionId: params.actionId,
    },
    attemptOrdinal,
    purpose,
    model: resolved.role,
    inferenceProfile: resolved.inferenceProfile,
    priceVersion: dependencies.modelConfig.priceCatalogVersion || PRICE_CATALOG_VERSION,
    maximumCostMicroUsd: worstCaseMicroUsd(purpose, resolved.role),
    now,
  });
  if (!admission.admitted) return undefined;

  if (requestedRole === "sonnet" && reducedCostModeActive(admission.mode)) {
    await releaseModelCost(dependencies.pool, params.deadlineAt, reservationId, now);
    return reserveChatCall(dependencies, params, purpose, "haiku", attemptOrdinal + 1);
  }
  return { reservationId, ...resolved };
}

async function recordStructuredCall(params: {
  readonly dependencies: ProductionAskDependenciesParams;
  readonly request: AskDialogueSelectionParams;
  readonly reserved: ReservedChatCall;
  readonly purpose: "dialogue_selection" | "structured_repair";
  readonly runOutcome: "accepted" | "repaired" | "rejected" | "failed";
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly latencyMs: number;
  readonly validationErrorCode?: string;
  /** Ambiguous invocations keep consuming their reserved worst-case cost. */
  readonly preserveReservation?: boolean;
}): Promise<void> {
  const runId = randomUUID();
  const usage = {
    ...params.usage,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const cost = settledMicroUsd(params.reserved.role, usage);
  const now = (params.dependencies.now ?? (() => new Date()))();
  const common = {
    runId,
    townId: params.request.townId,
    playerActionId: params.request.actionId,
    model: params.reserved.role,
    inferenceProfile: params.reserved.inferenceProfile,
    usage,
    latencyMs: params.latencyMs,
    estimatedCostMicroUsd: cost,
    outcome: params.runOutcome,
    ...(params.validationErrorCode === undefined
      ? {}
      : { validationErrorCode: params.validationErrorCode }),
    now,
  } as const;
  if (params.purpose === "dialogue_selection") {
    await appendRun(params.dependencies.pool, params.request.deadlineAt, {
      ...common,
      purpose: "dialogue_selection",
      promptVersion: PROMPT_VERSIONS.npcDialogue,
      promptSha256: promptHash(NPC_DIALOGUE_PROMPT_V1_0_0),
      taskInputVersion: TASK_INPUT_VERSIONS.npcDialogue,
      outputSchemaVersion: OUTPUT_SCHEMA_NAMES.npcDialogue,
      validationPolicyVersion: VALIDATION_POLICY_VERSIONS.npcDialogue,
    });
  } else {
    await appendRun(params.dependencies.pool, params.request.deadlineAt, {
      ...common,
      purpose: "structured_repair",
      promptVersion: PROMPT_VERSIONS.structuredRepair,
      targetPromptVersion: PROMPT_VERSIONS.npcDialogue,
      promptSha256: repairPromptHash(
        NPC_DIALOGUE_PROMPT_V1_0_0,
        STRUCTURED_REPAIR_OVERLAY_V1_0_0,
      ),
      taskInputVersion: TASK_INPUT_VERSIONS.structuredRepair,
      outputSchemaVersion: OUTPUT_SCHEMA_NAMES.npcDialogue,
      validationPolicyVersion: VALIDATION_POLICY_VERSIONS.npcDialogue,
    });
  }
  if (!params.preserveReservation) {
    await settleModelCost(params.dependencies.pool, params.request.deadlineAt, {
      reservationId: params.reserved.reservationId,
      agentRunId: runId,
      settledCostMicroUsd: cost,
      now,
    });
  }
}

async function recordFailedChatCall(
  dependencies: ProductionAskDependenciesParams,
  params: AskDialogueSelectionParams,
  reserved: ReservedChatCall,
  purpose: "dialogue_selection" | "structured_repair",
  latencyMs: number,
): Promise<void> {
  await recordStructuredCall({
    dependencies,
    request: params,
    reserved,
    purpose,
    runOutcome: "failed",
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs,
    preserveReservation: true,
  });
}

async function selectDialogue(
  dependencies: ProductionAskDependenciesParams,
  params: AskDialogueSelectionParams,
): Promise<AskDialogueSelection> {
  const requestedRole = resolveDialogueModelRole(
    dependencies.modelConfig.reducedCostOverride,
  );
  const reserved = await reserveChatCall(
    dependencies,
    params,
    "dialogue_selection",
    requestedRole,
    params.attempt * 10,
  );
  if (reserved === undefined) return fallbackSelection(params);

  let rejectedRaw = "";
  const startedAt = Date.now();
  const now = (dependencies.now ?? (() => new Date()))();
  const outcome = await converseWithRetry(
    dependencies.converseClient,
    {
      modelId: reserved.modelId,
      systemPrompt: NPC_DIALOGUE_PROMPT_V1_0_0,
      userMessageJson: JSON.stringify(params.assembled.input),
      outputSchemaName: OUTPUT_SCHEMA_NAMES.npcDialogue,
      outputSchemaDescription: OUTPUT_SCHEMA_DESCRIPTIONS.npcDialogue,
      jsonSchema: toBedrockJsonSchema(NpcDialogueV1Schema),
      outputSchema: NpcDialogueV1Schema,
      temperature: INFERENCE_SETTINGS.npcDialogue.temperature,
      maxTokens: INFERENCE_SETTINGS.npcDialogue.maximumOutputTokens,
      abortSignal: AbortSignal.timeout(
        boundedTimeoutMs(params.deadlineAt, MODEL_DEADLINES.sonnetDialogueMs, now),
      ),
      worstCaseMs: MODEL_DEADLINES.sonnetDialogueMs,
      onRejectedRawText: (raw) => {
        rejectedRaw = raw;
      },
    },
    {
      now,
      retryNow: (dependencies.now ?? (() => new Date()))(),
      applicationDeadlineAt: new Date(params.deadlineAt),
      worstCaseMs: MODEL_DEADLINES.sonnetDialogueMs,
      reserveMs: 0,
    },
  );
  const latencyMs = Math.max(0, Date.now() - startedAt);

  let failure: DialogueValidationFailure;
  if (outcome.kind === "accepted") {
    const validation = validateNpcDialogueSelection(
      outcome.result,
      params.assembled.trustedContext,
    );
    if (validation.valid) {
      await recordStructuredCall({
        dependencies,
        request: params,
        reserved,
        purpose: "dialogue_selection",
        runOutcome: "accepted",
        usage: outcome.usage,
        latencyMs,
      });
      return toAskSelection(validation, params, "selected");
    }
    failure = validation;
    rejectedRaw = JSON.stringify(outcome.result);
    await recordStructuredCall({
      dependencies,
      request: params,
      reserved,
      purpose: "dialogue_selection",
      runOutcome: "rejected",
      usage: outcome.usage,
      latencyMs,
      validationErrorCode: validationCode(failure),
    });
  } else {
    await recordFailedChatCall(
      dependencies,
      params,
      reserved,
      "dialogue_selection",
      latencyMs,
    );
    if (
      (outcome.kind !== "parse_failure" && outcome.kind !== "schema_failure") ||
      rejectedRaw.length === 0
    ) {
      return fallbackSelection(params);
    }
    failure = {
      valid: false,
      errors: [buildValidationError("schema_mismatch", "$")],
    };
  }

  const repairInput = buildNpcDialogueRepairFromFailure({
    failedAttemptKind: "original",
    trustedContext: params.assembled.trustedContext,
    ...(params.assembled.input.untrusted_player_text === undefined
      ? {}
      : {
          untrustedPlayerText: params.assembled.input.untrusted_player_text,
        }),
    rawInvalidOutput: rejectedRaw,
    validationErrors: failure.errors,
  });
  const repairReserved = await reserveChatCall(
    dependencies,
    params,
    "structured_repair",
    "haiku",
    params.attempt * 10,
  );
  if (repairReserved === undefined) return fallbackSelection(params);

  const repairStartedAt = Date.now();
  const repairNow = (dependencies.now ?? (() => new Date()))();
  const repairOutcome = await converseWithRetry(
    dependencies.converseClient,
    {
      modelId: repairReserved.modelId,
      systemPrompt: [NPC_DIALOGUE_PROMPT_V1_0_0, STRUCTURED_REPAIR_OVERLAY_V1_0_0],
      userMessageJson: JSON.stringify(repairInput),
      outputSchemaName: OUTPUT_SCHEMA_NAMES.npcDialogue,
      outputSchemaDescription: OUTPUT_SCHEMA_DESCRIPTIONS.npcDialogue,
      jsonSchema: toBedrockJsonSchema(NpcDialogueV1Schema),
      outputSchema: NpcDialogueV1Schema,
      temperature: INFERENCE_SETTINGS.structuredRepair.temperature,
      maxTokens: INFERENCE_SETTINGS.npcDialogue.maximumOutputTokens,
      abortSignal: AbortSignal.timeout(
        boundedTimeoutMs(
          params.deadlineAt,
          MODEL_DEADLINES.haikuDialogueRepairMs,
          repairNow,
        ),
      ),
      worstCaseMs: MODEL_DEADLINES.haikuDialogueRepairMs,
    },
    {
      now: repairNow,
      retryNow: (dependencies.now ?? (() => new Date()))(),
      applicationDeadlineAt: new Date(params.deadlineAt),
      worstCaseMs: MODEL_DEADLINES.haikuDialogueRepairMs,
      reserveMs: 0,
    },
  );
  const repairLatencyMs = Math.max(0, Date.now() - repairStartedAt);
  if (repairOutcome.kind === "accepted") {
    const validation = validateNpcDialogueSelection(
      repairOutcome.result,
      params.assembled.trustedContext,
    );
    if (validation.valid) {
      await recordStructuredCall({
        dependencies,
        request: params,
        reserved: repairReserved,
        purpose: "structured_repair",
        runOutcome: "repaired",
        usage: repairOutcome.usage,
        latencyMs: repairLatencyMs,
      });
      return toAskSelection(validation, params, "repaired");
    }
    await recordStructuredCall({
      dependencies,
      request: params,
      reserved: repairReserved,
      purpose: "structured_repair",
      runOutcome: "rejected",
      usage: repairOutcome.usage,
      latencyMs: repairLatencyMs,
      validationErrorCode: validationCode(validation),
    });
  } else {
    await recordFailedChatCall(
      dependencies,
      params,
      repairReserved,
      "structured_repair",
      repairLatencyMs,
    );
  }
  return fallbackSelection(params);
}

export function createProductionAskDependencies(
  params: ProductionAskDependenciesParams,
): AskActionDependencies {
  return {
    embedQuery: (request) => embedQuery(params, request),
    selectDialogue: (request) => selectDialogue(params, request),
  };
}

/** Convenience used by the Lambda/local adapters so client construction stays here. */
export function createProductionAskActionHandler(params: {
  readonly pool: Pool;
  readonly modelConfig: ModelConfig;
  readonly now?: () => Date;
}) {
  const dependencies = createProductionAskDependencies({
    ...params,
    converseClient: createBedrockConverseClient(params.modelConfig.region),
    titanClient: createTitanEmbedClient(params.modelConfig.region),
  });
  return createAskHandler(dependencies);
}
