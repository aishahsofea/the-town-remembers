import { ROUTE_TEMPLATES } from "@the-town-remembers/http-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchHealth } from "./useHealth.js";

const VALID_BODY = {
  status: "ok",
  build: "api-build",
  time: "2026-08-02T00:00:00.000Z",
};

type FetchImplementation = (input: RequestInfo | URL) => Promise<Response>;

function stubFetch(implementation: FetchImplementation): void {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

function requestedUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHealth", () => {
  it("requests the relative versioned path", async () => {
    const calls: string[] = [];
    stubFetch((input) => {
      calls.push(requestedUrl(input));
      return Promise.resolve(new Response(JSON.stringify(VALID_BODY), { status: 200 }));
    });

    await fetchHealth();
    expect(calls).toStrictEqual([ROUTE_TEMPLATES.health]);
    expect(calls[0]?.startsWith("/api/v1/")).toBe(true);
    expect(calls[0]).not.toContain("://");
  });

  it("reports healthy for a contract-valid body", async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify(VALID_BODY), { status: 200 })),
    );

    await expect(fetchHealth()).resolves.toStrictEqual({
      status: "healthy",
      health: VALID_BODY,
    });
  });

  it("treats a contract-invalid body as unavailable rather than rendering it", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", database: "ok" }), { status: 200 }),
      ),
    );

    await expect(fetchHealth()).resolves.toStrictEqual({ status: "unavailable" });
  });

  it("treats a failure status as unavailable", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 503 })));

    await expect(fetchHealth()).resolves.toStrictEqual({ status: "unavailable" });
  });

  it("swallows a transport error instead of surfacing its message", async () => {
    stubFetch(() => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5174")));

    await expect(fetchHealth()).resolves.toStrictEqual({ status: "unavailable" });
  });
});
