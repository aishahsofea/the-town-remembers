import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePlayerView } from "./playerView.js";

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function playerViewBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    viewVersion: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE",
    town: {
      id: "town-1",
      mysteryTitle: "The Missing Festival Bell",
      contentVersion: "bell-mystery-v1",
      tagline: "The bell is gone.",
      status: "active",
    },
    player: { id: "p1", displayName: "Aishah Sofea", visit: { status: "away" } },
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
      accusationGate: { state: "locked", message: "Locked." },
    },
    ambientTransition: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("usePlayerView", () => {
  it("fetches once on mount and reaches ready with the parsed view", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(playerViewBody(), { etag: '"v1"' }),
    );

    const { result } = renderHook(() => usePlayerView("town-1"));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.view?.player.displayName).toBe("Aishah Sofea");
  });

  it("sends If-None-Match on the second poll using the first response's ETag", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls: (string | undefined)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push(headers["if-none-match"]);
      return Promise.resolve(jsonResponse(playerViewBody(), { etag: '"v1"' }));
    });

    renderHook(() => usePlayerView("town-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe('"v1"');
  });

  it("keeps the same view object reference across a 304 — no React state replacement", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let responseIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      responseIndex += 1;
      if (responseIndex === 1) {
        return Promise.resolve(jsonResponse(playerViewBody(), { etag: '"v1"' }));
      }
      return Promise.resolve(new Response(null, { status: 304 }));
    });

    const { result } = renderHook(() => usePlayerView("town-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const firstView = result.current.view;
    expect(firstView).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.view).toBe(firstView);
  });

  it("reports unauthenticated on a 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "https://the-town-remembers/errors/invalid-session",
          status: 401,
          code: "INVALID_SESSION",
          title: "Invalid session",
          detail: "no session",
          requestId: "req_1",
          fieldErrors: [],
        }),
        { status: 401, headers: { "content-type": "application/problem+json" } },
      ),
    );

    const { result } = renderHook(() => usePlayerView("town-1"));
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
  });

  it("refresh() fetches immediately outside the regular cadence", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      fetchCount += 1;
      return Promise.resolve(jsonResponse(playerViewBody(), { etag: '"v1"' }));
    });

    const { result } = renderHook(() => usePlayerView("town-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(1);

    await act(async () => {
      result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(2);
  });
});
