import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCapturedInviteToken } from "../routing/inviteToken.js";
import { JoinBootstrap } from "./JoinBootstrap.js";

afterEach(() => {
  cleanup();
  window.history.pushState(null, "", "/");
});

describe("JoinBootstrap", () => {
  it("replaces the URL with the tokenless /join before Join's own preview fetch fires", () => {
    window.history.pushState(null, "", "/join/secret-token-123");

    // Testing-library's render() flushes effects synchronously (unlike a
    // real browser), so "not called yet at the moment render() returns" is
    // not a meaningful check here — the real ordering guarantee (`P3-13`
    // acceptance 1) is proved against real network timing by the Playwright
    // spec. What a unit test *can* still prove is relative order: the
    // component-body replaceState always precedes the effect-driven fetch,
    // regardless of how eagerly either runs.
    const order: string[] = [];
    const originalReplaceState = window.history.replaceState.bind(window.history);
    const replaceStateSpy = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation((data: unknown, unused: string, url?: string | URL | null) => {
        order.push("replaceState");
        originalReplaceState(data, unused, url);
      });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      order.push("fetch");
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    render(<JoinBootstrap inviteToken="secret-token-123" />);

    expect(window.location.pathname).toBe("/join");
    expect(order).toStrictEqual(["replaceState", "fetch"]);
    replaceStateSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("captures the token into page memory before replacing the URL", () => {
    window.history.pushState(null, "", "/join/another-token");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    render(<JoinBootstrap inviteToken="another-token" />);

    expect(getCapturedInviteToken()).toBe("another-token");
    vi.restoreAllMocks();
  });

  it("is idempotent when the URL is already /join (no-op replaceState)", () => {
    window.history.pushState(null, "", "/join");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    expect(() => render(<JoinBootstrap inviteToken="idempotent-token" />)).not.toThrow();
    expect(window.location.pathname).toBe("/join");
    vi.restoreAllMocks();
  });
});
