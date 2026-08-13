/**
 * Resumable operator backfill for episodes still `pending`/`failed`
 * embedding (`P4-07`; `D4-Q`'s "retried by (a) the operator backfill
 * command").
 *
 * Resumability is a property of the *data*, not of this command: every pass
 * calls `episodes.ts#readPendingEmbeddings`, which by construction only ever
 * returns rows still `pending`/`failed`. Killing this command mid-run and
 * rerunning it costs nothing beyond the wasted work already committed —
 * every episode this run already resolved to `ready` simply stops appearing
 * in the next pass's query, so nothing is re-embedded and nothing is
 * skipped. There is no separate checkpoint or resume token to keep in sync
 * with the truth.
 *
 * Bounded by `contentVersion` (never an unscoped scan: `towns` is read
 * `WHERE content_version = $1` before any embedding call happens) and,
 * within each town, by `batchSize` per page and `concurrency` in flight at
 * once — a real Titan account has its own request-rate ceiling this command
 * must not run past.
 *
 * Each embedding call goes through the same cost ledger a player-facing
 * call would (`model-cost.ts#reserveModelCost`/`settleModelCost`/
 * `releaseModelCost`, `model-runs.ts#appendRun`) — backfill work is real
 * spend, not exempt the way `prewarm.ts`'s four fixed warmup calls are.
 * Reservations are sourced by the episode's own causing `world_event_id`;
 * since more than one episode can share one event (a second NPC also
 * witnessing it), `attempt_ordinal` is allocated by counting this event's
 * already-reserved attempts rather than assumed to be `0`, with a small
 * bounded retry on the rare concurrent-collision case.
 */

import { randomUUID } from "node:crypto";

import {
  asVector256,
  runSerializable,
  type TransactionContext,
} from "@the-town-remembers/database";
import {
  embedTextWithRetry,
  PRICE_CATALOG_VERSION,
  settledMicroUsd,
  worstCaseMicroUsd,
  type TitanEmbedClient,
} from "@the-town-remembers/model-runtime";
import type { Pool } from "pg";

import {
  markEmbeddingFailed,
  markEmbeddingReady,
  readPendingEmbeddings,
} from "../../persistence/episodes.js";
import {
  releaseModelCost,
  reserveModelCost,
  settleModelCost,
} from "../../persistence/model-cost.js";
import { appendRun } from "../../persistence/model-runs.js";

const EMBEDDING_PROMPT_VERSION = "titan-embed-text-v2";
const MAX_ATTEMPT_ORDINAL_RETRIES = 5;

export interface EmbedSeedParams {
  readonly pool: Pool;
  readonly client: TitanEmbedClient;
  readonly modelId: string;
  readonly contentVersion: string;
  /** Restricts the backfill to one town — omitted, every town at `contentVersion`. */
  readonly townId?: string;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly now: () => Date;
  readonly callDeadlineMs: number;
  readonly reservationDeadlineMs: number;
}

export interface EmbedSeedResult {
  readonly readyCount: number;
  readonly failedCount: number;
  readonly townsProcessed: number;
}

async function eligibleTownIds(
  pool: Pool,
  contentVersion: string,
  townId?: string,
): Promise<readonly string[]> {
  if (townId !== undefined) {
    const result = await pool.query<{ readonly id: string }>(
      `SELECT id FROM public.towns WHERE id = $1 AND content_version = $2`,
      [townId, contentVersion],
    );
    return result.rows.map((row) => row.id);
  }
  const result = await pool.query<{ readonly id: string }>(
    `SELECT id FROM public.towns WHERE content_version = $1 ORDER BY id`,
    [contentVersion],
  );
  return result.rows.map((row) => row.id);
}

async function attemptOrdinalCount(
  transaction: TransactionContext,
  worldEventId: string,
): Promise<number> {
  const rows = await transaction.query<{ readonly count: string }>(
    `SELECT count(*)::INT8 AS count FROM public.model_cost_reservations
      WHERE world_event_id = $1 AND purpose = 'episode_embedding'`,
    [worldEventId],
  );
  return Number(rows[0]!.count);
}

interface EmbedOneOutcome {
  readonly status: "ready" | "failed";
}

