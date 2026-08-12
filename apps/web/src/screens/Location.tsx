/**
 * `/town/:townId/location/:locationId` — the location scene (Decision 011
 * §"4. Location scene"). The inspect result replaces the selected
 * inspectable's own action area with a {@link ResultCard}; nothing here
 * writes to `view.currentLocation.inspectables` directly.
 */

import { useState } from "react";

import type { PlayerView } from "@the-town-remembers/http-contracts";

import { ResultCard } from "../components/ResultCard.js";
import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";
import type { UseActionSubmissionResult } from "../api/actionSubmission.js";

export interface LocationProps {
  readonly view: PlayerView;
  readonly action: UseActionSubmissionResult;
}

export function Location({ view, action }: LocationProps) {
  const [inspectedId, setInspectedId] = useState<string | undefined>(undefined);
  const currentLocation = view.currentLocation;

  if (!currentLocation) {
    // The router guard already redirects an away player elsewhere; this is
    // only a defensive fallback for a render that races that redirect.
    return null;
  }

  function handleExamine(inspectableId: string) {
    setInspectedId(inspectableId);
    void action.submit({ kind: "inspect", inspectableId });
  }

  return (
    <main className="location-screen">
      <h1>{currentLocation.displayName}</h1>

      <section aria-label="People here">
        {view.encounters.length === 0 ? null : (
          <ul>
            {view.encounters.map((encounter) => (
              <li key={encounter.npc.id}>
                <span>{encounter.npc.displayName}</span>
                <span>{encounter.roleLabel}</span>
                <span>{encounter.stance}</span>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      buildWebPath("encounter", {
                        townId: view.town.id,
                        npcId: encounter.npc.id,
                      }),
                    )
                  }
                >
                  Speak with {encounter.npc.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Things to examine">
        <ul>
          {currentLocation.inspectables.map((inspectable) => (
            <li key={inspectable.id}>
              <h2>{inspectable.displayName}</h2>
              {inspectedId === inspectable.id && action.lastResult ? (
                <ResultCard result={action.lastResult} />
              ) : (
                <button
                  type="button"
                  disabled={action.pending || action.readOnlyPending}
                  onClick={() => handleExamine(inspectable.id)}
                >
                  Examine
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <nav aria-label="Destinations">
        <button
          type="button"
          onClick={() => navigate(buildWebPath("map", { townId: view.town.id }))}
        >
          Back to map
        </button>
      </nav>
    </main>
  );
}
