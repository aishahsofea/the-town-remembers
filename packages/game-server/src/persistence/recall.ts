/**
 * Scoped episodic recall reads (`P4-08`; docs/008 "Episodic recall").
 *
 * `readVectorCandidates` orders by `embedding <-> $queryVector` (L2
 * distance), not `<=>` (cosine distance) — a real discrepancy this session
 * found between docs/008's own "cosine_similarity" framing and the actual
 * schema: `migrations/0011_vector_index.sql` built `ix_episodes__embedding`
 * with `vector_l2_ops` specifically (confirmed against the live index via
 * `SHOW CREATE TABLE`), so an `<=>` query would not use it. Titan embeddings
 * are requested normalized (`titan.ts`'s `normalize: true`), and similarity
 * is derived as `clamp(1 - distance, 0, 1)`, matching the plan's own
 * acceptance wording exactly — this is a simpler, index-aligned quantity
 * rather than the mathematically exact cosine similarity a normalized L2
 * distance would need `1 - distance²/2` to recover, and the difference only
 * matters for the *value* fed into `rankRecallResults`' weighted score, not
 * for whether closer vectors still rank higher (they do, monotonically,
 * either way).
 *
 * Every query here is scoped by `town_id` *and* `npc_id` — recall is never
 * town-wide or NPC-wide, matching `ix_episodes__embedding`'s own leading
 * columns (a vector index without that prefix would search every NPC's
 * memory and filter after, both slower and a tenant-isolation hazard, per
 * that migration's own header).
 */

import { encodeVector, type Vector256 } from "@the-town-remembers/database";
import type { RecallAnchorCandidate } from "@the-town-remembers/rules";
import type { Pool } from "pg";

export interface VectorCandidateRow {
  readonly episodeId: string;
  readonly distance: number;
}

export type RecallEpisodeKind =
  | "direct_observation"
  | "heard_claim"
  | "player_interaction"
  | "promise_consequence"
  | "item_transfer"
  | "world_consequence";

export interface RecallEpisodeDetail {
  readonly episodeId: string;
  readonly episodeKind: RecallEpisodeKind;
  readonly summary: string;
  readonly importance: number;
  readonly occurredAt: Date;
  readonly claimIds: readonly string[];
  readonly heardHopCount: number | null;
  readonly isCommitmentOrGrievance: boolean;
  readonly isInActiveContradiction: boolean;
}

