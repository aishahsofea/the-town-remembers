import { afterEach, describe, expect, it, vi } from "vitest";

import { apiRequest, ApiError, buildPath, NetworkError } from "./client.js";

function stubFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

const PROBLEM_BODY = {
  type: "https://the-town-remembers/errors/rate-limited",
  status: 429,
  code: "RATE_LIMITED",
  title: "Rate limit exceeded",
  detail: "Too many requests. Try again later.",
  requestId: "req_1",
  fieldErrors: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildPath", () => {
  it("fills every named param", () => {
    expect(
      buildPath("/api/v1/towns/{townId}/actions/{actionId}", {
        townId: "t1",
        actionId: "a1",
      }),
    ).toBe("/api/v1/towns/t1/actions/a1");
  });

  it("percent-encodes each param value", () => {
    expect(buildPath("/api/v1/invites/{inviteToken}", { inviteToken: "a b/c" })).toBe(
      "/api/v1/invites/a%20b%2Fc",
    );
  });
});

describe("apiRequest", () => {
  it("returns the parsed JSON body for a 2xx response", async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const result = await apiRequest<{ ok: boolean }>("/api/v1/health");
    expect(result.status).toBe(200);
    expect(result.body).toStrictEqual({ ok: true });
  });

  it("returns an undefined body for a 304", async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 304 })));
    const result = await apiRequest("/api/v1/towns/t1/player-view");
    expect(result.status).toBe(304);
    expect(result.body).toBeUndefined();
  });

  it("throws ApiError carrying the parsed problem body for a non-2xx response", async () => {
    stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify(PROBLEM_BODY), { status: 429 })),
    );
    await expect(apiRequest("/api/v1/towns")).rejects.toMatchObject({
      status: 429,
      problem: PROBLEM_BODY,
    });
  });

  it("throws NetworkError, discarding the underlying message, on a transport failure", async () => {
    stubFetch(() => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5174")));
    await expect(apiRequest("/api/v1/health")).rejects.toBeInstanceOf(NetworkError);
  });

  it("sends a JSON body and content-type only when a body is given", async () => {
    let capturedInit: RequestInit | undefined;
    stubFetch((_input, init) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });

    await apiRequest("/api/v1/towns", { method: "POST", body: { a: 1 } });
    expect(capturedInit?.body).toBe(JSON.stringify({ a: 1 }));
    expect((capturedInit?.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
  });

  it("falls back to an opaque internal-error ApiError when a non-2xx body fails to parse as a problem", async () => {
    stubFetch(() => Promise.resolve(new Response("not json", { status: 500 })));
    const error: unknown = await apiRequest("/api/v1/health").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("INTERNAL_ERROR");
  });
});
