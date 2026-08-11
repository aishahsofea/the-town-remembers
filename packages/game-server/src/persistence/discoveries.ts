/**
 * Raw reads `inspect`'s narrow input loader needs (`P3-11`): the inspectable
 * itself, town-wide clue discovery, the shared board entry, and the item a
 * discovery reveals. One function per concern, matching `view-queries.ts`'s
 * own convention — no `SELECT *`, every query scoped by `town_id`.
 */

import type { Pool } from "pg";

export interface InspectableAtLocationRow {
  readonly id: string;
  readonly clueId: string | null;
  readonly clueKey: string | null;
  readonly linkedItemEntityId: string | null;
}

/**
 * `undefined` for an unknown id, a disabled inspectable, or one not at
 * `locationEntityId` — all three collapse to the same `INSPECTABLE_NOT_FOUND`
 * denial (`P3-11` acceptance 6), so this function does not distinguish them.
 */
export async function readInspectableAtLocation(
  pool: Pool,
  townId: string,
  inspectableId: string,
  locationEntityId: string,
): Promise<InspectableAtLocationRow | undefined> {
  const result = await pool.query<{
    readonly id: string;
    readonly clue_id: string | null;
    readonly clue_key: string | null;
    readonly linked_entity_id: string | null;
  }>(
    `SELECT i.id, cl.id AS clue_id, cl.clue_key, i.linked_entity_id
       FROM public.inspectables i
       LEFT JOIN public.clues cl
         ON cl.town_id = i.town_id AND cl.inspectable_id = i.id
      WHERE i.town_id = $1 AND i.id = $2 AND i.location_entity_id = $3 AND i.enabled = true`,
    [townId, inspectableId, locationEntityId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    clueId: row.clue_id,
    clueKey: row.clue_key,
    linkedItemEntityId: row.linked_entity_id,
  };
}

export interface ClueDiscoveryContributor {
  readonly playerId: string;
  readonly displayName: string;
  readonly discoverySequence: number;
}

/** Every existing discovery of this clue, town-wide, ordered by discovery sequence. */
export async function readClueDiscoveries(
  pool: Pool,
  townId: string,
  clueId: string,
): Promise<readonly ClueDiscoveryContributor[]> {
  const result = await pool.query<{
    readonly player_id: string;
    readonly display_name: string;
    readonly discovery_sequence: number;
  }>(
    `SELECT cd.player_id, a.display_name, we.sequence_no AS discovery_sequence
       FROM public.clue_discoveries cd
       JOIN public.actors a ON a.town_id = cd.town_id AND a.id = cd.player_id
       JOIN public.world_events we ON we.town_id = cd.town_id AND we.id = cd.event_id
      WHERE cd.town_id = $1 AND cd.clue_id = $2
      ORDER BY we.sequence_no, cd.player_id`,
    [townId, clueId],
  );
  return result.rows.map((row) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    discoverySequence: row.discovery_sequence,
  }));
}

/** Whether this clue already has the town's one shared `verified_evidence` board entry. */
export async function readBoardEntryExists(
  pool: Pool,
  townId: string,
  clueId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM public.case_board_entries
      WHERE town_id = $1 AND clue_id = $2 AND entry_kind = 'verified_evidence'`,
    [townId, clueId],
  );
  return (result.rowCount ?? 0) > 0;
}

export interface ItemForRevealRow {
  readonly entityKey: string;
  readonly portable: boolean;
  readonly revision: number;
  readonly heldByActorId: string | null;
  readonly locationEntityId: string | null;
  /** `revealed_event_id IS NOT NULL` — immutable once true (docs/005). */
  readonly alreadyRevealed: boolean;
}

export async function readItemForReveal(
  pool: Pool,
  townId: string,
  itemId: string,
): Promise<ItemForRevealRow | undefined> {
  const result = await pool.query<{
    readonly entity_key: string;
    readonly portable: boolean;
    readonly revision: number;
    readonly held_by_actor_id: string | null;
    readonly location_entity_id: string | null;
    readonly revealed_event_id: string | null;
  }>(
    `SELECT se.entity_key, it.portable, it.revision, it.held_by_actor_id,
            it.location_entity_id, it.revealed_event_id
       FROM public.items it
       JOIN public.story_entities se ON se.town_id = it.town_id AND se.id = it.id
      WHERE it.town_id = $1 AND it.id = $2`,
    [townId, itemId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    alreadyRevealed: row.revealed_event_id !== null,
    entityKey: row.entity_key,
    portable: row.portable,
    revision: row.revision,
    heldByActorId: row.held_by_actor_id,
    locationEntityId: row.location_entity_id,
  };
}
