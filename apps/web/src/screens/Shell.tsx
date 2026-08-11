/**
 * The Decision 011 application shell: polls `player-view` once, applies the
 * projection-driven route guard, and renders the scene the current route
 * (already guard-corrected) names. Every town-scoped route in `App.tsx`
 * mounts through here rather than fetching its own `player-view`, so there
 * is exactly one poll loop and exactly one guard evaluation per render.
 */

import { useEffect } from "react";

import { useActionSubmission } from "../api/actionSubmission.js";
import { usePlayerView } from "../api/playerView.js";
import { Casebook } from "../components/Casebook.js";
import { Header } from "../components/Header.js";
import { navigate } from "../routing/navigation.js";
import { computeGuardRedirect } from "../routing/guards.js";
import type { RouteMatch } from "../routing/routes.js";
import { Location } from "./Location.js";
import { Map } from "./Map.js";
import {
  BetweenVisitsPlaceholder,
  BoardPlaceholder,
  EncounterPlaceholder,
  ResolutionPlaceholder,
} from "./Placeholder.js";

export interface ShellProps {
  readonly match: RouteMatch;
}

export function Shell({ match }: ShellProps) {
  const townId = match.params["townId"]!;
  const { status, view, refresh } = usePlayerView(townId);
  const action = useActionSubmission(townId, refresh);

  const redirect = view ? computeGuardRedirect(view, match) : undefined;

  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);

  if (status === "unauthenticated") {
    return (
      <main>
        <p role="status">
          This browser no longer has its town pass. Reopen the invite link to continue.
        </p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main>
        <p role="status">Something went wrong. Try again.</p>
      </main>
    );
  }

  if (!view || redirect) {
    return (
      <main>
        <p role="status" aria-live="polite">
          Loading…
        </p>
      </main>
    );
  }

  return (
    <div className="shell">
      <Header
        view={view}
        pending={action.pending}
        // The Leave confirmation sheet and its real submit land in P3-16;
        // this header exists and renders correctly before then, but does
        // not yet let a player actually leave.
        onLeave={() => {}}
        leaveDisabled
      />
      <div className="shell__body">
        {match.name === "map" ? (
          <Map
            view={view}
            pending={action.pending}
            onTravel={(destinationLocationId) =>
              void action.submit({ kind: "travel", destinationLocationId })
            }
          />
        ) : match.name === "location" ? (
          <Location view={view} action={action} />
        ) : match.name === "encounter" ? (
          <EncounterPlaceholder />
        ) : match.name === "board" ? (
          <BoardPlaceholder />
        ) : match.name === "betweenVisits" ? (
          <BetweenVisitsPlaceholder />
        ) : match.name === "resolution" ? (
          <ResolutionPlaceholder />
        ) : null}
        <Casebook inventory={view.inventory} activePromises={view.activePromises} />
      </div>
    </div>
  );
}
