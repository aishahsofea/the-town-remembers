import { describe, expect, it } from "vitest";

import type { PlayerView } from "@the-town-remembers/http-contracts";

import { computeGuardRedirect, isFrozen } from "./guards.js";

function baseView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    viewVersion: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE",
    town: {
      id: "town-1",
      mysteryTitle: "The Missing Festival Bell",
      contentVersion: "bell-mystery-v1",
      tagline: "The bell is gone.",
      status: "active",
    },
    player: {
      id: "p1",
      displayName: "Aishah Sofea",
      visit: { status: "active", visitId: "v1", locationId: "loc-square" },
    },
    map: [],
    currentLocation: { id: "loc-square", displayName: "Festival Square", inspectables: [] },
    encounters: [],
    inventory: [],
    discoveredClues: [],
    activePromises: [],
    caseBoard: [],
    caseBoardContradictions: [],
    caseAttempts: [],
    resolution: { state: "investigating", accusationGate: { state: "locked", message: "Locked." } },
    ambientTransition: null,
    ...overrides,
  };
}

describe("computeGuardRedirect", () => {
  it("does not redirect an active player on the map", () => {
    const view = baseView();
    expect(computeGuardRedirect(view, { name: "map", params: { townId: "town-1" } })).toBeUndefined();
  });

  it("redirects an away player off the map to between-visits", () => {
    const view = baseView({ player: { id: "p1", displayName: "Aishah Sofea", visit: { status: "away" } } });
    expect(computeGuardRedirect(view, { name: "map", params: { townId: "town-1" } })).toBe(
      "/town/town-1/between-visits",
    );
  });

  it("does not redirect an away player already on between-visits or the board", () => {
    const view = baseView({ player: { id: "p1", displayName: "Aishah Sofea", visit: { status: "away" } } });
    expect(
      computeGuardRedirect(view, { name: "betweenVisits", params: { townId: "town-1" } }),
    ).toBeUndefined();
    expect(
      computeGuardRedirect(view, { name: "board", params: { townId: "town-1" } }),
    ).toBeUndefined();
  });

  it("redirects a stale location URL to the real current location", () => {
    const view = baseView();
    const redirect = computeGuardRedirect(view, {
      name: "location",
      params: { townId: "town-1", locationId: "loc-stale" },
    });
    expect(redirect).toBe("/town/town-1/location/loc-square");
  });

  it("does not redirect a location URL that already matches the current location", () => {
    const view = baseView();
    expect(
      computeGuardRedirect(view, {
        name: "location",
        params: { townId: "town-1", locationId: "loc-square" },
      }),
    ).toBeUndefined();
  });

  it("redirects a stale encounter (NPC no longer co-located) to the current location", () => {
    const view = baseView({ encounters: [] });
    const redirect = computeGuardRedirect(view, {
      name: "encounter",
      params: { townId: "town-1", npcId: "npc-1" },
    });
    expect(redirect).toBe("/town/town-1/location/loc-square");
  });

  it("does not redirect an encounter whose NPC is still co-located", () => {
    const view = baseView({
      encounters: [
        {
          npc: { id: "npc-1", actorType: "npc", displayName: "Nessa Reed" },
          roleLabel: "Herbalist",
          portraitKey: "bell-mystery-v1/portraits/nessa-reed",
          openingLine: "Hello.",
          stance: "neutral",
          availableActionKinds: [],
        },
      ],
    });
    expect(
      computeGuardRedirect(view, {
        name: "encounter",
        params: { townId: "town-1", npcId: "npc-1" },
      }),
    ).toBeUndefined();
  });

  it("redirects to the resolution screen once the town is resolved, from any other route", () => {
    const view = baseView({
      town: {
        id: "town-1",
        mysteryTitle: "The Missing Festival Bell",
        contentVersion: "bell-mystery-v1",
        tagline: "The bell is gone.",
        status: "resolved",
      },
    });
    expect(computeGuardRedirect(view, { name: "map", params: { townId: "town-1" } })).toBe(
      "/town/town-1/resolution",
    );
    expect(
      computeGuardRedirect(view, { name: "resolution", params: { townId: "town-1" } }),
    ).toBeUndefined();
  });

  it("never redirects a frozen visit — it stays readable in place", () => {
    const view = baseView({
      town: {
        id: "town-1",
        mysteryTitle: "The Missing Festival Bell",
        contentVersion: "bell-mystery-v1",
        tagline: "The bell is gone.",
        status: "awaiting_resolution",
      },
      player: {
        id: "p1",
        displayName: "Aishah Sofea",
        visit: { status: "frozen", visitId: "v1", locationId: "loc-square" },
      },
    });
    expect(
      computeGuardRedirect(view, {
        name: "location",
        params: { townId: "town-1", locationId: "loc-square" },
      }),
    ).toBeUndefined();
  });
});

describe("isFrozen", () => {
  it("is true only for a frozen visit", () => {
    expect(isFrozen(baseView())).toBe(false);
    expect(
      isFrozen(
        baseView({
          player: {
            id: "p1",
            displayName: "Aishah Sofea",
            visit: { status: "frozen", visitId: "v1", locationId: "loc-square" },
          },
        }),
      ),
    ).toBe(true);
  });
});
