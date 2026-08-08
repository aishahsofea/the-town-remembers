/**
 * The safe description of a materialized town.
 *
 * The seed CLI prints this. It carries the opaque town ID, counts, and belief
 * labels — enough to confirm a town was created correctly, and nothing that
 * could authenticate anyone. The invite hash, and the plaintext this package
 * never sees at all, are absent by construction rather than by filtering.
 */

import type { Pool } from "pg";

export interface TownSummary {
  readonly townId: string;
  readonly contentVersion: string;
  readonly lastEventSequence: number;
  readonly ambientScheduledThroughSequence: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly beliefs: readonly string[];
}

const COUNTED_TABLES = [
  "story_entities",
  "actors",
  "npcs",
  "npc_contact_edges",
  "claims",
  "claim_relations",
  "world_facts",
  "items",
  "inspectables",
  "clues",
  "clue_claim_effects",
  "world_events",
  "episodes",
  "episode_references",
  "claim_transmissions",
  "belief_evidence",
  "npc_beliefs",
  "players",
  "player_visits",
  "player_actions",
] as const;

export async function summarizeTown(pool: Pool, townId: string): Promise<TownSummary> {
  const town = await pool.query<{
    content_version: string;
    last_event_sequence: number;
    ambient_scheduled_through_sequence: number;
  }>(
    `SELECT content_version, last_event_sequence, ambient_scheduled_through_sequence
       FROM public.towns WHERE id = $1`,
    [townId],
  );
  const row = town.rows[0];
  if (!row) throw new Error("No such town.");

  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::INT8 AS count FROM public.${table} WHERE town_id = $1`,
      [townId],
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }

  // Rendered from the claim tuple rather than the normalized key: the key is
  // the `claim-key:v1` representation, which contains a newline and would wrap
  // every line of operator output.
  const beliefs = await pool.query<{ line: string }>(
    `SELECT a.display_name || ' is ' || b.label || ' that ' ||
            subject.entity_key || ' ' ||
            CASE WHEN c.polarity = 'negative' THEN 'not ' ELSE '' END ||
            c.predicate || ' ' || object.entity_key ||
            ' (' || c.context_key || ')' AS line
       FROM public.npc_beliefs b
       JOIN public.actors a ON a.town_id = b.town_id AND a.id = b.npc_id
       JOIN public.claims c ON c.town_id = b.town_id AND c.id = b.claim_id
       JOIN public.story_entities subject
         ON subject.town_id = c.town_id AND subject.id = c.subject_entity_id
       JOIN public.story_entities object
         ON object.town_id = c.town_id AND object.id = c.object_entity_id
      WHERE b.town_id = $1
      ORDER BY line`,
    [townId],
  );

  return {
    townId,
    contentVersion: row.content_version,
    lastEventSequence: Number(row.last_event_sequence),
    ambientScheduledThroughSequence: Number(row.ambient_scheduled_through_sequence),
    counts,
    beliefs: beliefs.rows.map((belief) => belief.line),
  };
}
