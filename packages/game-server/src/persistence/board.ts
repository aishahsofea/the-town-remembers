/**
 * Transmissions and grounding episodes reaching one NPC — the testimony/
 * hearsay entries `NpcContextBuilder` uses to source a disclosure
 * candidate's `sourceEpisodeId`/`parentTransmissionId`/stance (`P4-09`;
 * docs/006 provenance, `rules/board/provenance.ts#entryKindForSourceKind`).
 */

import type {
  EpisodeKind,
  TransmissionSourceKind,
} from "@the-town-remembers/database/domains";
import type { Pool } from "pg";

export interface ReceivedTransmission {
  readonly transmissionId: string;
  readonly claimId: string;
  readonly sourceKind: TransmissionSourceKind;
}

/**
 * One transmission per claim this NPC has received — the earliest
 * (lowest `created_at`) when more than one reached the NPC, since that is
 * how the NPC first came to know the claim.
 */
export async function readReceivedTransmissions(
  pool: Pool,
  townId: string,
  npcId: string,
  claimIds: readonly string[],
): Promise<ReadonlyMap<string, ReceivedTransmission>> {
  if (claimIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly id: string;
    readonly claim_id: string;
    readonly source_kind: TransmissionSourceKind;
  }>(
    `SELECT DISTINCT ON (claim_id) id, claim_id, source_kind
       FROM public.claim_transmissions
      WHERE town_id = $1 AND recipient_actor_id = $2 AND claim_id = ANY($3)
      ORDER BY claim_id, created_at ASC`,
    [townId, npcId, claimIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.claim_id,
      { transmissionId: row.id, claimId: row.claim_id, sourceKind: row.source_kind },
    ]),
  );
}

export interface GroundingEpisode {
  readonly episodeId: string;
  readonly episodeKind: EpisodeKind;
}

/**
 * The episode that grounds one NPC's own knowledge of a claim — a
 * `direct_observation` (the NPC witnessed it) or `heard_claim` (the NPC was
 * told it) episode referencing the claim via `episode_references`. This is
 * `sourceEpisodeId` for a `DisclosureCandidateInput` whose stance the NPC
 * asserts as its own experience, distinct from `readReceivedTransmissions`'
 * transmission-level provenance. `direct_observation` is preferred when an
 * NPC somehow has both for the same claim (the seed corpus never does; this
 * is defense against a future authored ambiguity), then the earliest
 * `occurred_at`.
 */
export async function readGroundingEpisodes(
  pool: Pool,
  townId: string,
  npcId: string,
  claimIds: readonly string[],
): Promise<ReadonlyMap<string, GroundingEpisode>> {
  if (claimIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly id: string;
    readonly claim_id: string;
    readonly episode_kind: EpisodeKind;
  }>(
    `SELECT DISTINCT ON (er.claim_id) e.id, er.claim_id, e.episode_kind
       FROM public.episode_references er
       JOIN public.episodes e
         ON e.town_id = er.town_id AND e.id = er.episode_id
      WHERE er.town_id = $1 AND e.npc_id = $2 AND er.reference_kind = 'claim'
        AND er.claim_id = ANY($3)
      ORDER BY er.claim_id,
               (e.episode_kind = 'direct_observation') DESC,
               e.occurred_at ASC`,
    [townId, npcId, claimIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.claim_id,
      { episodeId: row.id, episodeKind: row.episode_kind },
    ]),
  );
}
