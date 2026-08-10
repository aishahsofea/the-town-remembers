/**
 * Proves the schemas Phase 3 depends on already accept what a handler will
 * emit. `packages/game-server` writes no new schema for these shapes — this
 * suite is the promise that it does not need to.
 */

import { describe, expect, it } from "vitest";

import {
  ActionResultSchemaByKind,
  CompletedActionResponseSchema,
  DeniedActionResultSchema,
  type ActionResultByKind,
} from "./actions.js";
import {
  AccusationGateSchema,
  PlayerViewSchema,
  type PlayerView,
} from "./player-view.js";

const PLAYER = { id: "actor_mara", actorType: "player", displayName: "Mara" } as const;

/** One hand-written fixture per Phase 3 action kind, from the plan's D3-N/D3-I scope. */
const PHASE_3_RESULT_FIXTURES: {
  readonly [K in "start_visit" | "travel" | "inspect" | "leave"]: ActionResultByKind[K];
} = {
  start_visit: {
    disposition: "started",
    visitId: "visit_1",
    locationId: "loc_festival_square",
  },
  travel: { disposition: "arrived", locationId: "loc_old_chapel" },
  inspect: {
    inspectableId: "insp_bell_crack",
    discovery: "new_to_town",
    clue: {
      clueId: "clue_bell_crack",
      title: "A hairline crack",
      description: "The bell's rim shows a fresh crack, hidden from the square.",
      firstContributor: PLAYER,
      contributors: [PLAYER],
    },
  },
  leave: { visitId: "visit_1", transitionStatus: "not_required" },
};

describe("Phase 3 action result conformance", () => {
  it.each(Object.entries(PHASE_3_RESULT_FIXTURES))(
    "round-trips the %s fixture through its own result schema",
    (kind, fixture) => {
      const schema =
        ActionResultSchemaByKind[kind as keyof typeof PHASE_3_RESULT_FIXTURES];
      expect(schema.parse(fixture)).toStrictEqual(fixture);
    },
  );

  it.each(Object.entries(PHASE_3_RESULT_FIXTURES))(
    "accepts the %s fixture under an applied completed envelope",
    (kind, fixture) => {
      const parsed = CompletedActionResponseSchema.safeParse({
        actionId: "act_1",
        kind,
        status: "completed",
        outcome: "applied",
        result: fixture,
      });
      expect(parsed.success).toBe(true);
    },
  );

  it.each(Object.entries(PHASE_3_RESULT_FIXTURES))(
    "accepts the %s fixture under a no_change completed envelope",
    (kind, fixture) => {
      const parsed = CompletedActionResponseSchema.safeParse({
        actionId: "act_1",
        kind,
        status: "completed",
        outcome: "no_change",
        result: fixture,
      });
      expect(parsed.success).toBe(true);
    },
  );

  it.each(Object.keys(PHASE_3_RESULT_FIXTURES))(
    "accepts a denied outcome for %s under a denied completed envelope",
    (kind) => {
      const denied = DeniedActionResultSchema.parse({
        type: "denied",
        reasonCode: "LOCATION_LOCKED",
        message: "That place is not open to you yet.",
      });
      const parsed = CompletedActionResponseSchema.safeParse({
        actionId: "act_1",
        kind,
        status: "completed",
        outcome: "denied",
        result: denied,
      });
      expect(parsed.success).toBe(true);
    },
  );

  it("rejects a denied result carrying another kind's applied shape", () => {
    const parsed = CompletedActionResponseSchema.safeParse({
      actionId: "act_1",
      kind: "travel",
      status: "completed",
      outcome: "denied",
      result: PHASE_3_RESULT_FIXTURES.travel,
    });
    expect(parsed.success).toBe(false);
  });
});

