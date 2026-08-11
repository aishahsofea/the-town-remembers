/**
 * `/town/:townId/map` — the orienting screen, not a movement engine
 * (Decision 011 §"3. Town map"). Every location card renders directly from
 * `view.map`; nothing here infers position from a prior action.
 */

import type { PlayerView } from "@the-town-remembers/http-contracts";

import { LockedNotice } from "../components/LockedNotice.js";
import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";

export interface MapProps {
  readonly view: PlayerView;
  readonly pending: boolean;
  readonly onTravel: (destinationLocationId: string) => void;
}

export function Map({ view, pending, onTravel }: MapProps) {
  const currentLocationId = view.currentLocation?.id;

  return (
    <main className="map-screen">
      <h1>Town map</h1>
      <ul className="map-screen__locations">
        {view.map
          .toSorted((left, right) => left.mapOrder - right.mapOrder)
          .map((location) => {
            const isHere = location.id === currentLocationId;
            return (
              <li key={location.id} className="map-screen__location-card">
                <h2>{location.displayName}</h2>
                <p>{location.description}</p>
                {isHere ? (
                  <p aria-current="location">You are here</p>
                ) : location.access.state === "locked" ? (
                  <LockedNotice message={location.access.message} />
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onTravel(location.id)}
                  >
                    Travel
                  </button>
                )}
                {isHere ? (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(buildWebPath("location", { townId: view.town.id, locationId: location.id }))
                    }
                  >
                    Open
                  </button>
                ) : null}
              </li>
            );
          })}
      </ul>
    </main>
  );
}
