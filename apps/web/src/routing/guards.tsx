/**
 * Route guards driven entirely by the current `player-view` projection —
 * never by local state or "what action just ran" inference (Decision 011
 * §"Information architecture": "The current `player-view` is the router
 * guard").
 */

import type { PlayerView } from "@the-town-remembers/http-contracts";

import { buildWebPath, type RouteMatch } from "./routes.js";

/**
 * Returns the web path this route match should redirect to given the
 * current view, or `undefined` if the match is already correct. Pure and
 * synchronous — every input comes from `view`/`match`, nothing else.
 */
export function computeGuardRedirect(
  view: PlayerView,
  match: RouteMatch,
): string | undefined {
  const townId = view.town.id;

  if (view.town.status === "resolved" && match.name !== "resolution") {
    return buildWebPath("resolution", { townId });
  }

  if (view.player.visit.status === "away") {
    if (
      match.name === "map" ||
      match.name === "location" ||
      match.name === "encounter"
    ) {
      return buildWebPath("betweenVisits", { townId });
    }
    return undefined;
  }

  if (match.name === "betweenVisits") {
    return buildWebPath("map", { townId });
  }

  // Active or frozen: a real current location always exists.
  const currentLocationId = view.currentLocation?.id;

  if (match.name === "location") {
    const locationId = match.params["locationId"];
    if (currentLocationId !== undefined && locationId !== currentLocationId) {
      return buildWebPath("location", { townId, locationId: currentLocationId });
    }
  }

  if (match.name === "encounter") {
    const npcId = match.params["npcId"];
    const stillCoLocated = view.encounters.some(
      (encounter) => encounter.npc.id === npcId,
    );
    if (!stillCoLocated) {
      return currentLocationId !== undefined
        ? buildWebPath("location", { townId, locationId: currentLocationId })
        : buildWebPath("map", { townId });
    }
  }

  return undefined;
}

/** Whether the current visit accepts a mutating (gameplay) action right now. */
export function isFrozen(view: PlayerView): boolean {
  return view.player.visit.status === "frozen";
}
