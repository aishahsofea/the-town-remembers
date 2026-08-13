/**
 * `agent_runs` telemetry (`P4-05`, `D4-N`; docs/004 §"Model run ledger").
 *
 * One call to {@link appendRun} per resolved model call attempt, written in
 * its own short transaction so a later, unrelated conflict elsewhere can
 * never erase incurred cost or hide a rejected attempt (migration 0008's own
 * header comment). The insert is `ON CONFLICT (town_id, id) DO NOTHING`: a
 * caller-supplied, already-known `runId` (the natural choice is the
 * triggering `model_cost_reservations` row's own id, since Decision 004
 * reserves separately per attempt) makes a retried call — whether from an
 * ambiguous commit or an outer at-least-once retry — a safe no-op rather
 * than a unique-constraint violation.
 *
 * `AppendRunParams` is a discriminated union on `purpose` so the
 * purpose-branched contract-version columns
 * (`ck_agent_runs__contract_versions`, `ck_agent_runs__target_prompt_version`)
 * cannot be constructed wrong: the two embedding purposes structurally admit
 * none of the four contract fields, `structured_repair` structurally
 * requires `targetPromptVersion` alongside them, and the remaining
 * structured purposes require the four but forbid `targetPromptVersion`.
 */

import {
  asUuid,
  runSerializable,
  type AgentRunOutcome,
  type TransactionContext,
} from "@the-town-remembers/database";
import type { PricingModelKey } from "@the-town-remembers/model-runtime";
import type { Pool } from "pg";

import { logEvent } from "../observability/events.js";
import { recordModelRun } from "../observability/metrics.js";

export interface AgentRunTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

interface AppendRunBaseParams {
  /** Caller-supplied and stable across a retry of this same call attempt — see module doc. */
  readonly runId: string;
  readonly townId: string;
  readonly playerActionId?: string;
  readonly ambientJobExecutionId?: string;
  readonly worldEventId?: string;
  /** The pricing/role key (`price-catalog.ts#PricingModelKey`) — distinct from `inferenceProfile`, which carries the actual AWS resource identifier. */
  readonly model: PricingModelKey;
  /** The resolved ARN when configured, the resolved model id otherwise (`D4-N`) — never the empty string. */
  readonly inferenceProfile: string;
  readonly promptVersion: string;
  readonly usage: AgentRunTokenUsage;
  readonly latencyMs: number;
  readonly estimatedCostMicroUsd: number;
  readonly outcome: AgentRunOutcome;
  readonly validationErrorCode?: string;
  readonly now: Date;
}

/**
 * Three flat interfaces, not `AppendRunBaseParams & (union)` — TypeScript's
 * control-flow narrowing does not reliably distribute an intersection over a
 * union when branching on the discriminant, so `contractColumns` below would
 * lose the narrowing an `if`/`switch` on `purpose` ought to give it.
 */
interface AppendRunEmbeddingParams extends AppendRunBaseParams {
  readonly purpose: "episode_embedding" | "query_embedding";
}

interface AppendRunRepairParams extends AppendRunBaseParams {
  readonly purpose: "structured_repair";
  readonly targetPromptVersion: string;
  readonly promptSha256: Uint8Array;
  readonly taskInputVersion: string;
  readonly outputSchemaVersion: string;
  readonly validationPolicyVersion: string;
}

interface AppendRunStructuredParams extends AppendRunBaseParams {
  readonly purpose: "claim_normalization" | "dialogue_selection" | "ambient_choice";
  readonly promptSha256: Uint8Array;
  readonly taskInputVersion: string;
  readonly outputSchemaVersion: string;
  readonly validationPolicyVersion: string;
}

export type AppendRunParams =
  AppendRunEmbeddingParams | AppendRunRepairParams | AppendRunStructuredParams;

export class InvalidAgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAgentRunError";
  }
}

export class AgentRunPersistenceAmbiguousError extends Error {
  constructor(runId: string) {
    super(
      `Recording agent run "${runId}" had an ambiguous outcome and the row is not yet visible — retry the append.`,
    );
    this.name = "AgentRunPersistenceAmbiguousError";
  }
}

function assertHasCausalSource(params: AppendRunParams): void {
  const sourceCount = [
    params.playerActionId,
    params.ambientJobExecutionId,
    params.worldEventId,
  ].filter((value) => value !== undefined).length;
  if (sourceCount === 0) {
    throw new InvalidAgentRunError(
      `Agent run "${params.runId}" names no causal source — at least one of playerActionId, ambientJobExecutionId, or worldEventId is required.`,
    );
  }
}

function assertValidInferenceProfile(params: AppendRunParams): void {
  if (params.inferenceProfile.length === 0) {
    throw new InvalidAgentRunError(
      `Agent run "${params.runId}" has an empty inferenceProfile — D4-N requires the resolved ARN or model id.`,
    );
  }
}

