import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";
import { Router } from "../routing/router.js";
import { Shell } from "./Shell.js";

const ACTIVE_PROMISE = {
  promiseId: "promise_1",
  npc: { id: "npc_mara", actorType: "npc", displayName: "Mara Venn" },
  kind: "keep_secret",
  summary: "Keep Mara's account of the late closing to yourself.",
  subject: { kind: "claim", claimId: "claim_1", text: "Mara closed the inn late." },
  acceptedAt: "2026-08-11T00:00:00.000Z",
};

function playerViewBody(
  overrides: { visitStatus?: "active" | "away"; activePromises?: unknown[] } = {},
): unknown {
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
      visit:
        (overrides.visitStatus ?? "active") === "away"
          ? { status: "away" }
          : { status: "active", visitId: "v1", locationId: "loc-square" },
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
    currentLocation:
      (overrides.visitStatus ?? "active") === "away"
        ? null
        : { id: "loc-square", displayName: "Festival Square", inspectables: [] },
    encounters: [],
    inventory: [],
    discoveredClues: [],
    activePromises: overrides.activePromises ?? [],
    caseBoard: [],
    caseBoardContradictions: [],
    caseAttempts: [],
    resolution: {
      state: "investigating",
      accusationGate: { state: "locked", message: "Locked." },
    },
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
        return travelHeld.then(() =>
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

describe("Shell — leave confirmation sheet (P3-16 acceptance 1)", () => {
  it("lists carried-forward promises and never submits until its own Leave town button is clicked", async () => {
    const postUrls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(
          jsonResponse(playerViewBody({ activePromises: [ACTIVE_PROMISE] })),
        );
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        postUrls.push(url);
        throw new Error(
          "must not submit before the sheet's own Leave town button is clicked",
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Shell match={{ name: "map", params: { townId: "town-1" } }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Leave town" }));

    const dialog = await screen.findByRole("dialog", { name: "End this visit?" });
    expect(dialog.textContent).toContain("Mara Venn");
    expect(dialog.textContent).toContain(
      "Keep Mara's account of the late closing to yourself.",
    );
    expect(postUrls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Stay in town" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "End this visit?" })).toBeNull();
    });
    expect(postUrls).toHaveLength(0);
  });

  it("shows the empty-state copy when the player has made no promises", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody({ activePromises: [] })));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Shell match={{ name: "map", params: { townId: "town-1" } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Leave town" }));

    const dialog = await screen.findByRole("dialog", { name: "End this visit?" });
    expect(dialog.textContent).toContain("You have made no active promises.");
  });
});

describe("Shell — away screen (P3-16 acceptance 2)", () => {
  it("routes an away visit straight to the away screen with an immediately-enabled return control", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(
          jsonResponse(
            playerViewBody({ visitStatus: "away", activePromises: [ACTIVE_PROMISE] }),
          ),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Shell match={{ name: "betweenVisits", params: { townId: "town-1" } }} />);

    await screen.findByRole("heading", { name: "Your visit is complete." });
    const returnButton = screen.getByRole("button", {
      name: "Return to Festival Square",
    });
    expect((returnButton as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Shell — no time-passes language (P3-16 acceptance 3)", () => {
  it("shows no waiting/processing/gossip/retry copy on the away screen", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody({ visitStatus: "away" })));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Shell match={{ name: "betweenVisits", params: { townId: "town-1" } }} />);
    await screen.findByRole("heading", { name: "Your visit is complete." });

    const text = document.body.textContent.toLowerCase();
    for (const forbidden of [
      "waiting",
      "processing",
      "gossip",
      "retry",
      "time passes",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe("Shell — return to Festival Square (P3-16 acceptance 4)", () => {
  it("only shows the map after start_visit completes and the player-view refresh lands", async () => {
    let resolveStartVisit: (() => void) | undefined;
    const startVisitHeld = new Promise<void>((resolve) => {
      resolveStartVisit = resolve;
    });
    let playerViewCalls = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/player-view")) {
        playerViewCalls += 1;
        return Promise.resolve(
          jsonResponse(
            playerViewBody({ visitStatus: playerViewCalls === 1 ? "away" : "active" }),
          ),
        );
      }
      if (init?.method === "POST" && url.includes("/actions")) {
        return startVisitHeld.then(() =>
          jsonResponse({
            actionId: "action-1",
            kind: "start_visit",
            status: "completed",
            outcome: "applied",
            result: { disposition: "started", visitId: "v2", locationId: "loc-square" },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    navigate(buildWebPath("betweenVisits", { townId: "town-1" }), { replace: true });
    render(
      <Router
        renderRoute={(match) => <Shell match={match} />}
        renderNotFound={() => <p>Not found</p>}
      />,
    );

    const returnButton = await screen.findByRole("button", {
      name: "Return to Festival Square",
    });
    fireEvent.click(returnButton);

    // The POST is held open: still the away screen, control disabled — no
    // optimistic jump to the map before the action actually completes.
    await waitFor(() => {
      expect((returnButton as HTMLButtonElement).disabled).toBe(true);
    });
    expect(
      screen.getByRole("heading", { name: "Your visit is complete." }),
    ).toBeTruthy();

    resolveStartVisit?.();
    await screen.findByRole("button", { name: "Travel" });
    expect(playerViewCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("Shell — Leave town disabled while pending (P3-16 acceptance 5)", () => {
  it("disables the header's Leave town control while any action is in flight", async () => {
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
        return travelHeld.then(() =>
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

    fireEvent.click(await screen.findByRole("button", { name: "Travel" }));

    const leaveButton = await screen.findByRole("button", { name: "Leave town" });
    await waitFor(() => {
      expect((leaveButton as HTMLButtonElement).disabled).toBe(true);
    });

    resolveTravel?.();
    await waitFor(() => {
      expect((leaveButton as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