/** Enriches the bounded candidate-id union for deterministic reranking. */
export async function readRecallEpisodeDetails(
  pool: Pool,
  townId: string,
  npcId: string,
  playerId: string,
  episodeIds: readonly string[],
): Promise<readonly RecallEpisodeDetail[]> {
  if (episodeIds.length === 0) return [];
  const result = await pool.query<{
    readonly id: string;
    readonly episode_kind: RecallEpisodeKind;
    readonly summary: string;
    readonly importance: number;
    readonly occurred_at: Date;
    readonly claim_ids: readonly string[];
    readonly heard_hop_count: number | null;
    readonly is_commitment_or_grievance: boolean;
    readonly is_in_active_contradiction: boolean;
  }>(
    `SELECT e.id, e.episode_kind, e.summary, e.importance, e.occurred_at,
            COALESCE(
              array_agg(DISTINCT er.claim_id) FILTER (WHERE er.claim_id IS NOT NULL),
              ARRAY[]::UUID[]
            ) AS claim_ids,
            CASE WHEN e.episode_kind = 'heard_claim' THEN (
              SELECT min(ct.hop_count)
                FROM public.claim_transmissions ct
               WHERE ct.town_id = e.town_id
                 AND ct.event_id = e.event_id
                 AND ct.recipient_actor_id = e.npc_id
            ) ELSE NULL END AS heard_hop_count,
            EXISTS (
              SELECT 1 FROM public.promises p
               WHERE p.town_id = e.town_id AND p.npc_id = e.npc_id
                 AND p.player_id = $4
                 AND (p.accepted_event_id = e.event_id OR p.resolved_event_id = e.event_id)
            ) AS is_commitment_or_grievance,
            EXISTS (
              SELECT 1
                FROM public.episode_references claim_ref
                JOIN public.claim_relations relation
                  ON relation.town_id = claim_ref.town_id
                 AND relation.relation_kind = 'contradicts'
                 AND (relation.claim_a_id = claim_ref.claim_id
                   OR relation.claim_b_id = claim_ref.claim_id)
                JOIN public.npc_beliefs belief_a
                  ON belief_a.town_id = relation.town_id
                 AND belief_a.npc_id = e.npc_id
                 AND belief_a.claim_id = relation.claim_a_id
                JOIN public.npc_beliefs belief_b
                  ON belief_b.town_id = relation.town_id
                 AND belief_b.npc_id = e.npc_id
                 AND belief_b.claim_id = relation.claim_b_id
               WHERE claim_ref.town_id = e.town_id
                 AND claim_ref.episode_id = e.id
                 AND claim_ref.reference_kind = 'claim'
                 AND belief_a.score >= 20 AND belief_b.score >= 20
            ) AS is_in_active_contradiction
       FROM public.episodes e
       LEFT JOIN public.episode_references er
         ON er.town_id = e.town_id AND er.episode_id = e.id
      WHERE e.town_id = $1 AND e.npc_id = $2 AND e.id = ANY($3)
      GROUP BY e.town_id, e.id, e.npc_id, e.event_id, e.episode_kind,
               e.summary, e.importance, e.occurred_at`,
    [townId, npcId, episodeIds, playerId],
  );
  return result.rows.map((row) => ({
    episodeId: row.id,
    episodeKind: row.episode_kind,
    summary: row.summary,
    importance: row.importance,
    occurredAt: row.occurred_at,
    claimIds: row.claim_ids,
    heardHopCount: row.heard_hop_count,
    isCommitmentOrGrievance: row.is_commitment_or_grievance,
    isInActiveContradiction: row.is_in_active_contradiction,
  }));
}

/** The `<=> `→ `<->` index-aligned vector query, already scoped to `ready` embeddings only (`ck_episodes__embedding_consistency` makes a `ready` row with a null vector impossible regardless). */
export async function readVectorCandidates(
  pool: Pool,
  townId: string,
  npcId: string,
  queryVector: Vector256,
  limit: number,
): Promise<readonly VectorCandidateRow[]> {
  const result = await pool.query<{ readonly id: string; readonly distance: number }>(
    `SELECT id, (embedding <-> $3) AS distance
       FROM public.episodes
      WHERE town_id = $1 AND npc_id = $2 AND embedding_status = 'ready'
      ORDER BY embedding <-> $3
      LIMIT $4`,
    [townId, npcId, encodeVector(queryVector), limit],
  );
  return result.rows.map((row) => ({ episodeId: row.id, distance: row.distance }));
}

interface AnchorRow {
  readonly id: string;
  readonly importance: number;
  readonly occurred_at: Date;
}

function toAnchorCandidates(
  rows: readonly AnchorRow[],
): readonly RecallAnchorCandidate[] {
  return rows.map((row) => ({
    episodeId: row.id,
    importance: row.importance,
    occurredAt: row.occurred_at,
  }));
}

const RECENT_EPISODES_LIMIT = 10;
const HIGH_IMPORTANCE_THRESHOLD = 80;

