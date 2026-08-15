/**
 * Production Bedrock implementation behind `normalize_claim`'s injected
 * seam (`P4-12`).
 *
 * Unlike Ask's dialogue selection, claim normalization has no authored
 * fallback (Decision 006): invalid output that stays invalid through one
 * repair attempt throws `ModelSelectionUnavailableError` rather than
 * substituting presentation text for a proposition that was never
 * validated. `model-executor.ts` is the one place that catches it and
 * writes the terminal `503` (`D4-O`).
 */

import { randomUUID } from "node:crypto";

import { BELL_MYSTERY_V1, renderClaimSentence } from "@the-town-remembers/content";
import {
  buildClaimNormalizationInput,
  buildClaimNormalizationRepairFromFailure,
  buildValidationError,
  CLAIM_NORMALIZATION_PROMPT_V1_0_0,
  ClaimNormalizationV1Schema,
  converseWithRetry,
  createBedrockConverseClient,
  OUTPUT_SCHEMA_DESCRIPTIONS,
  OUTPUT_SCHEMA_NAMES,
  PRICE_CATALOG_VERSION,
  PROMPT_VERSIONS,
  promptHash,
  repairPromptHash,
  resolveModelForRole,
  settledMicroUsd,
  STRUCTURED_REPAIR_OVERLAY_V1_0_0,
  TASK_INPUT_VERSIONS,
  toBedrockJsonSchema,
  validateClaimNormalization,
  VALIDATION_POLICY_VERSIONS,
  worstCaseMicroUsd,
  type BedrockConverseClient,
  type ClaimNormalizationReasonCode,
  type NormalizationValidationFailure,
  type NormalizationValidationSuccess,
  type ResolvedModel,
  type TokenUsageSummary,
} from "@the-town-remembers/model-runtime";
import { MODEL_DEADLINES } from "@the-town-remembers/runtime-config/model";
import type { ModelConfig } from "@the-town-remembers/runtime-config/model";
import type { Pool } from "pg";

import { reserveModelCost } from "../../persistence/model-cost.js";
import { appendRun } from "../../persistence/model-runs.js";
import {
  resolveAllegedSourceActorId,
  resolveCanonicalEntityIds,
} from "../../persistence/drafts.js";
import {
  createNormalizeClaimActionHandler as createHandler,
  type NormalizeClaimActionDependencies,
  type NormalizeClaimSelection,
  type NormalizeClaimSelectionParams,
} from "./inputs/normalize-claim.js";
import { ModelSelectionUnavailableError } from "./model-executor.js";

const CLAIM_DRAFT_TTL_MS = 10 * 60 * 1000;

/** Player-safe, deterministic copy — never model-generated. */
const CLAIM_NORMALIZATION_EXPLANATIONS: Record<ClaimNormalizationReasonCode, string> = {
  ambiguous_subject: "I can't tell who that's about. Try naming them directly.",
  ambiguous_object:
    "I can't tell what that's about. Try naming the place, item, or reason directly.",
  ambiguous_predicate: "I'm not sure what you're claiming happened.",
  ambiguous_polarity: "I can't tell whether you mean this did or didn't happen.",
  ambiguous_context: "I can't tell when this happened.",
  ambiguous_source: "I can't tell who you're saying told you this.",
  multiple_propositions: "That reads as more than one claim. Tell me one at a time.",
  unknown_entity: "I don't recognize someone or something you named.",
  unsupported_context: "That's not a time I can record a claim about.",
  outside_claim_grammar: "That's not something I can record as a claim.",
  no_proposition: "I didn't find a claim in that.",
};

function unavailable(): never {
  throw new ModelSelectionUnavailableError(503, {
    code: "MODEL_UNAVAILABLE_RETRY_ACTION",
    title: "Model unavailable",
    detail:
      "That statement could not be classified right now. Retry with a new request.",
    fieldErrors: [],
  });
}

export interface ProductionNormalizeClaimDependenciesParams {
  readonly pool: Pool;
  readonly modelConfig: ModelConfig;
  readonly converseClient: BedrockConverseClient;
  readonly now?: () => Date;
}

function boundedTimeoutMs(deadlineAt: number, capMs: number, now: Date): number {
  return Math.max(1, Math.min(capMs, deadlineAt - now.getTime()));
}

function validationCode(failure: NormalizationValidationFailure): string {
  return failure.errors[0]?.code ?? "schema_mismatch";
}