function assertValidPromptSha256(params: AppendRunParams): void {
  if ("promptSha256" in params && params.promptSha256.byteLength !== 32) {
    throw new InvalidAgentRunError(
      `Agent run "${params.runId}"'s promptSha256 is ${params.promptSha256.byteLength} bytes, not 32.`,
    );
  }
}

interface ContractColumns {
  readonly targetPromptVersion: string | null;
  readonly promptSha256: Uint8Array | null;
  readonly taskInputVersion: string | null;
  readonly outputSchemaVersion: string | null;
  readonly validationPolicyVersion: string | null;
}

function contractColumns(params: AppendRunParams): ContractColumns {
  switch (params.purpose) {
    case "episode_embedding":
    case "query_embedding":
      return {
        targetPromptVersion: null,
        promptSha256: null,
        taskInputVersion: null,
        outputSchemaVersion: null,
        validationPolicyVersion: null,
      };
    case "structured_repair":
      return {
        targetPromptVersion: params.targetPromptVersion,
        promptSha256: params.promptSha256,
        taskInputVersion: params.taskInputVersion,
        outputSchemaVersion: params.outputSchemaVersion,
        validationPolicyVersion: params.validationPolicyVersion,
      };
    case "claim_normalization":
    case "dialogue_selection":
    case "ambient_choice":
      return {
        targetPromptVersion: null,
        promptSha256: params.promptSha256,
        taskInputVersion: params.taskInputVersion,
        outputSchemaVersion: params.outputSchemaVersion,
        validationPolicyVersion: params.validationPolicyVersion,
      };
  }
}

async function insertRun(
  transaction: TransactionContext,
  params: AppendRunParams,
): Promise<void> {
  const contract = contractColumns(params);
  await transaction.query(
    `INSERT INTO public.agent_runs
       (town_id, id, player_action_id, ambient_job_execution_id, world_event_id,
        purpose, model, inference_profile, prompt_version, target_prompt_version,
        prompt_sha256, task_input_version, output_schema_version,
        validation_policy_version, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, latency_ms, estimated_cost, outcome,
        validation_error_code, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23)
     ON CONFLICT (town_id, id) DO NOTHING`,
    [
      params.townId,
      params.runId,
      params.playerActionId ?? null,
      params.ambientJobExecutionId ?? null,
      params.worldEventId ?? null,
      params.purpose,
      params.model,
      params.inferenceProfile,
      params.promptVersion,
      contract.targetPromptVersion,
      contract.promptSha256,
      contract.taskInputVersion,
      contract.outputSchemaVersion,
      contract.validationPolicyVersion,
      params.usage.inputTokens,
      params.usage.outputTokens,
      params.usage.cacheReadTokens,
      params.usage.cacheWriteTokens,
      params.latencyMs,
      microUsdToEstimatedCostDecimal(params.estimatedCostMicroUsd),
      params.outcome,
      params.validationErrorCode ?? null,
      params.now,
    ],
  );
}

/** Local, deliberately duplicated rather than imported: this module's only tie to `model-runtime` would otherwise be this one conversion. */
function microUsdToEstimatedCostDecimal(microUsd: number): string {
  const rounded = Math.round(microUsd);
  const wholePart = Math.floor(rounded / 1_000_000);
  const fractionalPart = String(rounded % 1_000_000).padStart(6, "0");
  return `${wholePart}.${fractionalPart}`;
}

async function readRunExists(
  pool: Pool,
  townId: string,
  runId: string,
): Promise<boolean> {
  const result = await pool.query<{ readonly id: string }>(
    `SELECT id FROM public.agent_runs WHERE town_id = $1 AND id = $2`,
    [townId, runId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/**
 * Records one resolved model call attempt. Idempotent for a given `runId`:
 * a caller retrying after an ambiguous commit, or replaying an at-least-once
 * job, writes the same row at most once.
 */
function logRunRecorded(params: AppendRunParams): void {
  // Logged once, after the write is confirmed durable — never inside the
  // transaction body, and never with the prompt, raw model output, or any
  // player-authored text, only identity, versions, and measures.
  logEvent({
    event: "model_run_recorded",
    runId: asUuid(params.runId),
    purpose: params.purpose,
    model: params.model,
    outcome: params.outcome,
    latencyMs: params.latencyMs,
    estimatedCostMicroUsd: params.estimatedCostMicroUsd,
  });
  recordModelRun({
    purpose: params.purpose,
    outcome: params.outcome,
    latencyMs: params.latencyMs,
    estimatedCostMicroUsd: params.estimatedCostMicroUsd,
  });
}

export async function appendRun(
  pool: Pool,
  deadlineAt: number,
  params: AppendRunParams,
): Promise<void> {
  assertHasCausalSource(params);
  assertValidInferenceProfile(params);
  assertValidPromptSha256(params);

  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    insertRun(transaction, params),
  );
  if (result.outcome === "committed") {
    logRunRecorded(params);
    return;
  }

  const landed = await readRunExists(pool, params.townId, params.runId);
  if (landed) {
    logRunRecorded(params);
    return;
  }
  throw new AgentRunPersistenceAmbiguousError(params.runId);
}
