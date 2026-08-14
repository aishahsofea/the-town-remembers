/**
 * Read-only reconstruction over the `inspection.*` views (`P4-17`).
 *
 * Nothing here is reachable from `http/router.ts` or `application/player-view/build.ts`
 * — these views exist for judges and developers (`0012_inspection_views.sql`),
 * never for a player request, so this module stays entirely outside the
 * player-facing API surface rather than widening it. It proves one accepted
 * `npc_interaction` is fully checkable end to end: the exact text the player
 * saw, and every claim transmission that turn produced, each with its real
 * ordinal and provenance root.
 */

import type { Pool } from "pg";

export interface InspectedTransmission {
  readonly transmissionId: string;
  readonly claimKey: string;
  readonly speakerName: string;
  readonly speakerType: "player" | "npc";
  readonly sourceKind: string;
  readonly ordinal: number;
  readonly hopCount: number;
  readonly rootTransmissionId: string;
}

export interface InspectedInteraction {
  readonly interactionId: string;
  readonly npcName: string;
  readonly inputKind: string;
  readonly responseMode: string;
  readonly npcText: string;
  readonly eventSequence: number;
  readonly transmissions: readonly InspectedTransmission[];
}

/**
 * One accepted `npc_interaction`, its causal event, and every claim
 * transmission it produced — ordered by `ordinal`, the same order the turn
 * spoke them in. `undefined` when no interaction exists for that player
 * action, never a partial reconstruction.
 */
export async function readInspectedInteraction(
  pool: Pool,
  townId: string,
  playerActionId: string,
): Promise<InspectedInteraction | undefined> {
  const interactionResult = await pool.query<{
    id: string;
    input_kind: string;
    response_mode: string;
    npc_text: string;
    sequence_no: string;
    npc_name: string;
  }>(
    `SELECT ni.id, ni.input_kind, ni.response_mode, ni.npc_text, e.sequence_no,
            npc_actor.display_name AS npc_name
       FROM public.npc_interactions ni
       JOIN public.actors npc_actor ON npc_actor.town_id = ni.town_id AND npc_actor.id = ni.npc_id
       JOIN public.world_events e ON e.town_id = ni.town_id AND e.id = ni.event_id
      WHERE ni.town_id = $1 AND ni.player_action_id = $2`,
    [townId, playerActionId],
  );
  const row = interactionResult.rows[0];
  if (row === undefined) return undefined;

  const transmissionsResult = await pool.query<{
    transmission_id: string;
    claim_key: string;
    speaker_name: string;
    speaker_type: "player" | "npc";
    source_kind: string;
    ordinal: number;
    hop_count: number;
    root_transmission_id: string;
  }>(
    `SELECT cp.transmission_id, cp.claim_key, cp.speaker_name, cp.speaker_type,
            cp.source_kind, cp.ordinal, cp.hop_count, cp.root_transmission_id
       FROM public.claim_transmissions t
       JOIN inspection.claim_paths cp
         ON cp.town_id = t.town_id AND cp.transmission_id = t.id
      WHERE t.town_id = $1 AND t.interaction_id = $2
      ORDER BY cp.ordinal`,
    [townId, row.id],
  );

  return {
    interactionId: row.id,
    npcName: row.npc_name,
    inputKind: row.input_kind,
    responseMode: row.response_mode,
    npcText: row.npc_text,
    eventSequence: Number(row.sequence_no),
    transmissions: transmissionsResult.rows.map((t) => ({
      transmissionId: t.transmission_id,
      claimKey: t.claim_key,
      speakerName: t.speaker_name,
      speakerType: t.speaker_type,
      sourceKind: t.source_kind,
      ordinal: t.ordinal,
      hopCount: t.hop_count,
      rootTransmissionId: t.root_transmission_id,
    })),
  };
}
