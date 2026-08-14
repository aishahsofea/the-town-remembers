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

/**
 * The reverse of {@link resolveCanonicalEntityIds}: a confirmed
 * `claim_drafts` row stores this town's real `story_entities` UUIDs, but
 * `content/claim-sentence.ts#renderClaimSentence` (`tell`'s canonical text,
 * `P4-13`) needs the frozen content `entity_key` back, exactly as
 * `normalize_claim`'s own model output first had it before this town's
 * UUIDs replaced it.
 */
export async function resolveEntityKeysByIds(
  pool: Pool,
  townId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const result = await pool.query<{ readonly id: string; readonly entity_key: string }>(
    `SELECT id, entity_key FROM public.story_entities
      WHERE town_id = $1 AND id = ANY($2)`,
    [townId, ids],
  );
  return new Map(result.rows.map((row) => [row.id, row.entity_key]));
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

/** One `claim_drafts` row, read for `tell`'s (`P4-13`) own precondition checks. */
export interface ClaimDraftRow {
  readonly id: string;
  readonly playerId: string;
  readonly visitId: string;
  readonly targetNpcId: string;
  readonly subjectEntityId: string;
  readonly subjectEntityType: string;
  readonly predicate: string;
  readonly objectEntityId: string;
  readonly objectEntityType: string;
  readonly polarity: string;
  readonly contextKey: string;
  readonly normalizedKey: string;
  readonly allegedSourceActorId: string | null;
  readonly status: string;
  readonly expiresAt: Date;
  /** Evaluated by CockroachDB's transaction timestamp, not the API host clock. */
  readonly expired: boolean;
}

/**
 * Reads one draft scoped to the confirming player — a draft belonging to
 * another player is indistinguishable from a missing one to this caller,
 * matching `CLAIM_DRAFT_NOT_FOUND`'s existing scope-blind denial (`ask`'s
 * `NPC_NOT_PRESENT` follows the same non-disclosure shape).
 */
export async function readDraftForPlayer(
  pool: Pool,
  townId: string,
  draftId: string,
  playerId: string,
): Promise<ClaimDraftRow | undefined> {
  const result = await pool.query<{
    readonly id: string;
    readonly player_id: string;
    readonly visit_id: string;
    readonly target_npc_id: string;
    readonly subject_entity_id: string;
    readonly subject_entity_type: string;
    readonly predicate: string;
    readonly object_entity_id: string;
    readonly object_entity_type: string;
    readonly polarity: string;
    readonly context_key: string;
    readonly normalized_key: string;
    readonly alleged_source_actor_id: string | null;
    readonly status: string;
    readonly expires_at: Date;
    readonly expired: boolean;
  }>(
    `SELECT id, player_id, visit_id, target_npc_id, subject_entity_id,
            subject_entity_type, predicate, object_entity_id, object_entity_type,
            polarity, context_key, normalized_key, alleged_source_actor_id,
            status, expires_at, expires_at <= now() AS expired
       FROM public.claim_drafts
      WHERE town_id = $1 AND id = $2 AND player_id = $3`,
    [townId, draftId, playerId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    playerId: row.player_id,
    visitId: row.visit_id,
    targetNpcId: row.target_npc_id,
    subjectEntityId: row.subject_entity_id,
    subjectEntityType: row.subject_entity_type,
    predicate: row.predicate,
    objectEntityId: row.object_entity_id,
    objectEntityType: row.object_entity_type,
    polarity: row.polarity,
    contextKey: row.context_key,
    normalizedKey: row.normalized_key,
    allegedSourceActorId: row.alleged_source_actor_id,
    status: row.status,
    expiresAt: row.expires_at,
    expired: row.expired,
  };
}
