/**
 * Temporary stand-ins for the routes not yet built for real. Kept to one
 * file since none of them carry real behavior yet — each will be replaced
 * outright, not extended, when its own task lands. `Map`/`Location` moved
 * out in `P3-14`, `BetweenVisitsPlaceholder` out in `P3-16`, `Encounter` out
 * in `P4-18`; the rest remain here.
 */

export function BoardPlaceholder() {
  return (
    <main>
      <h1>Case board</h1>
      <p role="status">Read-only shell only in this phase.</p>
    </main>
  );
}

export function ResolutionPlaceholder() {
  return (
    <main>
      <h1>Resolution</h1>
      <p role="status">Not reachable in Phase 3 — accuse and resolve are Phase 6.</p>
    </main>
  );
}
