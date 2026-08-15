/**
 * Operator-triggered structured-output warmup (`P4-06`; docs/010 "Warmup and
 * cold-start mitigation").
 *
 * Creates no town and writes no database row of any kind — not a town, not
 * an `agent_runs` row, not a `model_cost_reservations` row. `runWarmup`
 * (`model-runtime/warmup.ts`) is the only network call; this command's only
 * job is translating its results into metrics. The reservation ledger is
 * deliberately not involved: four tiny synthetic calls roughly once every 20
 * hours (`WARMUP_INTERVAL_HOURS`) cost a negligible, effectively-constant
 * amount against Decision 004's monthly ceiling, and admitting through the
 * same path a player action uses would mean a warmup could itself be
 * rejected by `fallback_only` mode — the one time it must never be silently
 * skipped is exactly when spend is already high and the cache is coldest.
 *
 * The Bedrock client is a required, caller-supplied parameter, not
 * constructed inside this module — `scripts/model-prewarm.mjs` is the one
 * real caller and builds it via `createBedrockConverseClient`; a test
 * supplies a spy instead. This is the same injection shape `runWarmup`
 * itself already uses, kept one level up so this module needs no AWS SDK
 * mock to unit test.
 */

import {
  runWarmup,
  type BedrockConverseClient,
  type ModelResolutionConfig,
  type WarmupPairResult,
} from "@the-town-remembers/model-runtime";

import { logEvent } from "../../observability/events.js";
import { recordWarmupResult } from "../../observability/metrics.js";

export interface PrewarmCommandParams {
  readonly client: BedrockConverseClient;
  readonly config: ModelResolutionConfig;
  readonly now?: () => Date;
  /** Generous default: warmup shares no budget with a player turn. */
  readonly deadlineMs?: number;
  readonly abortSignal?: AbortSignal;
}

export interface PrewarmCommandResult {
  readonly results: readonly WarmupPairResult[];
  readonly allSucceeded: boolean;
}

const DEFAULT_DEADLINE_MS = 30_000;

export async function runPrewarmCommand(
  params: PrewarmCommandParams,
): Promise<PrewarmCommandResult> {
  const deadlineMs = params.deadlineMs ?? DEFAULT_DEADLINE_MS;

  const results = await runWarmup({
    client: params.client,
    config: params.config,
    now: params.now ?? (() => new Date()),
    abortSignal: params.abortSignal ?? AbortSignal.timeout(deadlineMs),
    deadlineMs,
  });

  for (const result of results) {
    logEvent({
      event: "warmup_result",
      modelRole: result.modelRole,
      schema: result.schema,
      outcome: result.outcome,
      latencyMs: result.latencyMs,
      estimatedCostMicroUsd: result.estimatedCostMicroUsd,
    });
    recordWarmupResult(result);
  }

  return {
    results,
    allSucceeded: results.every((result) => result.outcome === "success"),
  };
}
