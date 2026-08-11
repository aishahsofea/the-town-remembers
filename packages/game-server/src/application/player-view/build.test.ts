/**
 * Unit coverage for `buildPlayerView`'s branching, with `persistence/view-queries.ts`
 * mocked out. The db-backed acceptance suite (`http/player-view.db.test.ts`)
 * proves the real reads; this file proves the assembly logic reachable only
 * through fixtures a real town can't yet produce in Phase 3 — an open
 * accusation gate, a frozen visit, and every `required()` invariant guard.
 */

import {
  NPC_PORTRAIT_KEYS,
  NPC_ROLE_LABELS,
  contentFor,
} from "@the-town-remembers/content";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClueDiscoveryRow,
  CoLocatedNpcRow,
  ConfrontationGateStatusRow,
  InspectableRow,
  InventoryItemRow,
  LocationAccessRow,
  PlayerAndVisitRow,
  StoryEntityRow,
  TownHeaderRow,
} from "../../persistence/view-queries.js";

const {
  readTownHeader,
  readPlayerAndVisit,
  readMapAccess,
  readInventory,
  readDiscoveredClues,
  readConfrontationGateStatus,
  readInspectables,
  readCoLocatedNpcs,
  readAccusationCandidateEntities,
} = vi.hoisted(() => ({
  readTownHeader: vi.fn(),
  readPlayerAndVisit: vi.fn(),
  readMapAccess: vi.fn(),
  readInventory: vi.fn(),
  readDiscoveredClues: vi.fn(),
  readConfrontationGateStatus: vi.fn(),
  readInspectables: vi.fn(),
  readCoLocatedNpcs: vi.fn(),
  readAccusationCandidateEntities: vi.fn(),
}));

vi.mock("../../persistence/view-queries.js", () => ({
  readTownHeader,
  readPlayerAndVisit,
  readMapAccess,
  readInventory,
  readDiscoveredClues,
  readConfrontationGateStatus,
  readInspectables,
  readCoLocatedNpcs,
  readAccusationCandidateEntities,
}));

const { buildPlayerView } = await import("./build.js");

const CONTENT = contentFor("bell-mystery-v1");
const UNUSED_POOL = {} as unknown as Pool;
const TOWN_ID = "town_1";
const PLAYER_ID = "player_1";

function locationRows(omitEntityKeys: readonly string[] = []): LocationAccessRow[] {
  return CONTENT.locations
    .filter((location) => !omitEntityKeys.includes(location.entityKey))
    .map((location) => ({
      id: `loc_${location.entityKey}`,
      entityKey: location.entityKey,
      displayName: location.displayName,
      access:
        location.entityKey === "old_chapel"
          ? { state: "locked" as const, message: "The chapel door is locked." }
          : { state: "open" as const },
    }));
}

function zeroGateStatus(): ConfrontationGateStatusRow {
  return { bellRevealed: false, requiredDiscoveredCount: 0, requiredTotalCount: 3 };
}

function baseMocks(): void {
  readTownHeader.mockResolvedValue({
    status: "active",
    contentVersion: "bell-mystery-v1",
  } satisfies TownHeaderRow);
  readPlayerAndVisit.mockResolvedValue({
    displayName: "Test Player",
    visitId: null,
    locationEntityId: null,
  } satisfies PlayerAndVisitRow);
  readMapAccess.mockResolvedValue(locationRows());
  readInventory.mockResolvedValue([] satisfies InventoryItemRow[]);
  readDiscoveredClues.mockResolvedValue([] satisfies ClueDiscoveryRow[]);
  readConfrontationGateStatus.mockResolvedValue(zeroGateStatus());
  readInspectables.mockResolvedValue([] satisfies InspectableRow[]);
  readCoLocatedNpcs.mockResolvedValue([] satisfies CoLocatedNpcRow[]);
  readAccusationCandidateEntities.mockResolvedValue([] satisfies StoryEntityRow[]);
}

beforeEach(() => {
  vi.clearAllMocks();
  baseMocks();
});

describe("visit status", () => {
  it("is away when there is no active visit, and never reads location-scoped rows", async () => {
    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });
    expect(view.player.visit).toStrictEqual({ status: "away" });
    expect(view.currentLocation).toBeNull();
    expect(view.encounters).toStrictEqual([]);
    expect(readInspectables).not.toHaveBeenCalled();
    expect(readCoLocatedNpcs).not.toHaveBeenCalled();
  });

  it("is active while the town is active", async () => {
    readPlayerAndVisit.mockResolvedValue({
      displayName: "Test Player",
      visitId: "visit_1",
      locationEntityId: "loc_festival_square",
    } satisfies PlayerAndVisitRow);

    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });
    expect(view.player.visit).toStrictEqual({
      status: "active",
      visitId: "visit_1",
      locationId: "loc_festival_square",
    });
  });

  it("is frozen when the visit is active but the town is not", async () => {
    readTownHeader.mockResolvedValue({
      status: "awaiting_resolution",
      contentVersion: "bell-mystery-v1",
    } satisfies TownHeaderRow);
    readPlayerAndVisit.mockResolvedValue({
      displayName: "Test Player",
      visitId: "visit_1",
      locationEntityId: "loc_festival_square",
    } satisfies PlayerAndVisitRow);

    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });
    expect(view.player.visit).toStrictEqual({
      status: "frozen",
      visitId: "visit_1",
      locationId: "loc_festival_square",
    });
    expect(view.town.status).toBe("awaiting_resolution");
  });
});

