import { describe, expect, it } from "vitest";

import { CompletedActionResponseSchema } from "@the-town-remembers/http-contracts";

import { buildDeniedResponse, buildSucceededResponse } from "./action-result.js";

describe("buildDeniedResponse", () => {
  it("validates against the real CompletedActionResponseSchema", () => {
    const response = buildDeniedResponse(
      "action-1",
      "start_visit",
      "TOWN_NOT_ACTIVE",
      "The town is not accepting visits right now.",
    );
    expect(() => CompletedActionResponseSchema.parse(response)).not.toThrow();
  });

  it("includes dialogue only when supplied", () => {
    const withoutDialogue = buildDeniedResponse(
      "a1",
      "ask",
      "NPC_NOT_PRESENT",
      "Not here.",
    );
    expect("dialogue" in withoutDialogue.result).toBe(false);

    const withDialogue = buildDeniedResponse(
      "a2",
      "ask",
      "NPC_NOT_PRESENT",
      "Not here.",
      {
        npcId: "npc-1",
        text: "I'm not here right now.",
        responseMode: "authored",
      },
    );
    expect(withDialogue.result.dialogue?.npcId).toBe("npc-1");
  });
});

describe("buildSucceededResponse", () => {
  it("validates an applied inspect result against the real schema", () => {
    const response = buildSucceededResponse("action-2", "inspect", "applied", {
      inspectableId: "empty_bell_frame",
      discovery: "new_to_town",
      clue: {
        clueId: "clue-1",
        title: "Bent Clapper Pin",
        description: "A freshly bent pin.",
        firstContributor: { id: "p1", actorType: "player", displayName: "Riley" },
        contributors: [{ id: "p1", actorType: "player", displayName: "Riley" }],
      },
    });
    expect(() => CompletedActionResponseSchema.parse(response)).not.toThrow();
  });

  it("validates a no_change travel result against the real schema", () => {
    const response = buildSucceededResponse("action-3", "travel", "no_change", {
      disposition: "already_there",
      locationId: "festival_square",
    });
    expect(() => CompletedActionResponseSchema.parse(response)).not.toThrow();
  });

  it("validates an applied resolve result against the real schema", () => {
    const response = buildSucceededResponse("action-4", "resolve", "applied", {
      disposition: "resolved",
      resolution: {
        state: "resolved",
        choice: "restore_bell_quietly",
        chosenBy: { id: "p1", actorType: "player", displayName: "Riley" },
        resolvedAt: "2026-01-01T00:00:00.000Z",
        epilogue: "The town moves on, quietly.",
      },
    });
    expect(() => CompletedActionResponseSchema.parse(response)).not.toThrow();
  });
});
