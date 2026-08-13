/**
 * `travel`'s `D3-N` narrow input loader and its full `ActionHandler`
 * (`P3-10`).
 *
 * The requested destination is resolved to a real `story_entities` row (or
 * not) in two places for two different reasons: {@link resolveTravelTarget}
 * runs once in `http/router.ts`, before the action is even claimed, because
 * `player_actions.target_entity_id` carries a real foreign key to
 * `story_entities` (`fk_player_actions__target_entity`) — a genuinely
 * unknown destination cannot be stored there, so the router must already
 * know whether it exists before claiming. The loader below re-resolves the
 * same `targetEntityId` a second time, from inside the executor's
 * town-revision-retry loop, purely to read the location's `entity_key` for
 * the access check; it never re-derives "known or not" independently — that
 * already travelled through `LoadInputsContext.targetEntityId`.
 *
 * Only the Old Chapel is ever locked in `bell-mystery-v1`.
 * {@link resolveDestinationAccess} hardcodes exactly that, matching the same
 * convention `persistence/view-queries.ts#readMapAccess` already uses rather
 * than inventing content-agnostic locked-location machinery for one location.
 */

import { LOCATIONS, LOCKED_LOCATION_MESSAGE } from "@the-town-remembers/content";
import type { ActionResultByKind } from "@the-town-remembers/http-contracts";
import {
  deniedResult,
  dispatcherTrace,
  hasChapelAccess,
  planTravel,
  type LocationAccessState,
  type ReasonCode,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import type { ActionHandler, LoadInputsContext } from "../executor.js";
import { isDatabaseUuid } from "../../../persistence/identifiers.js";

export interface TravelLoadedInputs {
  readonly playerId: string;
  readonly townId: string;
  readonly townActive: boolean;
  readonly townRevision: number;
  readonly hasActiveVisit: boolean;
  readonly visitId: string | null;
  readonly currentLocationId: string | null;
  readonly destinationLocationId: string;
  readonly destinationKnown: boolean;
  readonly destinationAccess: LocationAccessState;
}

interface DestinationEntity {
  readonly id: string;
  readonly entityKey: string;
}

/**
 * Every location this town has, keyed by id — used both to decide whether a
 * requested destination exists at all, and (when it does) to read its
 * `entity_key` for the access check.
 */
async function readLocationById(
  pool: Pool,
  townId: string,
  id: string,
): Promise<DestinationEntity | undefined> {
  if (!isDatabaseUuid(id)) return undefined;
  const result = await pool.query<{ readonly id: string; readonly entity_key: string }>(
    `SELECT id, entity_key FROM public.story_entities
      WHERE town_id = $1 AND id = $2 AND entity_type = 'location'`,
    [townId, id],
  );
  const row = result.rows[0];
  return row ? { id: row.id, entityKey: row.entity_key } : undefined;
}

/**
 * Called once by `http/router.ts`, before the action is claimed, to decide
 * the `targetEntityId` the claim itself stores. A cross-town location, an
 * item id, or any other id this town's `story_entities` does not carry all
 * resolve to `null` alike — the whole point of `DESTINATION_UNKNOWN` is that
 * none of those are distinguishable from one another.
 */
export async function resolveTravelTarget(
  pool: Pool,
  townId: string,
  destinationLocationId: string,
): Promise<string | null> {
  const destination = await readLocationById(pool, townId, destinationLocationId);
  return destination?.id ?? null;
}

async function resolveDestinationAccess(
  pool: Pool,
  townId: string,
  playerId: string,
  entityKey: string,
): Promise<LocationAccessState> {
  const authored = LOCATIONS.find((location) => location.entityKey === entityKey);
  if (!authored || authored.initiallyOpen) return { state: "open" };

  const [capability, chapelKey] = await Promise.all([
    pool.query(
      `SELECT 1 FROM public.player_capabilities
        WHERE town_id = $1 AND player_id = $2 AND capability_key = 'enter_old_chapel'
          AND status = 'granted'`,
      [townId, playerId],
    ),
    pool.query(
      `SELECT 1 FROM public.items i
         JOIN public.story_entities se ON se.town_id = i.town_id AND se.id = i.id
        WHERE i.town_id = $1 AND se.entity_key = 'old_chapel_key' AND i.held_by_actor_id = $2`,
      [townId, playerId],
    ),
  ]);
  const hasCapability = (capability.rowCount ?? 0) > 0;
  const holdsChapelKey = (chapelKey.rowCount ?? 0) > 0;
  return hasChapelAccess(holdsChapelKey, hasCapability)
    ? { state: "open" }
    : { state: "locked" };
}

async function readTownStatusAndRevision(
  pool: Pool,
  townId: string,
): Promise<{ readonly active: boolean; readonly revision: number }> {
  const result = await pool.query<{
    readonly status: string;
    readonly revision: number;
  }>("SELECT status, revision FROM public.towns WHERE id = $1", [townId]);
  const row = result.rows[0]!;
  return { active: row.status === "active", revision: row.revision };
}

async function readActiveVisit(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<
  { readonly id: string; readonly currentLocationEntityId: string } | undefined
> {
  const result = await pool.query<{
    readonly id: string;
    readonly current_location_entity_id: string;
  }>(
    `SELECT id, current_location_entity_id FROM public.player_visits
      WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
    [townId, playerId],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, currentLocationEntityId: row.current_location_entity_id }
    : undefined;
}

export async function loadTravelInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<TravelLoadedInputs> {
  const destinationLocationId = context.requestPayload[
    "destinationLocationId"
  ] as string;

  const [town, visit, destination] = await Promise.all([
    readTownStatusAndRevision(pool, context.townId),
    readActiveVisit(pool, context.townId, context.playerId),
    context.targetEntityId
      ? readLocationById(pool, context.townId, context.targetEntityId)
      : Promise.resolve(undefined),
  ]);

  const destinationAccess = destination
    ? await resolveDestinationAccess(
        pool,
        context.townId,
        context.playerId,
        destination.entityKey,
      )
    : ({ state: "open" } as const);

  return {
    playerId: context.playerId,
    townId: context.townId,
    townActive: town.active,
    townRevision: town.revision,
    hasActiveVisit: visit !== undefined,
    visitId: visit?.id ?? null,
    currentLocationId: visit?.currentLocationEntityId ?? null,
    destinationLocationId,
    destinationKnown: destination !== undefined,
    destinationAccess,
  };
}

const GENERIC_DENIAL_MESSAGE = "That isn't possible right now.";

const TRAVEL_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  VISIT_NOT_ACTIVE: "Start a visit before you travel.",
  TOWN_NOT_ACTIVE: "This town's story is no longer taking new moves.",
  DESTINATION_UNKNOWN: "That place isn't part of this town.",
  LOCATION_LOCKED: LOCKED_LOCATION_MESSAGE,
};

export const travelActionHandler: ActionHandler<"travel", TravelLoadedInputs> = {
  kind: "travel",
  loadInputs: loadTravelInputs,
  plan(inputs) {
    const trace = dispatcherTrace("actions.travel", [inputs.destinationLocationId]);
    if (!inputs.hasActiveVisit) return deniedResult("VISIT_NOT_ACTIVE", trace, {});
    // `awaiting_resolution`/`resolved` freeze all gameplay (docs/006
    // "Accusation and resolution"); an away player is caught by the check
    // above, so reaching here with no active visit is impossible — this is
    // exactly the phase-plan's "frozen" visit case (an active visit in a
    // town that is no longer `active`).
    if (!inputs.townActive) return deniedResult("TOWN_NOT_ACTIVE", trace, {});
    return planTravel({
      currentLocationId: inputs.currentLocationId!,
      destinationLocationId: inputs.destinationLocationId,
      destinationKnown: inputs.destinationKnown,
      destinationAccess: inputs.destinationAccess,
      visitId: inputs.visitId!,
      townId: inputs.townId,
      townRevision: inputs.townRevision,
    });
  },
  buildResult(inputs, effects): ActionResultByKind["travel"] {
    const applied = effects.length > 0;
    return {
      disposition: applied ? "arrived" : "already_there",
      locationId: inputs.destinationLocationId,
    };
  },
  reasonMessage: (code) => TRAVEL_DENIAL_MESSAGES[code] ?? GENERIC_DENIAL_MESSAGE,
  resolveVisitId: (inputs) => inputs.visitId,
  eventMetadata: (inputs) => ({
    actorId: inputs.playerId,
    locationEntityId: inputs.destinationLocationId,
  }),
};
