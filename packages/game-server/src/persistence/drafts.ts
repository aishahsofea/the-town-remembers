/**
 * `normalize_claim` (`P4-12`) persistence: resolving the frozen content
 * entity keys `claim_normalization_v1` names back to this town's real
 * `story_entities`/`npcs` rows.
 *
 * `claim_normalization_v1`'s `entity_id`/`actor_id`/`alleged_source_actor_id`
 * fields are the frozen content keys from `trusted_context.canonical_entities`/
 * `canonical_actors` (`content/entities.ts#entityKey`), never a per-town
 * UUID — `content/claim-key.ts#claimKeyV1`'s own contract requires "frozen
 * authored entity keys" so the same proposition reaches the same
 * `normalized_key` in every town seeded from this content version. Only
 * once a normalization succeeds does the result need this town's real row
 * ids, to satisfy `claim_drafts`' foreign keys.
 */

import type { Pool } from "pg";

import type { EntityType } from "@the-town-remembers/content";

export interface ResolvedCanonicalEntity {
  readonly id: string;
  readonly entityType: EntityType;
}

/** Resolves exactly the entity keys asked for — never a whole-town scan. */
export async function resolveCanonicalEntityIds(
  pool: Pool,
  townId: string,
  entityKeys: readonly string[],
): Promise<ReadonlyMap<string, ResolvedCanonicalEntity>> {
  if (entityKeys.length === 0) return new Map();
  const result = await pool.query<{
    readonly entity_key: string;
    readonly id: string;
    readonly entity_type: EntityType;
  }>(
    `SELECT entity_key, id, entity_type FROM public.story_entities
      WHERE town_id = $1 AND entity_key = ANY($2)`,
    [townId, entityKeys],
  );
  return new Map(
    result.rows.map((row) => [
      row.entity_key,
      { id: row.id, entityType: row.entity_type },
    ]),
  );
}

/**
 * An alleged source is always one of this town's NPCs (Decision 010's
 * `canonical_actors`), named by its character's content-stable
 * `entity_key` — `npcs` carries no `entity_key` of its own, so this joins
 * through `character_entity_id` rather than reading `actors` directly.
 */
export async function resolveAllegedSourceActorId(
  pool: Pool,
  townId: string,
  characterKey: string,
): Promise<string | undefined> {
  const result = await pool.query<{ readonly id: string }>(
    `SELECT npcs.id FROM public.npcs
       JOIN public.story_entities character
         ON character.town_id = npcs.town_id
        AND character.id = npcs.character_entity_id
      WHERE npcs.town_id = $1 AND character.entity_key = $2`,
    [townId, characterKey],
  );
  return result.rows[0]?.id;
}
