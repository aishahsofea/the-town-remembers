/**
 * NPC snapshot, active-visit co-location, granted capabilities, and item
 * custody reads (`P4-09`; `NpcContextBuilder`'s non-belief/relationship/
 * promise state — docs/008's "access/item gates").
 */

import type { Pool } from "pg";

export interface NpcSnapshot {
  readonly npcId: string;
  readonly characterEntityId: string;
  readonly locationEntityId: string;
  readonly profileKey: string;
  readonly profileVersion: string;
}

export async function readNpcSnapshot(
  pool: Pool,
  townId: string,
  npcId: string,
): Promise<NpcSnapshot | undefined> {
  const result = await pool.query<{
    readonly id: string;
    readonly character_entity_id: string;
    readonly location_entity_id: string;
    readonly profile_key: string;
    readonly profile_version: string;
  }>(
    `SELECT id, character_entity_id, location_entity_id, profile_key, profile_version
       FROM public.npcs
      WHERE town_id = $1 AND id = $2`,
    [townId, npcId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    npcId: row.id,
    characterEntityId: row.character_entity_id,
    locationEntityId: row.location_entity_id,
    profileKey: row.profile_key,
    profileVersion: row.profile_version,
  };
}

export interface ActiveVisitLocation {
  readonly visitId: string;
  readonly currentLocationEntityId: string;
}

/**
 * The player's active visit and current location, or `undefined` with no
 * active visit — `uq_player_visits__active` guarantees at most one.
 */
export async function readActiveVisitLocation(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<ActiveVisitLocation | undefined> {
  const result = await pool.query<{
    readonly id: string;
    readonly current_location_entity_id: string;
  }>(
    `SELECT id, current_location_entity_id
       FROM public.player_visits
      WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
    [townId, playerId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { visitId: row.id, currentLocationEntityId: row.current_location_entity_id };
}

/** Co-location is exactly "the player's active visit shares the NPC's current location." */
export function isCoLocated(
  visit: ActiveVisitLocation | undefined,
  npc: NpcSnapshot | undefined,
): boolean {
  if (visit === undefined || npc === undefined) return false;
  return visit.currentLocationEntityId === npc.locationEntityId;
}

export interface GrantedCapability {
  readonly capabilityKey: string;
}

export async function readGrantedCapabilities(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<readonly GrantedCapability[]> {
  const result = await pool.query<{ readonly capability_key: string }>(
    `SELECT capability_key FROM public.player_capabilities
      WHERE town_id = $1 AND player_id = $2 AND status = 'granted'`,
    [townId, playerId],
  );
  return result.rows.map((row) => ({ capabilityKey: row.capability_key }));
}

export function hasCapability(
  capabilities: readonly GrantedCapability[],
  capabilityKey: string,
): boolean {
  return capabilities.some((capability) => capability.capabilityKey === capabilityKey);
}

export interface ItemCustody {
  readonly itemId: string;
  readonly heldByActorId: string | null;
  readonly locationEntityId: string | null;
  /** `INT8`, parsed to `number` by the global type parser (`database/client.ts`). */
  readonly revision: number;
}

/**
 * Custody for a set of items, keyed by item ID — feeds item-gate checks
 * (`itemCurrentlyHeldByPlayer`/`itemHeldByPlayer`) and the post-`give`
 * prediction (`ck_items__exactly_one_custodian` guarantees exactly one of
 * `heldByActorId`/`locationEntityId` is non-null on any row returned here).
 */
export async function readItemCustody(
  pool: Pool,
  townId: string,
  itemIds: readonly string[],
): Promise<ReadonlyMap<string, ItemCustody>> {
  if (itemIds.length === 0) return new Map();
  const result = await pool.query<{
    readonly id: string;
    readonly held_by_actor_id: string | null;
    readonly location_entity_id: string | null;
    readonly revision: number;
  }>(
    `SELECT id, held_by_actor_id, location_entity_id, revision
       FROM public.items
      WHERE town_id = $1 AND id = ANY($2)`,
    [townId, itemIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        itemId: row.id,
        heldByActorId: row.held_by_actor_id,
        locationEntityId: row.location_entity_id,
        revision: row.revision,
      },
    ]),
  );
}
