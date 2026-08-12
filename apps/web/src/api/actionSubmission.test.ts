import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteJournalEntry,
  readJournalEntry,
  writeJournalEntry,
} from "../journal/db.js";
import { useActionSubmission } from "./actionSubmission.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const COMPLETED_TRAVEL = {
  actionId: "action-1",
  kind: "travel",
  status: "completed",
  outcome: "applied",
  result: { disposition: "arrived", locationId: "loc-1" },
};

function strictMode({ children }: { readonly children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteJournalEntry("town-1", "player-1");
});

describe("useActionSubmission", () => {
  it("writes the journal entry before the POST, and deletes it only after onSettled runs", async () => {
    const order: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/actions")) {
        order.push("post");
        return Promise.resolve(jsonResponse(COMPLETED_TRAVEL));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const onSettled = vi.fn(() => {
      order.push("onSettled");
      return Promise.resolve(true);
    });
    const { result } = renderHook(() =>
      useActionSubmission("town-1", "player-1", onSettled),
    );

    await act(async () => {
      await result.current.submit({ kind: "travel", destinationLocationId: "loc-1" });
    });

    expect(order).toStrictEqual(["post", "onSettled"]);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(await readJournalEntry("town-1", "player-1")).toBeUndefined();
    expect(result.current.lastResult).toStrictEqual(COMPLETED_TRAVEL);
  });

  it("coalesces same-tab double submission into one POST", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(COMPLETED_TRAVEL));
    const { result } = renderHook(
      () => useActionSubmission("town-1", "player-1", () => Promise.resolve(true)),
      { wrapper: strictMode },
    );
    const request = { kind: "travel", destinationLocationId: "loc-1" } as const;

    await act(async () => {
      await Promise.all([
        result.current.submit(request),
        result.current.submit(request),
      ]);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resumes a journaled action left behind by a reload, polling the existing actionId rather than re-posting", async () => {
    await writeJournalEntry({
      townId: "town-1",
      playerId: "player-1",
      idempotencyKey: "11111111-1111-1111-1111-111111111111",
      requestBody: { kind: "travel", destinationLocationId: "loc-1" },
      createdAt: new Date().toISOString(),
      actionId: "action-1",
      pollAfterMs: 2_000,
      takeoverPostSent: false,
    });

    const postCalls: string[] = [];
    const pollCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (init?.method === "POST" && url.includes("/actions")) {
        postCalls.push(url);
        throw new Error("should not re-POST when an actionId is already journaled");
      }
      if (url.includes("/actions/action-1")) {
        pollCalls.push(url);
        return Promise.resolve(jsonResponse(COMPLETED_TRAVEL));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const onSettled = vi.fn(() => Promise.resolve(true));
    renderHook(() => useActionSubmission("town-1", "player-1", onSettled));

    await waitFor(() => expect(pollCalls).toHaveLength(1));
    expect(postCalls).toHaveLength(0);
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  it("disables further submission while a broadcast from another tab reports a pending action", async () => {
    const { result } = renderHook(() =>
      useActionSubmission("town-1", "player-1", () => Promise.resolve(true)),
    );
    expect(result.current.readOnlyPending).toBe(false);

    const { openJournalChannel } = await import("../journal/channel.js");
    const otherTab = openJournalChannel();

    act(() => {
      otherTab?.post({ type: "pending", townId: "town-1", playerId: "player-1" });
    });

    await waitFor(() => expect(result.current.readOnlyPending).toBe(true));

    const fetch = vi.spyOn(globalThis, "fetch");
    await act(async () => {
      await result.current.submit({ kind: "travel", destinationLocationId: "loc-1" });
    });
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      otherTab?.post({ type: "cleared", townId: "town-1", playerId: "player-1" });
    });
    await waitFor(() => expect(result.current.readOnlyPending).toBe(false));

    otherTab?.close();
  });

  it("retains the journal and pending state until a failed player-view refresh succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(COMPLETED_TRAVEL));
    const onSettled = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() =>
      useActionSubmission("town-1", "player-1", onSettled),
    );

    await act(async () => {
      await result.current.submit({ kind: "travel", destinationLocationId: "loc-1" });
    });
    await waitFor(() => expect(result.current.refreshPending).toBe(true));
    expect(await readJournalEntry("town-1", "player-1")).toBeDefined();

    act(() => result.current.retrySafely());
    await waitFor(() => expect(result.current.refreshPending).toBe(false));
    expect(await readJournalEntry("town-1", "player-1")).toBeUndefined();
  });
});
