/**
 * Minimal row builders for schema invariant tests.
 *
 * These write raw SQL on purpose. The constraint suite has to prove that the
 * database rejects invalid state even when application code is bypassed, so it
 * must not go through the repository layer that would reject the same input
 * earlier and for a different reason.
 *
 * Every builder inserts the smallest valid row and returns its generated ID, so
 * a test states only the part it is actually about.
 */

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export const SHA256_PLACEHOLDER = Buffer.alloc(32, 7);

export interface TownOptions {
  readonly contentVersion?: string;
  readonly status?: string;
  readonly createdAt?: Date;
}

export async function insertTown(
  pool: Pool,
  options: TownOptions = {},
): Promise<string> {
  const id = randomUUID();
  const createdAt = options.createdAt ?? new Date();
  await pool.query(
    `INSERT INTO public.towns
       (id, invite_token_hash, content_version, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [
      id,
      Buffer.concat([Buffer.from(id.replaceAll("-", ""), "hex"), Buffer.alloc(16)]),
      options.contentVersion ?? "bell-mystery-v1",
      options.status ?? "active",
      createdAt,
    ],
  );
  return id;
}

export interface StoryEntityOptions {
  readonly entityType: string;
  readonly entityKey?: string;
  readonly displayName?: string;
  readonly contentKey?: string;
}

export async function insertStoryEntity(
  pool: Pool,
  townId: string,
  options: StoryEntityOptions,
): Promise<string> {
  const id = randomUUID();
  const entityKey = options.entityKey ?? `${options.entityType}_${id.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO public.story_entities
       (town_id, id, entity_type, entity_key, display_name, content_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [
      townId,
      id,
      options.entityType,
      entityKey,
      options.displayName ?? entityKey,
      options.contentKey ?? entityKey,
    ],
  );
  return id;
}

export interface ActorOptions {
  readonly actorType: string;
  readonly displayName?: string;
}

export async function insertActor(
  pool: Pool,
  townId: string,
  options: ActorOptions,
): Promise<string> {
  const id = randomUUID();
  const displayName = options.displayName ?? `Actor ${id.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO public.actors
       (town_id, id, actor_type, display_name, display_name_normalized, created_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [townId, id, options.actorType, displayName, displayName.toLowerCase()],
  );
  return id;
}

export async function insertPlayer(pool: Pool, townId: string): Promise<string> {
  const id = await insertActor(pool, townId, { actorType: "player" });
  await pool.query(
    `INSERT INTO public.players (town_id, id, last_seen_at, created_at, updated_at)
     VALUES ($1, $2, now(), now(), now())`,
    [townId, id],
  );
  return id;
}

export interface NpcOptions {
  readonly characterEntityId?: string;
  readonly locationEntityId?: string;
  readonly displayName?: string;
}

export async function insertNpc(
  pool: Pool,
  townId: string,
  options: NpcOptions = {},
): Promise<string> {
  const characterEntityId =
    options.characterEntityId ??
    (await insertStoryEntity(pool, townId, { entityType: "character" }));
  const locationEntityId =
    options.locationEntityId ??
    (await insertStoryEntity(pool, townId, { entityType: "location" }));
  const id = await insertActor(pool, townId, {
    actorType: "npc",
    ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
  });
  await pool.query(
    `INSERT INTO public.npcs
       (town_id, id, character_entity_id, location_entity_id,
        profile_key, profile_version, created_at)
     VALUES ($1, $2, $3, $4, 'profile', 'v1', now())`,
    [townId, id, characterEntityId, locationEntityId],
  );
  return id;
}

export interface Rejection {
  /** SQLSTATE, for example `23514` for a check and `23503` for a foreign key. */
  readonly code: string | undefined;
  /**
   * The violated constraint's name. CockroachDB prints the check *expression*
   * in the message but still reports the name in this field, so assertions use
   * it: a test that matched on the expression would break every time the
   * rendered domain list changed.
   */
  readonly constraint: string | undefined;
  readonly message: string;
}

/**
 * Runs a statement expected to be rejected and returns the structured error.
 * Fails loudly when the statement unexpectedly succeeds, because a silent pass
 * is exactly the failure mode these tests exist to catch.
 */
export async function expectRejection(
  pool: Pool,
  sql: string,
  parameters: readonly unknown[] = [],
): Promise<Rejection> {
  try {
    await pool.query(sql, [...parameters]);
  } catch (error) {
    const detail = error as { code?: string; constraint?: string };
    return {
      code: detail.code,
      constraint: detail.constraint,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error(`Expected the database to reject this statement:\n${sql}`);
}
