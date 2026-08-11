/**
 * `/town/:townId/between-visits` (Decision 011 §"2. Opening and returning").
 *
 * Phase 3's `leave` always completes with `transitionStatus: "not_required"`
 * (`D3-Q` — Phase 3 can never produce an eligible ambient event), so this
 * screen never shows a time-passes stage: no `waiting`/`processing`
 * heading, no progress indicator, no gossip language, and no transition
 * retry control. `Return to Festival Square` is immediately enabled,
 * because there is nothing here to wait for.
 */

import type { ActivePromiseView } from "@the-town-remembers/http-contracts";

export interface AwayProps {
  readonly activePromises: readonly ActivePromiseView[];
  readonly pending: boolean;
  readonly onReturnToFestivalSquare: () => void;
  readonly onReviewCaseBoard: () => void;
}

export function Away({
  activePromises,
  pending,
  onReturnToFestivalSquare,
  onReviewCaseBoard,
}: AwayProps) {
  return (
    <main className="away-screen">
      <h1>Your visit is complete.</h1>
      <p>
        The Missing Festival Bell: the bell is gone, and the town remembers a different
        story in every mouth.
      </p>

      <button type="button" onClick={onReturnToFestivalSquare} disabled={pending}>
        Return to Festival Square
      </button>
      <button type="button" onClick={onReviewCaseBoard}>
        Review the case board
      </button>

      <section aria-label="Promises that may matter on your next visit">
        <h2>Promises</h2>
        {activePromises.length === 0 ? (
          <p>You have made no active promises.</p>
        ) : (
          <ul>
            {activePromises.map((promise) => (
              <li key={promise.promiseId}>
                <span>{promise.npc.displayName}</span>
                <p>{promise.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
