/**
 * The Leave confirmation sheet (Decision 011 §"Leave confirmation"). Opens
 * on `Leave town`; never submits the action until this sheet's own button is
 * clicked. Predicts no outcome — it only asks, and lists what's carried
 * forward.
 */

import type { ActivePromiseView } from "@the-town-remembers/http-contracts";

export interface LeaveSheetProps {
  readonly activePromises: readonly ActivePromiseView[];
  readonly pending: boolean;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}

export function LeaveSheet({
  activePromises,
  pending,
  onStay,
  onLeave,
}: LeaveSheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-sheet-heading"
      className="leave-sheet"
    >
      <h2 id="leave-sheet-heading">End this visit?</h2>
      <p>
        You will step away from town. What you said and did may shape what happens
        between visits. You can return when the town is ready.
      </p>

      <section aria-label="Promises you are carrying forward">
        <h3>Promises you are carrying forward</h3>
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

      <button type="button" onClick={onStay} disabled={pending}>
        Stay in town
      </button>
      <button type="button" onClick={onLeave} disabled={pending}>
        Leave town
      </button>
    </div>
  );
}
