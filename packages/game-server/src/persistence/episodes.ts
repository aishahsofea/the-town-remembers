/**
 * `episodes`/`episode_references` lifecycle (`P4-07`, `D4-Q`; docs/003
 * "Titan embeds the question"; migration 0004's own header comment:
 * "Identity, text, importance, event, and references are append-only; the
 * derived embedding columns are the sole mutable exception").
 *
 * `insertEpisode` writes the episode row exactly once, in the caller's own
 * transaction (an episode is always created alongside the rest of a
 * player-action or ambient-job effect plan, never standalone) — its
 * embedding is whatever the caller already resolved *before* opening that
 * transaction, since a Titan call is a network round trip that cannot run
 * inside one: either `ready` with a vector already in hand (`D4-Q`'s inline,
 * pre-commit attempt succeeded), or `pending`/`failed` (skipped because the
 * worst case never fit before the reserve, or attempted and failed) with no
 * vector at all. There is deliberately no "insert then embed in the same
 * transaction" path.
 *
 * `markEmbeddingReady`/`markEmbeddingFailed` are each their own short
 * post-call transaction — the same shape `model-cost.ts#settleModelCost`
 * uses for the same reason (the network call happens between the episode's
 * insert and its embedding result). Both are conditional `UPDATE`s scoped
 * to `embedding_status IN ('pending', 'failed')`
 * (`ck_episodes__embedding_consistency` is what makes a `ready` row with a
 * null vector, or vice versa, impossible at the database level regardless),
 * so two concurrent attempts to resolve the same still-pending episode
 * produce exactly one write and one no-op, and neither can overwrite an
 * already-`ready` row.
 */

import {
  decodeVector,
  encodeVector,
  runSerializable,
  type EpisodeKind,
  type EpisodeReferenceKind,
  type TransactionContext,
  type Vector256,
} from "@the-town-remembers/database";
import type { Pool } from "pg";

export type EpisodeEmbeddingInput =
  | { readonly status: "ready"; readonly embedding: Vector256 }
  | { readonly status: "pending" }
  | { readonly status: "failed" };

export type EpisodeReferenceInput =
  | {
      readonly kind: Exclude<EpisodeReferenceKind, "claim">;
      readonly entityId: string;
    }
  | { readonly kind: "claim"; readonly claimId: string };

export interface InsertEpisodeParams {
  readonly episodeId: string;
  readonly townId: string;
  readonly npcId: string;
  readonly eventId: string;
  readonly episodeKind: EpisodeKind;
  readonly summary: string;
  /** 0-100 (`ck_episodes__importance`). */
  readonly importance: number;
  readonly occurredAt: Date;
  readonly embedding: EpisodeEmbeddingInput;
  readonly references: readonly EpisodeReferenceInput[];
  readonly now: Date;
}

function embeddingColumns(embedding: EpisodeEmbeddingInput): {
  readonly status: "pending" | "ready" | "failed";
  readonly vector: string | null;
} {
  if (embedding.status === "ready") {
    return { status: "ready", vector: encodeVector(embedding.embedding) };
  }
  return { status: embedding.status, vector: null };
}

/** Inserts one episode row and its references. Never opens its own transaction — always part of a larger effect-application commit. */
export async function insertEpisode(
  transaction: TransactionContext,
  params: InsertEpisodeParams,
): Promise<void> {
  const columns = embeddingColumns(params.embedding);

  await transaction.query(
    `INSERT INTO public.episodes
       (town_id, id, npc_id, event_id, episode_kind, summary, importance,
        occurred_at, embedding, embedding_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      params.townId,
      params.episodeId,
      params.npcId,
      params.eventId,
      params.episodeKind,
      params.summary,
      params.importance,
      params.occurredAt,
      columns.vector,
      columns.status,
      params.now,
    ],
  );

  for (const reference of params.references) {
    await transaction.query(
      `INSERT INTO public.episode_references
         (town_id, episode_id, reference_kind, entity_id, claim_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.townId,
        params.episodeId,
        reference.kind,
        reference.kind === "claim" ? null : reference.entityId,
        reference.kind === "claim" ? reference.claimId : null,
        params.now,
      ],
    );
  }
}

export class EpisodeEmbeddingResolutionAmbiguousError extends Error {
  constructor(episodeId: string, action: "settle" | "release") {
    super(
      `Resolving episode "${episodeId}"'s embedding (${action}) had an ambiguous outcome and the row is not yet visible — retry later.`,
    );
    this.name = "EpisodeEmbeddingResolutionAmbiguousError";
  }
}

export interface MarkEmbeddingResult {
  /** False when the row was no longer `pending`/`failed` by the time this ran (already resolved by a concurrent caller). */
  readonly matched: boolean;
}

async function readEmbeddingStatus(
  pool: Pool,
  townId: string,
  episodeId: string,
): Promise<"pending" | "ready" | "failed" | undefined> {
  const result = await pool.query<{
    readonly embedding_status: "pending" | "ready" | "failed";
  }>(`SELECT embedding_status FROM public.episodes WHERE town_id = $1 AND id = $2`, [
    townId,
    episodeId,
  ]);
  return result.rows[0]?.embedding_status;
}