async function embedOneEpisode(params: {
  readonly pool: Pool;
  readonly client: TitanEmbedClient;
  readonly modelId: string;
  readonly townId: string;
  readonly episodeId: string;
  readonly worldEventId: string;
  readonly summary: string;
  readonly now: Date;
  readonly callDeadlineMs: number;
  readonly reservationDeadlineMs: number;
}): Promise<EmbedOneOutcome> {
  const worstCase = worstCaseMicroUsd("episode_embedding", "titan");
  const reservationDeadlineAt = Date.now() + params.reservationDeadlineMs;

  let admitted: { readonly reservationId: string } | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPT_ORDINAL_RETRIES; attempt += 1) {
    const reservationId = randomUUID();
    const attemptOrdinal = await runSerializable(
      params.pool,
      { deadlineAt: reservationDeadlineAt },
      (transaction) => attemptOrdinalCount(transaction, params.worldEventId),
    ).then((result) => (result.outcome === "committed" ? result.value : attempt));

    try {
      const decision = await reserveModelCost(params.pool, reservationDeadlineAt, {
        reservationId,
        source: {
          kind: "world_event",
          townId: params.townId,
          worldEventId: params.worldEventId,
        },
        attemptOrdinal,
        purpose: "episode_embedding",
        model: "titan",
        inferenceProfile: params.modelId,
        priceVersion: PRICE_CATALOG_VERSION,
        maximumCostMicroUsd: worstCase,
        now: params.now,
      });
      if (!decision.admitted) return { status: "failed" };
      admitted = { reservationId };
      break;
    } catch (error) {
      const category = (error as { readonly category?: string }).category;
      if (category !== "unique_violation") throw error;
      // Another episode from the same event reserved this exact ordinal
      // first — recount and try the next one.
    }
  }
  if (admitted === undefined) return { status: "failed" };

  const deadlineAt = params.now.getTime() + params.callDeadlineMs;
  const outcome = await embedTextWithRetry(
    params.client,
    {
      modelId: params.modelId,
      inputText: params.summary,
      abortSignal: AbortSignal.timeout(params.callDeadlineMs),
    },
    {
      now: params.now,
      applicationDeadlineAt: new Date(deadlineAt),
      worstCaseMs: params.callDeadlineMs,
      reserveMs: 0,
    },
  );

  const runId = randomUUID();
  const latencyMs = Date.now() - params.now.getTime();

  if (outcome.kind !== "accepted") {
    await appendRun(params.pool, reservationDeadlineAt, {
      runId,
      townId: params.townId,
      worldEventId: params.worldEventId,
      model: "titan",
      inferenceProfile: params.modelId,
      promptVersion: EMBEDDING_PROMPT_VERSION,
      purpose: "episode_embedding",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      latencyMs,
      estimatedCostMicroUsd: 0,
      outcome: "failed",
      now: params.now,
    });
    await releaseModelCost(
      params.pool,
      reservationDeadlineAt,
      admitted.reservationId,
      params.now,
    );
    await markEmbeddingFailed(
      params.pool,
      reservationDeadlineAt,
      params.townId,
      params.episodeId,
      params.now,
    );
    return { status: "failed" };
  }

  const settledCostMicroUsd = settledMicroUsd("titan", {
    inputTokens: outcome.inputTextTokenCount,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  await appendRun(params.pool, reservationDeadlineAt, {
    runId,
    townId: params.townId,
    worldEventId: params.worldEventId,
    model: "titan",
    inferenceProfile: params.modelId,
    promptVersion: EMBEDDING_PROMPT_VERSION,
    purpose: "episode_embedding",
    usage: {
      inputTokens: outcome.inputTextTokenCount,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    latencyMs,
    estimatedCostMicroUsd: settledCostMicroUsd,
    outcome: "accepted",
    now: params.now,
  });
  await settleModelCost(params.pool, reservationDeadlineAt, {
    reservationId: admitted.reservationId,
    agentRunId: runId,
    settledCostMicroUsd,
    now: params.now,
  });
  await markEmbeddingReady(
    params.pool,
    reservationDeadlineAt,
    params.townId,
    params.episodeId,
    asVector256(outcome.embedding),
    params.now,
  );
  return { status: "ready" };
}

async function readEpisodeWorldEvent(
  pool: Pool,
  townId: string,
  episodeId: string,
): Promise<string> {
  const result = await pool.query<{ readonly event_id: string }>(
    `SELECT event_id FROM public.episodes WHERE town_id = $1 AND id = $2`,
    [townId, episodeId],
  );
  return result.rows[0]!.event_id;
}

async function processBatchConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await handler(items[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

/** Backfills every `pending`/`failed` episode embedding at `contentVersion`, one town and one bounded batch at a time. */
export async function runEmbedSeedCommand(
  params: EmbedSeedParams,
): Promise<EmbedSeedResult> {
  const townIds = await eligibleTownIds(
    params.pool,
    params.contentVersion,
    params.townId,
  );
  let readyCount = 0;
  let failedCount = 0;

  for (const townId of townIds) {
    // A row that fails stays `failed` — eligible for a *future* run's own
    // pass, by design (`D4-Q`) — but must not be retried a second time
    // within *this* run, or a persistently-failing episode would keep
    // reappearing in every next page forever. `attempted` is this run's own
    // per-town memory of what it has already tried, independent of the
    // durable `embedding_status` a retry candidate keeps for later.
    const attempted = new Set<string>();
    for (;;) {
      const page = await readPendingEmbeddings(
        params.pool,
        townId,
        params.batchSize,
        Array.from(attempted),
      );
      if (page.length === 0) break;

      await processBatchConcurrently(page, params.concurrency, async (row) => {
        attempted.add(row.episodeId);
        const worldEventId = await readEpisodeWorldEvent(
          params.pool,
          townId,
          row.episodeId,
        );
        const outcome = await embedOneEpisode({
          pool: params.pool,
          client: params.client,
          modelId: params.modelId,
          townId,
          episodeId: row.episodeId,
          worldEventId,
          summary: row.summary,
          now: params.now(),
          callDeadlineMs: params.callDeadlineMs,
          reservationDeadlineMs: params.reservationDeadlineMs,
        });
        if (outcome.status === "ready") readyCount += 1;
        else failedCount += 1;
      });
    }
  }

  return { readyCount, failedCount, townsProcessed: townIds.length };
}
