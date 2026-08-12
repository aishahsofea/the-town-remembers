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
      await result.current.refresh();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchCount).toBe(2);
  });

  it("retries an immediate refresh once after a rate-limit response", async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      fetchCount += 1;
      if (fetchCount !== 2) return Promise.resolve(jsonResponse(playerViewBody()));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: "https://the-town-remembers/errors/rate-limited",
            status: 429,
            code: "RATE_LIMITED",
            title: "Rate limited",
            detail: "Try again shortly.",
            requestId: "req_1",
            fieldErrors: [],
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/problem+json",
              "retry-after": "0",
            },
          },
        ),
      );
    });

    const { result } = renderHook(() => usePlayerView("town-1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let succeeded: boolean | undefined;
    await act(async () => {
      succeeded = await result.current.refresh();
    });
    expect(succeeded).toBe(true);
    expect(fetchCount).toBe(3);
  });

  it("does not let an older overlapping response replace a newer refresh", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      return call === 1
        ? first
        : Promise.resolve(
            jsonResponse(
              playerViewBody({
                player: {
                  id: "p1",
                  displayName: "Newest View",
                  visit: { status: "away" },
                },
              }),
              { etag: '"v2"' },
            ),
          );
    });

    const { result } = renderHook(() => usePlayerView("town-1"));
    await waitFor(() => expect(call).toBe(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.view?.player.displayName).toBe("Newest View");

    await act(async () => {
      resolveFirst?.(
        jsonResponse(
          playerViewBody({
            player: {
              id: "p1",
              displayName: "Stale View",
              visit: { status: "away" },
            },
          }),
          { etag: '"v1"' },
        ),
      );
      await Promise.resolve();
    });
    expect(result.current.view?.player.displayName).toBe("Newest View");
  });

  it("does not confirm a stale refresh when the newer overlapping request failed", async () => {
    let resolveStale: ((response: Response) => void) | undefined;
    const stale = new Promise<Response>((resolve) => {
      resolveStale = resolve;
    });
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve(jsonResponse(playerViewBody()));
      if (call === 2) return stale;
      return Promise.reject(new Error("offline"));
    });

    const { result } = renderHook(() => usePlayerView("town-1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let staleSucceeded: boolean | undefined;
    let newerSucceeded: boolean | undefined;
    await act(async () => {
      const staleRefresh = result.current.refresh().then((value) => {
        staleSucceeded = value;
      });
      newerSucceeded = await result.current.refresh();
      resolveStale?.(jsonResponse(playerViewBody()));
      await staleRefresh;
    });

    expect(newerSucceeded).toBe(false);
    expect(staleSucceeded).toBe(false);
  });
});