async function resolveNormalizedSelection(
  pool: Pool,
  townId: string,
  validation: NormalizationValidationSuccess,
  responseMode: "selected" | "repaired",
): Promise<NormalizeClaimSelection> {
  const result = validation.result;
  if (result.status !== "normalized" || validation.normalizedKey === null) {
    return unavailable();
  }
  const entityIds = await resolveCanonicalEntityIds(pool, townId, [
    result.subject_entity_id!,
    result.object_entity_id!,
  ]);
  const subject = entityIds.get(result.subject_entity_id!);
  const object = entityIds.get(result.object_entity_id!);
  // The trusted context sent only real content keys; a missing row here
  // means the town was seeded incompletely, not that the model erred.
  if (subject === undefined || object === undefined) return unavailable();

  const allegedSource =
    result.alleged_source_actor_id === null
      ? null
      : await (async () => {
          const character = BELL_MYSTERY_V1.characters.find(
            (candidate) => candidate.entityKey === result.alleged_source_actor_id,
          );
          const actorId = await resolveAllegedSourceActorId(
            pool,
            townId,
            result.alleged_source_actor_id!,
          );
          if (character === undefined || actorId === undefined) return unavailable();
          return { id: actorId, displayName: character.displayName };
        })();

  const canonicalText = renderClaimSentence(BELL_MYSTERY_V1, {
    subjectEntityKey: result.subject_entity_id!,
    predicate: result.predicate!,
    objectEntityKey: result.object_entity_id!,
    polarity: result.polarity!,
    contextKey: result.context_key!,
  });

  return {
    // `ValidatedDialogueResume.npcId` is dialogue-shaped scaffolding this
    // kind has no use for — normalize_claim classifies text independent of
    // any one NPC; nothing downstream reads this field.
    npcId: "",
    text: canonicalText,
    responseMode,
    outcome: {
      kind: "normalized",
      subjectEntityId: subject.id,
      subjectEntityType: subject.entityType,
      predicate: result.predicate!,
      objectEntityId: object.id,
      objectEntityType: object.entityType,
      polarity: result.polarity!,
      contextKey: result.context_key!,
      normalizedKey: validation.normalizedKey,
      allegedSource,
      canonicalText,
      expiresAt: new Date(Date.now() + CLAIM_DRAFT_TTL_MS),
    },
  };
}

function needsRevisionSelection(
  validation: NormalizationValidationSuccess,
  responseMode: "selected" | "repaired",
): NormalizeClaimSelection {
  const result = validation.result;
  const reasonCode = result.reason_code as ClaimNormalizationReasonCode;
  return {
    // `ValidatedDialogueResume.npcId` is dialogue-shaped scaffolding this
    // kind has no use for — normalize_claim classifies text independent of
    // any one NPC; nothing downstream reads this field.
    npcId: "",
    text: CLAIM_NORMALIZATION_EXPLANATIONS[reasonCode],
    responseMode,
    outcome: {
      kind: "needs_revision",
      explanation: CLAIM_NORMALIZATION_EXPLANATIONS[reasonCode],
    },
  };
}

async function toSelection(
  pool: Pool,
  townId: string,
  validation: NormalizationValidationSuccess,
  responseMode: "selected" | "repaired",
): Promise<NormalizeClaimSelection> {
  if (validation.result.status === "normalized") {
    return resolveNormalizedSelection(pool, townId, validation, responseMode);
  }
  // needs_clarification and unsupported both resolve through the same
  // authored-copy table, keyed by reason_code — no separate branch needed.
  return needsRevisionSelection(validation, responseMode);
}

