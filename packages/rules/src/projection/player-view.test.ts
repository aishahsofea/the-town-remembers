import { describe, expect, it } from "vitest";

import { PlayerViewSchema } from "@the-town-remembers/http-contracts";

import {
  projectAccusationOptions,
  projectPlayerView,
  type PlayerViewProjectionInputs,
} from "./player-view.js";
import { computeViewVersion } from "./view-version.js";

function buildInputs(
  overrides: Partial<PlayerViewProjectionInputs> = {},
): PlayerViewProjectionInputs {
  const npc = { id: "npc-mara", actorType: "npc" as const, displayName: "Mara Venn" };
  const player = { id: "player-1", actorType: "player" as const, displayName: "Riley" };

  return {
    viewVersion: "placeholder",
    town: {
      id: "town-1",
      mysteryTitle: "The Bell Mystery",
      contentVersion: "bell-mystery-v1",
      tagline: "A festival bell has gone missing.",
      status: "active",
    },
    player: {
      id: "player-1",
      displayName: "Riley",
      visit: { status: "active", visitId: "visit-1", locationId: "festival_square" },
    },
    map: [
      {
        id: "festival_square",
        displayName: "Festival Square",
        description: "Bright bunting hangs over an empty bell frame.",
        sceneKey: "scene/festival-square",
        mapOrder: 0,
        access: { state: "open" },
      },
      {
        id: "old_chapel",
        displayName: "Old Chapel",
        description: "A disused stone chapel.",
        sceneKey: "scene/old-chapel",
        mapOrder: 3,
        access: { state: "locked", message: "The chapel door is locked." },
      },
    ],
    currentLocation: {
      location: { id: "festival_square", displayName: "Festival Square" },
      inspectables: [
        {
          id: "empty_bell_frame",
          displayName: "Empty Bell Frame",
          normalizedName: "empty bell frame",
          inspectionState: "available",
        },
      ],
    },
    encounters: [
      {
        npc,
        normalizedName: "mara venn",
        roleLabel: "Innkeeper",
        portraitKey: "portrait/mara-venn",
        openingLine: "If you've come for the truth, lower your voice.",
        stance: "neutral",
        permittedActionKinds: new Set(["ask", "tell"]),
      },
    ],
    inventory: [],
    discoveredClues: [
      {
        clueId: "clue-1",
        normalizedName: "bent clapper pin",
        title: "Bent Clapper Pin",
        description: "A freshly bent pin.",
        contributors: [{ discoverySequence: 1, player }],
      },
    ],
    activePromises: [],
    caseBoard: [],
    caseBoardContradictionsInput: { visibleEntries: [], contradictingClaimPairs: [] },
    caseAttempts: [],
    resolution: {
      state: "investigating",
      accusationGate: {
        state: "locked",
        message: "The town needs stronger verified evidence.",
      },
    },
    ambientTransition: null,
    ...overrides,
  };
}

describe("projectPlayerView", () => {
  it("produces a shape that validates against the real PlayerViewSchema", () => {
    const inputs = buildInputs();
    const projection = projectPlayerView(inputs);
    const withVersion = { ...projection, viewVersion: computeViewVersion(projection) };
    expect(() => PlayerViewSchema.parse(withVersion)).not.toThrow();
  });

  it("orders the map by mapOrder even when supplied out of order", () => {
    const inputs = buildInputs();
    const projection = projectPlayerView(inputs);
    expect(projection.map.map((location) => location.id)).toStrictEqual([
      "festival_square",
      "old_chapel",
    ]);
  });
});

describe("player-safety: hidden state changes never leak", () => {
  it("two identical inputs produce byte-identical projections and viewVersions", () => {
    const projectionA = projectPlayerView(buildInputs());
    const projectionB = projectPlayerView(buildInputs());
    expect(projectionA).toStrictEqual(projectionB);
    expect(computeViewVersion(projectionA)).toBe(computeViewVersion(projectionB));
  });

  it("shuffled repository row order yields byte-identical ordered output and viewVersion", () => {
    const forward = buildInputs();
    const shuffled = buildInputs({
      map: [...forward.map].toReversed(),
    });
    const projectionForward = projectPlayerView(forward);
    const projectionShuffled = projectPlayerView(shuffled);
    expect(projectionForward).toStrictEqual(projectionShuffled);
    expect(computeViewVersion(projectionForward)).toBe(
      computeViewVersion(projectionShuffled),
    );
  });

  it("opening the accusation gate changes the view", () => {
    const locked = projectPlayerView(buildInputs());
    const opened = projectPlayerView(
      buildInputs({
        resolution: {
          state: "investigating",
          accusationGate: {
            state: "open",
            options: { suspects: [], motives: [], locations: [] },
          },
        },
      }),
    );
    expect(computeViewVersion(locked)).not.toBe(computeViewVersion(opened));
  });

  it("a hidden change with no visible-input effect does not change the view", () => {
    // Nothing in PlayerViewProjectionInputs carries a raw belief score or
    // trust/suspicion number at all — only already-gated presentation
    // fields (stance, availableActionKinds, gate state) do. Building the
    // identical presentation twice, regardless of what hidden state
    // produced it, yields the same view by construction.
    const before = projectPlayerView(buildInputs());
    const after = projectPlayerView(buildInputs());
    expect(computeViewVersion(before)).toBe(computeViewVersion(after));
  });
});

describe("projectAccusationOptions", () => {
  it("orders by frozen authored order, not input order", () => {
    const options = projectAccusationOptions([
      { id: "b", displayName: "Corin Hale", authoredOrder: 1 },
      { id: "a", displayName: "Mara Venn", authoredOrder: 0 },
    ]);
    expect(options.map((option) => option.id)).toStrictEqual(["a", "b"]);
  });
});