describe("current location, encounters, and inventory", () => {
  it("resolves content-driven presentation for a co-located NPC and a held item", async () => {
    readPlayerAndVisit.mockResolvedValue({
      displayName: "Test Player",
      visitId: "visit_1",
      locationEntityId: "loc_festival_square",
    } satisfies PlayerAndVisitRow);
    readInspectables.mockResolvedValue([
      {
        id: "insp_1",
        inspectableKey: "empty_bell_frame",
        displayName: "Empty Bell Frame",
        alreadyInspected: false,
      },
    ] satisfies InspectableRow[]);
    readCoLocatedNpcs.mockResolvedValue([
      {
        npcId: "npc_corin",
        characterKey: "corin_hale",
        displayName: "Corin Hale",
        trustScore: 0,
        suspicionScore: 0,
      },
    ] satisfies CoLocatedNpcRow[]);
    readInventory.mockResolvedValue([
      { itemId: "item_1", entityKey: "nessas_field_lens", displayName: "A field lens" },
    ] satisfies InventoryItemRow[]);

    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });

    expect(view.currentLocation?.inspectables).toHaveLength(1);
    expect(view.encounters).toHaveLength(1);
    expect(view.encounters[0]?.roleLabel).toBe(NPC_ROLE_LABELS["corin_hale"]);
    expect(view.encounters[0]?.portraitKey).toBe(NPC_PORTRAIT_KEYS["corin_hale"]);
    expect(view.encounters[0]?.availableActionKinds).toStrictEqual([]);
    expect(view.inventory).toHaveLength(1);
    expect(view.inventory[0]?.description.length).toBeGreaterThan(0);
  });
});

describe("discoveredClues grouping", () => {
  it("groups multiple contributors under one clue entry", async () => {
    const clueId = CONTENT.clues[0]!.clueKey;
    readDiscoveredClues.mockResolvedValue([
      {
        clueId,
        clueKey: CONTENT.clues[0]!.clueKey,
        playerId: "player_a",
        playerDisplayName: "Player A",
        discoverySequence: 1,
      },
      {
        clueId,
        clueKey: CONTENT.clues[0]!.clueKey,
        playerId: "player_b",
        playerDisplayName: "Player B",
        discoverySequence: 2,
      },
    ] satisfies ClueDiscoveryRow[]);

    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });

    expect(view.discoveredClues).toHaveLength(1);
    expect(view.discoveredClues[0]?.contributors).toHaveLength(2);
    expect(view.discoveredClues[0]?.firstContributor.id).toBe("player_a");
  });
});

describe("invariant guards", () => {
  it("throws when the town header is missing", async () => {
    readTownHeader.mockResolvedValue(undefined);
    await expect(
      buildPlayerView(UNUSED_POOL, { townId: TOWN_ID, playerId: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("throws when the player and visit row is missing", async () => {
    readPlayerAndVisit.mockResolvedValue(undefined);
    await expect(
      buildPlayerView(UNUSED_POOL, { townId: TOWN_ID, playerId: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("throws when the town is retired", async () => {
    readTownHeader.mockResolvedValue({
      status: "retired",
      contentVersion: "bell-mystery-v1",
    } satisfies TownHeaderRow);
    await expect(
      buildPlayerView(UNUSED_POOL, { townId: TOWN_ID, playerId: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("throws when a location row names a key absent from the content registry", async () => {
    readMapAccess.mockResolvedValue([
      {
        id: "loc_phantom",
        entityKey: "phantom_location",
        displayName: "Phantom",
        access: { state: "open" as const },
      },
    ] satisfies LocationAccessRow[]);
    await expect(
      buildPlayerView(UNUSED_POOL, { townId: TOWN_ID, playerId: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("the confrontation gate", () => {
  it("stays locked when the gate status is not fully satisfied", async () => {
    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });
    expect(view.resolution).toStrictEqual({
      state: "investigating",
      accusationGate: {
        state: "locked",
        message: CONTENT.evidenceGateLockedMessage,
      },
    });
  });

  it("opens with the full authored candidate lists once satisfied, and drops any candidate the database did not return", async () => {
    readConfrontationGateStatus.mockResolvedValue({
      bellRevealed: true,
      requiredDiscoveredCount: 3,
      requiredTotalCount: 3,
    } satisfies ConfrontationGateStatusRow);

    const missingCharacterKey = CONTENT.characters.at(-1)!.entityKey;
    const missingMotiveKey = CONTENT.motives.at(-1)!.entityKey;
    readAccusationCandidateEntities.mockImplementation(
      (_pool: Pool, _townId: string, entityType: "character" | "motive") => {
        const source =
          entityType === "character" ? CONTENT.characters : CONTENT.motives;
        const omit =
          entityType === "character" ? missingCharacterKey : missingMotiveKey;
        return Promise.resolve(
          source
            .filter((entity) => entity.entityKey !== omit)
            .map((entity) => ({
              id: `${entityType}_${entity.entityKey}`,
              entityKey: entity.entityKey,
            })),
        );
      },
    );
    readMapAccess.mockResolvedValue(locationRows(["old_chapel"]));

    const view = await buildPlayerView(UNUSED_POOL, {
      townId: TOWN_ID,
      playerId: PLAYER_ID,
    });

    expect(view.resolution.state).toBe("investigating");
    if (view.resolution.state !== "investigating") throw new Error("unreachable");
    const gate = view.resolution.accusationGate;
    expect(gate.state).toBe("open");
    if (gate.state !== "open") throw new Error("unreachable");

    expect(gate.options.suspects).toHaveLength(CONTENT.characters.length - 1);
    expect(gate.options.motives).toHaveLength(CONTENT.motives.length - 1);
    expect(gate.options.locations).toHaveLength(CONTENT.locations.length - 1);
    expect(gate.options.suspects[0]?.displayName).toBe(
      CONTENT.characters[0]?.displayName,
    );
    expect(
      gate.options.suspects.some((option) => option.displayName === "Lark Venn"),
    ).toBe(false);
  });
});