async function normalizeClaim(
  dependencies: ProductionNormalizeClaimDependenciesParams,
  params: NormalizeClaimSelectionParams,
): Promise<NormalizeClaimSelection> {
  const now = (dependencies.now ?? (() => new Date()))();
  const resolved = resolveModelForRole("haiku", dependencies.modelConfig);
  const reservationId = randomUUID();
  const admission = await reserveModelCost(dependencies.pool, params.deadlineAt, {
    reservationId,
    source: {
      kind: "player_action",
      townId: params.townId,
      playerActionId: params.actionId,
    },
    attemptOrdinal: params.attempt * 10,
    purpose: "claim_normalization",
    model: resolved.role,
    inferenceProfile: resolved.inferenceProfile,
    priceVersion: dependencies.modelConfig.priceCatalogVersion || PRICE_CATALOG_VERSION,
    maximumCostMicroUsd: worstCaseMicroUsd("claim_normalization", resolved.role),
    now,
  });
  if (!admission.admitted) return unavailable();

  const input = buildClaimNormalizationInput({
    trustedContext: params.trustedContext,
    untrustedPlayerText: params.untrustedPlayerText,
  });

  let rejectedRaw = "";
  const startedAt = Date.now();
  const outcome = await converseWithRetry(
    dependencies.converseClient,
    {
      modelId: resolved.modelId,
      systemPrompt: CLAIM_NORMALIZATION_PROMPT_V1_0_0,
      userMessageJson: JSON.stringify(input),
      outputSchemaName: OUTPUT_SCHEMA_NAMES.claimNormalization,
      outputSchemaDescription: OUTPUT_SCHEMA_DESCRIPTIONS.claimNormalization,
      jsonSchema: toBedrockJsonSchema(ClaimNormalizationV1Schema),
      outputSchema: ClaimNormalizationV1Schema,
      temperature: 0,
      maxTokens: 256,
      abortSignal: AbortSignal.timeout(
        boundedTimeoutMs(params.deadlineAt, MODEL_DEADLINES.haikuNormalizationMs, now),
      ),
      worstCaseMs: MODEL_DEADLINES.haikuNormalizationMs,
      onRejectedRawText: (raw) => {
        rejectedRaw = raw;
      },
    },
    {
      now,
      retryNow: dependencies.now ?? (() => new Date()),
      applicationDeadlineAt: new Date(params.deadlineAt),
      worstCaseMs: MODEL_DEADLINES.haikuNormalizationMs,
      reserveMs: 0,
    },
  );
  const latencyMs = Math.max(0, Date.now() - startedAt);

  let failure: NormalizationValidationFailure;
  if (outcome.kind === "accepted") {
    const validation = validateClaimNormalization(
      outcome.result,
      params.trustedContext,
    );
    if (validation.valid) {
      const usage = { ...outcome.usage, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const cost = settledMicroUsd(resolved.role, usage);
      const runId = randomUUID();
      const recordedAt = (dependencies.now ?? (() => new Date()))();
      await appendRun(
        dependencies.pool,
        params.deadlineAt,
        {
          runId,
          townId: params.townId,
          playerActionId: params.actionId,
          model: resolved.role,
          inferenceProfile: resolved.inferenceProfile,
          purpose: "claim_normalization",
          promptVersion: PROMPT_VERSIONS.claimNormalization,
          promptSha256: promptHash(CLAIM_NORMALIZATION_PROMPT_V1_0_0),
          taskInputVersion: TASK_INPUT_VERSIONS.claimNormalization,
          outputSchemaVersion: OUTPUT_SCHEMA_NAMES.claimNormalization,
          validationPolicyVersion: VALIDATION_POLICY_VERSIONS.claimNormalization,
          usage,
          latencyMs,
          estimatedCostMicroUsd: cost,
          outcome: "accepted",
          now: recordedAt,
        },
        { kind: "settled", reservationId, settledCostMicroUsd: cost },
      );
      return toSelection(dependencies.pool, params.townId, validation, "selected");
    }
    failure = validation;
    rejectedRaw = JSON.stringify(outcome.result);
    await recordRejected(
      dependencies,
      params,
      resolved,
      reservationId,
      outcome.usage,
      latencyMs,
      validationCode(failure),
    );
  } else {
    await recordFailed(
      dependencies,
      params,
      resolved,
      reservationId,
      latencyMs,
      outcome.kind === "timeout" && !outcome.attempted,
    );
    if (
      (outcome.kind !== "parse_failure" && outcome.kind !== "schema_failure") ||
      rejectedRaw.length === 0
    ) {
      return unavailable();
    }
    failure = { valid: false, errors: [buildValidationError("schema_mismatch", "$")] };
  }

  const repairInput = buildClaimNormalizationRepairFromFailure({
    failedAttemptKind: "original",
    trustedContext: params.trustedContext,
    untrustedPlayerText: params.untrustedPlayerText,
    rawInvalidOutput: rejectedRaw,
    validationErrors: failure.errors,
  });
  const repairResolved = resolveModelForRole("haiku", dependencies.modelConfig);
  const repairReservationId = randomUUID();
  const repairNow = (dependencies.now ?? (() => new Date()))();
  const repairAdmission = await reserveModelCost(dependencies.pool, params.deadlineAt, {
    reservationId: repairReservationId,
    source: {
      kind: "player_action",
      townId: params.townId,
      playerActionId: params.actionId,
    },
    attemptOrdinal: params.attempt * 10 + 1,
    purpose: "structured_repair",
    model: repairResolved.role,
    inferenceProfile: repairResolved.inferenceProfile,
    priceVersion: dependencies.modelConfig.priceCatalogVersion || PRICE_CATALOG_VERSION,
    maximumCostMicroUsd: worstCaseMicroUsd("structured_repair", repairResolved.role),
    now: repairNow,
  });
  if (!repairAdmission.admitted) return unavailable();

  const repairStartedAt = Date.now();
  const repairOutcome = await converseWithRetry(
    dependencies.converseClient,
    {
      modelId: repairResolved.modelId,
      systemPrompt: [
        CLAIM_NORMALIZATION_PROMPT_V1_0_0,
        STRUCTURED_REPAIR_OVERLAY_V1_0_0,
      ],
      userMessageJson: JSON.stringify(repairInput),
      outputSchemaName: OUTPUT_SCHEMA_NAMES.claimNormalization,
      outputSchemaDescription: OUTPUT_SCHEMA_DESCRIPTIONS.claimNormalization,
      jsonSchema: toBedrockJsonSchema(ClaimNormalizationV1Schema),
      outputSchema: ClaimNormalizationV1Schema,
      temperature: 0,
      maxTokens: 256,
      abortSignal: AbortSignal.timeout(
        boundedTimeoutMs(
          params.deadlineAt,
          MODEL_DEADLINES.haikuNormalizationMs,
          repairNow,
        ),
      ),
      worstCaseMs: MODEL_DEADLINES.haikuNormalizationMs,
    },
    {
      now: repairNow,
      retryNow: dependencies.now ?? (() => new Date()),
      applicationDeadlineAt: new Date(params.deadlineAt),
      worstCaseMs: MODEL_DEADLINES.haikuNormalizationMs,
      reserveMs: 0,
    },
  );
  const repairLatencyMs = Math.max(0, Date.now() - repairStartedAt);

  if (repairOutcome.kind === "accepted") {
    const validation = validateClaimNormalization(
      repairOutcome.result,
      params.trustedContext,
    );
    if (validation.valid) {
      const usage = { ...repairOutcome.usage, cacheReadTokens: 0, cacheWriteTokens: 0 };
      const cost = settledMicroUsd(repairResolved.role, usage);
      const runId = randomUUID();
      const recordedAt = (dependencies.now ?? (() => new Date()))();
      await appendRun(
        dependencies.pool,
        params.deadlineAt,
        {
          runId,
          townId: params.townId,
          playerActionId: params.actionId,
          model: repairResolved.role,
          inferenceProfile: repairResolved.inferenceProfile,
          purpose: "structured_repair",
          promptVersion: PROMPT_VERSIONS.structuredRepair,
          targetPromptVersion: PROMPT_VERSIONS.claimNormalization,
          promptSha256: repairPromptHash(
            CLAIM_NORMALIZATION_PROMPT_V1_0_0,
            STRUCTURED_REPAIR_OVERLAY_V1_0_0,
          ),
          taskInputVersion: TASK_INPUT_VERSIONS.structuredRepair,
          outputSchemaVersion: OUTPUT_SCHEMA_NAMES.claimNormalization,
          validationPolicyVersion: VALIDATION_POLICY_VERSIONS.claimNormalization,
          usage,
          latencyMs: repairLatencyMs,
          estimatedCostMicroUsd: cost,
          outcome: "repaired",
          now: recordedAt,
        },
        {
          kind: "settled",
          reservationId: repairReservationId,
          settledCostMicroUsd: cost,
        },
      );
      return toSelection(dependencies.pool, params.townId, validation, "repaired");
    }
    await recordRejected(
      dependencies,
      params,
      repairResolved,
      repairReservationId,
      repairOutcome.usage,
      repairLatencyMs,
      validationCode(validation),
      "structured_repair",
    );
  } else {
    await recordFailed(
      dependencies,
      params,
      repairResolved,
      repairReservationId,
      repairLatencyMs,
      repairOutcome.kind === "timeout" && !repairOutcome.attempted,
      "structured_repair",
    );
  }
  return unavailable();
}

async function recordRejected(
  dependencies: ProductionNormalizeClaimDependenciesParams,
  params: NormalizeClaimSelectionParams,
  resolved: ResolvedModel,
  reservationId: string,
  rawUsage: TokenUsageSummary,
  latencyMs: number,
  validationErrorCode: string,
  purpose: "claim_normalization" | "structured_repair" = "claim_normalization",
): Promise<void> {
  const usage = { ...rawUsage, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const cost = settledMicroUsd(resolved.role, usage);
  const runId = randomUUID();
  const now = (dependencies.now ?? (() => new Date()))();
  const common = {
    runId,
    townId: params.townId,
    playerActionId: params.actionId,
    model: resolved.role,
    inferenceProfile: resolved.inferenceProfile,
    usage,
    latencyMs,
    estimatedCostMicroUsd: cost,
    outcome: "rejected" as const,
    validationErrorCode,
    now,
  };
  const finalization = {
    kind: "settled",
    reservationId,
    settledCostMicroUsd: cost,
  } as const;
  if (purpose === "claim_normalization") {
    await appendRun(
      dependencies.pool,
      params.deadlineAt,
      {
        ...common,
        purpose,
        promptVersion: PROMPT_VERSIONS.claimNormalization,
        promptSha256: promptHash(CLAIM_NORMALIZATION_PROMPT_V1_0_0),
        taskInputVersion: TASK_INPUT_VERSIONS.claimNormalization,
        outputSchemaVersion: OUTPUT_SCHEMA_NAMES.claimNormalization,
        validationPolicyVersion: VALIDATION_POLICY_VERSIONS.claimNormalization,
      },
      finalization,
    );
  } else {
    await appendRun(
      dependencies.pool,
      params.deadlineAt,
      {
        ...common,
        purpose,
        promptVersion: PROMPT_VERSIONS.structuredRepair,
        targetPromptVersion: PROMPT_VERSIONS.claimNormalization,
        promptSha256: repairPromptHash(
          CLAIM_NORMALIZATION_PROMPT_V1_0_0,
          STRUCTURED_REPAIR_OVERLAY_V1_0_0,
        ),
        taskInputVersion: TASK_INPUT_VERSIONS.structuredRepair,
        outputSchemaVersion: OUTPUT_SCHEMA_NAMES.claimNormalization,
        validationPolicyVersion: VALIDATION_POLICY_VERSIONS.claimNormalization,
      },
      finalization,
    );
  }
}

/**
 * Deliberately never settles or releases its reservation: an ambiguous
 * transport failure keeps consuming its reserved worst-case cost, matching
 * `ask-model.ts#recordFailedChatCall`'s `preserveReservation: true`.
 */
async function recordFailed(
  dependencies: ProductionNormalizeClaimDependenciesParams,
  params: NormalizeClaimSelectionParams,
  resolved: ResolvedModel,
  reservationId: string,
  latencyMs: number,
  provenNonCall: boolean,
  purpose: "claim_normalization" | "structured_repair" = "claim_normalization",
): Promise<void> {
  const now = (dependencies.now ?? (() => new Date()))();
  const runId = randomUUID();
  const common = {
    runId,
    townId: params.townId,
    playerActionId: params.actionId,
    model: resolved.role,
    inferenceProfile: resolved.inferenceProfile,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    latencyMs,
    estimatedCostMicroUsd: 0,
    outcome: "failed" as const,
    now,
  };
  if (purpose === "claim_normalization") {
    await appendRun(
      dependencies.pool,
      params.deadlineAt,
      {
        ...common,
        purpose,
        promptVersion: PROMPT_VERSIONS.claimNormalization,
        promptSha256: promptHash(CLAIM_NORMALIZATION_PROMPT_V1_0_0),
        taskInputVersion: TASK_INPUT_VERSIONS.claimNormalization,
        outputSchemaVersion: OUTPUT_SCHEMA_NAMES.claimNormalization,
        validationPolicyVersion: VALIDATION_POLICY_VERSIONS.claimNormalization,
      },
      provenNonCall ? { kind: "released", reservationId } : undefined,
    );
  } else {
    await appendRun(
      dependencies.pool,
      params.deadlineAt,
      {
        ...common,
        purpose,
        promptVersion: PROMPT_VERSIONS.structuredRepair,
        targetPromptVersion: PROMPT_VERSIONS.claimNormalization,
        promptSha256: repairPromptHash(
          CLAIM_NORMALIZATION_PROMPT_V1_0_0,
          STRUCTURED_REPAIR_OVERLAY_V1_0_0,
        ),
        taskInputVersion: TASK_INPUT_VERSIONS.structuredRepair,
        outputSchemaVersion: OUTPUT_SCHEMA_NAMES.claimNormalization,
        validationPolicyVersion: VALIDATION_POLICY_VERSIONS.claimNormalization,
      },
      provenNonCall ? { kind: "released", reservationId } : undefined,
    );
  }
}

export function createProductionNormalizeClaimDependencies(
  params: ProductionNormalizeClaimDependenciesParams,
): NormalizeClaimActionDependencies {
  return {
    normalizeClaim: (request) => normalizeClaim(params, request),
  };
}

export function createProductionNormalizeClaimActionHandler(params: {
  readonly pool: Pool;
  readonly modelConfig: ModelConfig;
  readonly now?: () => Date;
}) {
  const dependencies = createProductionNormalizeClaimDependencies({
    ...params,
    converseClient: createBedrockConverseClient(params.modelConfig.region),
  });
  return createHandler(dependencies);
}