async function runMarkEmbeddingReady(
  transaction: TransactionContext,
  townId: string,
  episodeId: string,
  vector: Vector256,
  now: Date,
): Promise<MarkEmbeddingResult> {
  const updated = await transaction.query<{ readonly id: string }>(
    `UPDATE public.episodes
        SET embedding = $3, embedding_status = 'ready', updated_at = $4
      WHERE town_id = $1 AND id = $2 AND embedding_status IN ('pending', 'failed')
      RETURNING id`,
    [townId, episodeId, encodeVector(vector), now],
  );
  return { matched: updated.length > 0 };
}

/**
 * Resolves a still-`pending`/`failed` episode to `ready` with its vector.
 * Idempotent under concurrency: a retry after an ambiguous commit reads the
 * durable status back rather than reapplying, and a genuine race between two
 * resolvers leaves the row `ready` either way — `matched` distinguishes
 * "this call did it" from "someone else already had."
 */
export async function markEmbeddingReady(
  pool: Pool,
  deadlineAt: number,
  townId: string,
  episodeId: string,
  vector: Vector256,
  now: Date,
): Promise<MarkEmbeddingResult> {
  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    runMarkEmbeddingReady(transaction, townId, episodeId, vector, now),
  );
  if (result.outcome === "committed") return result.value;

  const status = await readEmbeddingStatus(pool, townId, episodeId);
  if (status === "ready") return { matched: false };
  throw new EpisodeEmbeddingResolutionAmbiguousError(episodeId, "settle");
}

async function runMarkEmbeddingFailed(
  transaction: TransactionContext,
  townId: string,
  episodeId: string,
  now: Date,
): Promise<MarkEmbeddingResult> {
  const updated = await transaction.query<{ readonly id: string }>(
    `UPDATE public.episodes
        SET embedding_status = 'failed', updated_at = $3
      WHERE town_id = $1 AND id = $2 AND embedding_status IN ('pending', 'failed')
      RETURNING id`,
    [townId, episodeId, now],
  );
  return { matched: updated.length > 0 };
}

/** Records a retried embedding attempt's own failure — leaves the episode retryable rather than losing track of the attempt. Never touches a `ready` row. */
export async function markEmbeddingFailed(
  pool: Pool,
  deadlineAt: number,
  townId: string,
  episodeId: string,
  now: Date,
): Promise<MarkEmbeddingResult> {
  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    runMarkEmbeddingFailed(transaction, townId, episodeId, now),
  );
  if (result.outcome === "committed") return result.value;

  const status = await readEmbeddingStatus(pool, townId, episodeId);
  if (status === "failed") return { matched: false };
  throw new EpisodeEmbeddingResolutionAmbiguousError(episodeId, "release");
}

export interface PendingEmbeddingRow {
  readonly episodeId: string;
  readonly npcId: string;
  readonly summary: string;
}

/** Scoped to one town — the backfill command iterates towns itself; nothing here ever scans across all of them. */
/**
 * `excludeEpisodeIds` lets a caller page through this query without a fixed
 * row re-appearing forever: a row that stays `pending`/`failed` after being
 * attempted (say, a persistently-failing embed call) would otherwise be the
 * *same* oldest row every subsequent call re-fetches, since nothing else
 * about it changes. A caller retrying across separate runs (the actual
 * `D4-Q` retry path) passes nothing and gets the true durable state either
 * way; a caller paging within one run passes what it has already attempted.
 */
export async function readPendingEmbeddings(
  pool: Pool,
  townId: string,
  limit: number,
  excludeEpisodeIds: readonly string[] = [],
): Promise<readonly PendingEmbeddingRow[]> {
  const result = await pool.query<{
    readonly id: string;
    readonly npc_id: string;
    readonly summary: string;
  }>(
    `SELECT id, npc_id, summary FROM public.episodes
      WHERE town_id = $1 AND embedding_status IN ('pending', 'failed')
        AND NOT (id = ANY($3))
      ORDER BY created_at ASC
      LIMIT $2`,
    [townId, limit, excludeEpisodeIds],
  );
  return result.rows.map((row) => ({
    episodeId: row.id,
    npcId: row.npc_id,
    summary: row.summary,
  }));
}

export interface EpisodeEmbeddingRow {
  readonly embedding: Vector256 | null;
  readonly embeddingStatus: "pending" | "ready" | "failed";
}

/** Reads one episode's embedding state directly — used by tests and by a caller confirming a write landed the shape it expects. */
export async function readEpisodeEmbedding(
  pool: Pool,
  townId: string,
  episodeId: string,
): Promise<EpisodeEmbeddingRow | undefined> {
  const result = await pool.query<{
    readonly embedding: string | null;
    readonly embedding_status: "pending" | "ready" | "failed";
  }>(
    `SELECT embedding::STRING AS embedding, embedding_status
       FROM public.episodes WHERE town_id = $1 AND id = $2`,
    [townId, episodeId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    embedding: row.embedding === null ? null : decodeVector(row.embedding),
    embeddingStatus: row.embedding_status,
  };
}
