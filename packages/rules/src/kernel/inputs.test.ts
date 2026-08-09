import { describe, expect, it } from "vitest";

import type { CanonicalTownSnapshot } from "./inputs.js";

/**
 * Rule inputs are `readonly`-typed, but TypeScript's `readonly` is erased at
 * compile time. The actual enforcement is that every fixture a rule function
 * receives is frozen at the boundary before the rule runs, so an accidental
 * mutation throws immediately in strict-mode ESM rather than silently
 * corrupting a value another rule in the same tick still reads (`P2-01`
 * determinism check 1).
 */
function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) freezeDeep(entry);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      freezeDeep(entry);
    }
    return Object.freeze(value);
  }
  return value;
}

function buildFixtureSnapshot(): CanonicalTownSnapshot {
  return freezeDeep({
    town: { id: "town-1", revision: 1, last_event_sequence: 0 },
    items: [{ id: "item-1", held_by_actor_id: null }],
    playerCapabilities: [],
    promises: [],
    npcBeliefs: [{ npc_id: "npc-1", claim_id: "claim-1", score: 42 }],
    npcPlayerRelationships: [],
    npcContactEdges: [],
    playerVisits: [],
    caseSolution: { culprit_entity_id: "corin-1" },
    townResolutions: [],
  } as unknown as CanonicalTownSnapshot);
}

describe("frozen fixture boundary", () => {
  it("throws when a rule attempts to mutate a top-level field", () => {
    const snapshot = buildFixtureSnapshot();
    expect(() => {
      // @ts-expect-error -- proving the runtime freeze independent of the type system
      snapshot.town = null;
    }).toThrow(TypeError);
  });

  it("throws when a rule attempts to mutate a nested row", () => {
    const snapshot = buildFixtureSnapshot();
    expect(() => {
      // @ts-expect-error -- proving the runtime freeze independent of the type system
      snapshot.npcBeliefs[0].score = 100;
    }).toThrow(TypeError);
  });

  it("throws when a rule attempts to push into an array field", () => {
    const snapshot = buildFixtureSnapshot();
    const mutableView = snapshot as unknown as { items: unknown[] };
    expect(() => {
      mutableView.items.push({ id: "item-2" });
    }).toThrow(TypeError);
  });
});
