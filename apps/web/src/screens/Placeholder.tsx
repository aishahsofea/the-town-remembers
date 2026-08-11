/**
 * Temporary stand-ins for the routes `P3-14`/`P3-16` build for real. Kept to
 * one file since none of them carry real behavior yet — each will be
 * replaced outright, not extended, when its own task lands.
 */

export function MapPlaceholder() {
  return (
    <main>
      <h1>Town map</h1>
      <p role="status">Coming in P3-14.</p>
    </main>
  );
}

export function LocationPlaceholder() {
  return (
    <main>
      <h1>Location</h1>
      <p role="status">Coming in P3-14.</p>
    </main>
  );
}

export function EncounterPlaceholder() {
  return (
    <main>
      <h1>Encounter</h1>
      <p role="status">Not reachable in Phase 3 — no enabled action targets an NPC yet.</p>
    </main>
  );
}

export function BoardPlaceholder() {
  return (
    <main>
      <h1>Case board</h1>
      <p role="status">Read-only shell only in this phase.</p>
    </main>
  );
}

export function BetweenVisitsPlaceholder() {
  return (
    <main>
      <h1>Away</h1>
      <p role="status">Coming in P3-16.</p>
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
