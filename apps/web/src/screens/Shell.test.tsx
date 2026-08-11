import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Shell } from "./Shell.js";

function playerViewBody(): unknown {
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
    map: [
      {
        id: "loc-square",
        displayName: "Festival Square",
        description: "Bunting hangs over an empty bell frame.",
        sceneKey: "bell-mystery-v1/scenes/festival-square",
        mapOrder: 0,
        access: { state: "open" },
      },
      {
        id: "loc-inn",
        displayName: "The Lantern Inn",
        description: "A warm public room.",
        sceneKey: "bell-mystery-v1/scenes/lantern-inn",
        mapOrder: 1,
        access: { state: "open" },
      },
    ],
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
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Shell — no optimistic state (P3-14 acceptance 3)", () => {
  it("keeps showing the old location and disables every mutation control while a travel POST is held open", async () => {
    let resolveTravel: (() => void) | undefined;
    const travelHeld = new Promise<void>((resolve) => {
      resolveTravel = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody()));
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        return travelHeld.then(
          () =>
            jsonResponse({
              actionId: "action-1",
              kind: "travel",
              status: "completed",
              outcome: "applied",
              result: { disposition: "arrived", locationId: "loc-inn" },
            }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Shell match={{ name: "map", params: { townId: "town-1" } }} />);

    const travelButton = await screen.findByRole("button", { name: "Travel" });
    fireEvent.click(travelButton);

    // The POST is still pending: the map must still show the player at the
    // old location, and the mutation control must be disabled — never an
    // optimistic jump to the destination.
    await waitFor(() => {
      expect((travelButton as HTMLButtonElement).disabled).toBe(true);
    });
    expect(screen.getByText("Festival Square")).toBeTruthy();
    expect(screen.getAllByText("You are here")).toHaveLength(1);

    resolveTravel?.();
    await waitFor(() => {
      const button = screen.queryByRole("button", { name: "Travel" });
      expect(button && (button as HTMLButtonElement).disabled).not.toBe(true);
    });
  });
});