const FULLY_POPULATED_PLAYER_VIEW: PlayerView = {
  viewVersion: "A".repeat(43),
  town: {
    id: "town_1",
    mysteryTitle: "The Bell That Would Not Ring",
    contentVersion: "bell-mystery-v1",
    tagline: "A quiet town remembers what it tried to forget.",
    status: "active",
  },
  player: {
    id: "player_mara",
    displayName: "Mara Venn",
    visit: { status: "active", visitId: "visit_1", locationId: "loc_festival_square" },
  },
  map: [
    {
      id: "loc_festival_square",
      displayName: "Festival Square",
      description: "Bunting still hangs from last year's festival.",
      sceneKey: "scenes/festival-square",
      mapOrder: 0,
      access: { state: "open" },
    },
    {
      id: "loc_old_chapel",
      displayName: "The Old Chapel",
      description: "A locked chapel at the edge of town.",
      sceneKey: "scenes/old-chapel",
      mapOrder: 1,
      access: { state: "locked", message: "This place is not open to you yet." },
    },
  ],
  currentLocation: {
    id: "loc_festival_square",
    displayName: "Festival Square",
    inspectables: [
      {
        id: "insp_bell_crack",
        displayName: "The town bell",
        inspectionState: "available",
      },
    ],
  },
  encounters: [
    {
      npc: { id: "npc_corin", actorType: "npc", displayName: "Corin Hale" },
      roleLabel: "Town guard",
      portraitKey: "portraits/corin-hale",
      openingLine: "Quiet day, isn't it.",
      stance: "neutral",
      availableActionKinds: ["ask", "tell"],
    },
  ],
  inventory: [
    {
      itemId: "item_ledger_page",
      displayName: "A torn ledger page",
      description: "A page torn from the festival committee's ledger.",
    },
  ],
  discoveredClues: [
    {
      clueId: "clue_bell_crack",
      title: "A hairline crack",
      description: "The bell's rim shows a fresh crack.",
      firstContributor: PLAYER,
      contributors: [PLAYER],
    },
  ],
  activePromises: [
    {
      promiseId: "promise_1",
      npc: { id: "npc_corin", actorType: "npc", displayName: "Corin Hale" },
      kind: "keep_secret",
      summary: "Corin asked you not to mention the crack.",
      subject: { kind: "claim", claimId: "claim_1", text: "The bell has a crack." },
      acceptedAt: "2026-08-10T12:00:00.000Z",
    },
  ],
  caseBoard: [
    {
      entryId: "entry_1",
      contributedBy: PLAYER,
      createdAt: "2026-08-10T12:00:00.000Z",
      entryKind: "verified_evidence",
      verificationStatus: "verified_physical",
      clue: {
        clueId: "clue_bell_crack",
        title: "A hairline crack",
        description: "The bell's rim shows a fresh crack.",
      },
    },
  ],
  caseBoardContradictions: [],
  caseAttempts: [],
  resolution: {
    state: "investigating",
    accusationGate: { state: "locked", message: "You need more evidence first." },
  },
  ambientTransition: null,
};

const FULLY_EMPTY_PLAYER_VIEW: PlayerView = {
  viewVersion: "B".repeat(43),
  town: {
    id: "town_2",
    mysteryTitle: "The Bell That Would Not Ring",
    contentVersion: "bell-mystery-v1",
    tagline: "A quiet town remembers what it tried to forget.",
    status: "active",
  },
  player: {
    id: "player_lin",
    displayName: "Lin Okafor",
    visit: { status: "away" },
  },
  map: [],
  currentLocation: null,
  encounters: [],
  inventory: [],
  discoveredClues: [],
  activePromises: [],
  caseBoard: [],
  caseBoardContradictions: [],
  caseAttempts: [],
  resolution: {
    state: "investigating",
    accusationGate: { state: "locked", message: "You need more evidence first." },
  },
  ambientTransition: null,
};

describe("PlayerView conformance", () => {
  it("accepts a fully populated fixture", () => {
    expect(PlayerViewSchema.parse(FULLY_POPULATED_PLAYER_VIEW)).toStrictEqual(
      FULLY_POPULATED_PLAYER_VIEW,
    );
  });

  it("accepts a fully empty but valid fixture", () => {
    expect(PlayerViewSchema.parse(FULLY_EMPTY_PLAYER_VIEW)).toStrictEqual(
      FULLY_EMPTY_PLAYER_VIEW,
    );
  });

  it("keeps the locked gate free of both unlock routes in its message", () => {
    const gate = AccusationGateSchema.parse(
      FULLY_EMPTY_PLAYER_VIEW.resolution.state === "investigating"
        ? FULLY_EMPTY_PLAYER_VIEW.resolution.accusationGate
        : undefined,
    );
    expect(gate.state).toBe("locked");
  });
});