/** "Recent episodes" — the anchor category needing no join at all. */
async function readRecentEpisodes(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<readonly RecallAnchorCandidate[]> {
  const result = await pool.query<AnchorRow>(
    `SELECT id, importance, occurred_at FROM public.episodes
      WHERE town_id = $1 AND npc_id = $2
      ORDER BY occurred_at DESC
      LIMIT $3`,
    [townId, npcId, RECENT_EPISODES_LIMIT],
  );
  return toAnchorCandidates(result.rows);
}

/** "Importance-80+ episodes." */
async function readHighImportanceEpisodes(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<readonly RecallAnchorCandidate[]> {
  const result = await pool.query<AnchorRow>(
    `SELECT id, importance, occurred_at FROM public.episodes
      WHERE town_id = $1 AND npc_id = $2 AND importance >= $3`,
    [townId, npcId, HIGH_IMPORTANCE_THRESHOLD],
  );
  return toAnchorCandidates(result.rows);
}

/**
 * "Active promises or grievances" — episodes whose `event_id` is the
 * accepting or resolving event of any promise involving this NPC. Covers
 * both halves of docs/008's "active promises or grievances" in one query:
 * an active promise's own accepted-event episode, and a resolved promise's
 * (fulfilled or broken) resolved-event episode. Whether a given candidate
 * counts as `commitment_or_grievance` *for scoring* is query-relative (it
 * depends on which player is asking) and is computed later, from
 * already-loaded state, by `application/npc/recall.ts` — this is only the
 * structural candidate pool.
 */
async function readPromiseEpisodes(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<readonly RecallAnchorCandidate[]> {
  const result = await pool.query<AnchorRow>(
    `SELECT DISTINCT e.id, e.importance, e.occurred_at
       FROM public.episodes e
       JOIN public.promises p
         ON p.town_id = e.town_id AND p.npc_id = e.npc_id
        AND (p.accepted_event_id = e.event_id OR p.resolved_event_id = e.event_id)
      WHERE e.town_id = $1 AND e.npc_id = $2`,
    [townId, npcId],
  );
  return toAnchorCandidates(result.rows);
}

/**
 * "Active contradictions" — episodes referencing a claim that is one side
 * of a `contradicts` relation where *both* sides clear this NPC's
 * `isSelectedBelief` floor (`rules/kernel/version.ts#selectedBelief.minimumScore`,
 * `20` — kept as a literal here rather than importing the constant, since
 * `game-server` already depends on `rules` and this is the one place outside
 * `rules` itself that needs to mirror it structurally; `rules/recall/
 * scoring.ts#isActiveContradiction` is the authority this must stay
 * consistent with). Like the promise query above, this is the *candidate*
 * pool — whether a specific episode's contradiction is the NPC's actual
 * *selected* belief is scoring-time, application-layer work.
 */
async function readContradictionEpisodes(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<readonly RecallAnchorCandidate[]> {
  const result = await pool.query<AnchorRow>(
    `SELECT DISTINCT e.id, e.importance, e.occurred_at
       FROM public.episodes e
       JOIN public.episode_references er
         ON er.town_id = e.town_id AND er.episode_id = e.id AND er.reference_kind = 'claim'
       JOIN public.claim_relations cr
         ON cr.town_id = e.town_id AND cr.relation_kind = 'contradicts'
        AND (cr.claim_a_id = er.claim_id OR cr.claim_b_id = er.claim_id)
       JOIN public.npc_beliefs nb_a
         ON nb_a.town_id = e.town_id AND nb_a.npc_id = $2 AND nb_a.claim_id = cr.claim_a_id
       JOIN public.npc_beliefs nb_b
         ON nb_b.town_id = e.town_id AND nb_b.npc_id = $2 AND nb_b.claim_id = cr.claim_b_id
      WHERE e.town_id = $1 AND e.npc_id = $2 AND nb_a.score >= 20 AND nb_b.score >= 20`,
    [townId, npcId],
  );
  return toAnchorCandidates(result.rows);
}

/**
 * The full, deduplicated structured-anchor candidate pool — every episode
 * from any of the four docs/008 categories, at most once each. Capping to
 * the top ten (importance desc, `occurred_at` desc, episode ID asc) is
 * deliberately **not** done here: that ordering and cap already exist,
 * proven, at `rules/recall/scoring.ts#selectStructuredAnchors` — this
 * function's only job is assembling the candidates for it to choose from.
 */
export async function readStructuredAnchorCandidates(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<readonly RecallAnchorCandidate[]> {
  const [recent, highImportance, promiseRelated, contradictions] = await Promise.all([
    readRecentEpisodes(pool, townId, npcId),
    readHighImportanceEpisodes(pool, townId, npcId),
    readPromiseEpisodes(pool, townId, npcId),
    readContradictionEpisodes(pool, townId, npcId),
  ]);

  const byEpisodeId = new Map<string, RecallAnchorCandidate>();
  for (const candidate of [
    ...recent,
    ...highImportance,
    ...promiseRelated,
    ...contradictions,
  ]) {
    byEpisodeId.set(candidate.episodeId, candidate);
  }
  return Array.from(byEpisodeId.values());
}
