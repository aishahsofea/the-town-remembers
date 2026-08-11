import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCapturedInviteTokenForTests,
  setCapturedInviteToken,
} from "../routing/inviteToken.js";
import { Join } from "./Join.js";

const PREVIEW = {
  townId: "town-1",
  mysteryTitle: "The Missing Festival Bell",
  tagline: "The bell is gone.",
  description: "Visit a shared town.",
  townStatus: "active" as const,
  joinMode: "play" as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function requestedUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** The minimum `PlayerViewSchema`-valid body — every field is required. */
function playerViewBody(displayName: string): unknown {
  return {
    viewVersion: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE",
    town: {
      id: "town-1",
      mysteryTitle: "The Missing Festival Bell",
      contentVersion: "bell-mystery-v1",
      tagline: "The bell is gone.",
      status: "active",
    },
    player: { id: "p1", displayName, visit: { status: "away" } },
    map: [],
    currentLocation: null,
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

function problemResponse(status: number, code: string, detail: string): Response {
  return jsonResponse(
    {
      type: `https://the-town-remembers/errors/${code.toLowerCase()}`,
      status,
      code,
      title: code,
      detail,
      requestId: "req_1",
      fieldErrors: [],
    },
    status,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  clearCapturedInviteTokenForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.pushState(null, "", "/join");
});

describe("Join — no captured token", () => {
  it("shows the reopen message and issues no preview request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<Join />);

    expect(await screen.findByText("Reopen the invite link to continue.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Join — existing session", () => {
  it("shows Return as {displayName} and issues no join POST", async () => {
    setCapturedInviteToken("token-1");
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = requestedUrl(input);
      calls.push(url);
      if (url.includes("/invites/")) return Promise.resolve(jsonResponse(PREVIEW));
      if (url.includes("/player-view")) {
        return Promise.resolve(jsonResponse(playerViewBody("Aishah Sofea")));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Join />);

    expect(await screen.findByText("Return as Aishah Sofea")).toBeTruthy();
    expect(calls.some((call) => call.includes("/join") && !call.includes("player-view"))).toBe(
      false,
    );
  });
});

describe("Join — closed town", () => {
  it("shows no name field", async () => {
    setCapturedInviteToken("token-1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ...PREVIEW, joinMode: "closed", townStatus: "resolved" }),
    );

    render(<Join />);

    await screen.findByText("Closed");
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });
});

describe("Join — first-time join", () => {
  function stubFreshSession(): void {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = requestedUrl(input);
      if (url.includes("/invites/") && !url.includes("/join")) {
        return Promise.resolve(jsonResponse(PREVIEW));
      }
      if (url.includes("/player-view")) {
        return Promise.resolve(problemResponse(401, "INVALID_SESSION", "no session"));
      }
      throw new Error(`unexpected fetch in this test: ${url}`);
    });
  }

  it("keeps the field populated, selects it, and shows conflict copy on a server-side name conflict, without an automatic second POST", async () => {
    setCapturedInviteToken("token-1");
    let joinPostCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = requestedUrl(input);
      if (url.includes("/invites/") && !url.includes("/join")) {
        return Promise.resolve(jsonResponse(PREVIEW));
      }
      if (url.includes("/player-view")) {
        return Promise.resolve(problemResponse(401, "INVALID_SESSION", "no session"));
      }
      if (url.endsWith("/join")) {
        joinPostCount += 1;
        return Promise.resolve(
          problemResponse(409, "DISPLAY_NAME_TAKEN", "That name is already in use."),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Join />);

    const input = await screen.findByLabelText<HTMLInputElement>("Your name");
    fireEvent.change(input, { target: { value: "Aishah Sofea" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter the town" }));

    await screen.findByText("That name is already in use in this town.");
    expect(input.value).toBe("Aishah Sofea");
    expect(joinPostCount).toBe(1);

    // No automatic retry — the count stays at one even after settling.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(joinPostCount).toBe(1);
  });

  it("never renders the join secret anywhere in the DOM", async () => {
    setCapturedInviteToken("token-1");
    stubFreshSession();

    render(<Join />);
    await screen.findByLabelText("Your name");

    const stored = sessionStorage.getItem("ttr.join-session");
    const secret = stored ? (JSON.parse(stored) as { joinAttemptSecret: string }).joinAttemptSecret : undefined;
    // The session is only created at submit time; nothing is stored yet.
    expect(secret).toBeUndefined();
    expect(document.documentElement.outerHTML).not.toContain("join-attempt-secret");
  });

  it("navigates to the map on a successful join and clears the join session", async () => {
    setCapturedInviteToken("token-1");
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = requestedUrl(input);
      if (url.includes("/invites/") && !url.includes("/join")) {
        return Promise.resolve(jsonResponse(PREVIEW));
      }
      if (url.includes("/player-view")) {
        return Promise.resolve(problemResponse(401, "INVALID_SESSION", "no session"));
      }
      if (url.endsWith("/join")) {
        return Promise.resolve(
          jsonResponse({
            townId: "town-1",
            townStatus: "active",
            player: { id: "p1", displayName: "Aishah Sofea" },
            initialVisit: { visitId: "v1", locationId: "loc1" },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<Join />);
    const input = await screen.findByLabelText("Your name");
    fireEvent.change(input, { target: { value: "Aishah Sofea" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter the town" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/town/town-1/map");
    });
    expect(sessionStorage.getItem("ttr.join-session")).toBeNull();
  });
});
