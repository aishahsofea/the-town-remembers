/**
 * The Decision 011 application shell: polls `player-view` once, applies the
 * projection-driven route guard, and renders the scene the current route
 * (already guard-corrected) names. Every town-scoped route in `App.tsx`
 * mounts through here rather than fetching its own `player-view`, so there
 * is exactly one poll loop and exactly one guard evaluation per render.
 */

import { useEffect, useState } from "react";

import { useActionSubmission } from "../api/actionSubmission.js";
import { usePlayerView } from "../api/playerView.js";
import { Casebook } from "../components/Casebook.js";
import { ActionRecoveryNotice } from "../components/ActionRecoveryNotice.js";
import { Header } from "../components/Header.js";
import { LeaveSheet } from "../components/LeaveSheet.js";
import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";
import { computeGuardRedirect } from "../routing/guards.js";
import type { RouteMatch } from "../routing/routes.js";
import { Away } from "./Away.js";
import { Location } from "./Location.js";
import { Map } from "./Map.js";
import {
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
  const action = useActionSubmission(townId, view?.player.id ?? "", refresh);
  const mutationPending = action.pending || action.readOnlyPending;
  const [showLeaveSheet, setShowLeaveSheet] = useState(false);

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
        pending={mutationPending}
        onLeave={() => setShowLeaveSheet(true)}
        leaveDisabled={mutationPending}
      />
      <div className="shell__body">
        {match.name === "map" ? (
          <Map
            view={view}
            pending={mutationPending}
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
          <Away
            activePromises={view.activePromises}
            pending={mutationPending}
            onReturnToFestivalSquare={() => void action.submit({ kind: "start_visit" })}
            onReviewCaseBoard={() => navigate(buildWebPath("board", { townId }))}
          />
        ) : match.name === "resolution" ? (
          <ResolutionPlaceholder />
        ) : null}
        <ActionRecoveryNotice action={action} />
        <Casebook inventory={view.inventory} activePromises={view.activePromises} />
      </div>
      {showLeaveSheet ? (
        <LeaveSheet
          activePromises={view.activePromises}
          pending={mutationPending}
          onStay={() => setShowLeaveSheet(false)}
          onLeave={() => {
            setShowLeaveSheet(false);
            void action.submit({ kind: "leave" });
          }}
        />
      ) : null}
    </div>
  );
}
