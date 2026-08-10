import {
  ROUTE_TEMPLATES,
  ProblemResponseSchema,
} from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { ROUTED_TEMPLATES, routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

/** Never queried: no test in this file exercises a route that reaches the pool. */
const UNUSED_POOL = {} as unknown as Pool;

const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

const CONFIG: RouterConfig = {
  buildId: "a1b2c3d",
  appOrigin: "http://localhost:5173",
  now: () => new Date("2026-08-02T00:00:00.000Z"),
  pool: UNUSED_POOL,
  securityConfig: SECURITY_CONFIG,
};

function fixtureRequest(method: string, path: string): HttpRequest {
  return { method, path, headers: new Map(), body: undefined, sourceIp: undefined };
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

describe("route registration", () => {
  it("registers every route template exactly once", () => {
    expect([...ROUTED_TEMPLATES].toSorted()).toStrictEqual(
      Object.values(ROUTE_TEMPLATES).toSorted(),
    );
  });
});

describe("matching and the no-405 rule", () => {
  it("resolves a trailing slash identically to the bare path", async () => {
    const bare = await routeRequest(
      fixtureRequest("GET", ROUTE_TEMPLATES.health),
      "req_1",
      CONFIG,
    );
    const trailing = await routeRequest(
      fixtureRequest("GET", `${ROUTE_TEMPLATES.health}/`),
      "req_1",
      CONFIG,
    );
    expect(trailing.response).toStrictEqual(bare.response);
  });

  it("treats a doubled slash as a distinct, unmatched path", async () => {
    const doubled = await routeRequest(
      fixtureRequest("GET", "/api/v1//health"),
      "req_1",
      CONFIG,
    );
    expect(doubled.response.status).toBe(404);
    expect(doubled.routeTemplate).toBe("unmatched");
  });

  it("answers a matched path with the wrong method identically to a truly unmatched path, never a 405", async () => {
    const wrongMethod = await routeRequest(
      fixtureRequest("POST", ROUTE_TEMPLATES.health),
      "req_1",
      CONFIG,
    );
    const unmatched = await routeRequest(
      fixtureRequest("GET", "/api/v1/does-not-exist"),
      "req_1",
      CONFIG,
    );
    expect(wrongMethod.response.status).toBe(404);
    expect(unmatched.response.status).toBe(404);
    expect(parseBody(wrongMethod.response.body)).toStrictEqual(
      parseBody(unmatched.response.body),
    );
  });

  const UNBUILT_ROUTES: ReadonlyArray<readonly [method: string, template: string]> = [
    ["GET", ROUTE_TEMPLATES.playerView],
    ["POST", ROUTE_TEMPLATES.actions],
    ["GET", ROUTE_TEMPLATES.actionStatus],
  ];

  it.each(UNBUILT_ROUTES)(
    "answers an unbuilt route (%s %s) the same as an unmatched path",
    async (method, template) => {
      const concretePath = template.replaceAll(/\{[^}]+\}/g, "id_1");

      const built = await routeRequest(
        fixtureRequest(method, concretePath),
        "req_1",
        CONFIG,
      );
      const unmatched = await routeRequest(
        fixtureRequest("GET", "/api/v1/does-not-exist"),
        "req_1",
        CONFIG,
      );

      expect(built.response.status).toBe(404);
      expect(parseBody(built.response.body)).toStrictEqual(
        parseBody(unmatched.response.body),
      );
    },
  );
});

describe("cache headers by route kind", () => {
  it("marks the health response no-store", async () => {
    const { response } = await routeRequest(
      fixtureRequest("GET", ROUTE_TEMPLATES.health),
      "req_1",
      CONFIG,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("marks an unbuilt player-view response private, no-cache with Vary: Cookie", async () => {
    const path = ROUTE_TEMPLATES.playerView.replace("{townId}", "town_1");
    const { response } = await routeRequest(
      fixtureRequest("GET", path),
      "req_1",
      CONFIG,
    );
    expect(response.headers["cache-control"]).toBe("private, no-cache");
    expect(response.headers["vary"]).toBe("Cookie");
  });

  it("marks an unbuilt action-status response no-store despite being a GET", async () => {
    const path = ROUTE_TEMPLATES.actionStatus
      .replace("{townId}", "town_1")
      .replace("{actionId}", "act_1");
    const { response } = await routeRequest(
      fixtureRequest("GET", path),
      "req_1",
      CONFIG,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

describe("problem body shape", () => {
  it("every fallback response validates against ProblemResponseSchema with the problem content type", async () => {
    const { response } = await routeRequest(
      fixtureRequest("GET", "/api/v1/does-not-exist"),
      "req_1",
      CONFIG,
    );
    expect(response.headers["content-type"]).toBe(
      "application/problem+json; charset=utf-8",
    );
    expect(ProblemResponseSchema.safeParse(parseBody(response.body)).success).toBe(
      true,
    );
  });
});

describe("the uniform failure boundary", () => {
  it("turns a thrown plain Error into an opaque 500 with no leaked detail", async () => {
    const leaky: RouterConfig = {
      ...CONFIG,
      now: () => {
        throw new Error("SELECT * FROM towns WHERE id = 'abc'");
      },
    };

    const { response } = await routeRequest(
      fixtureRequest("GET", ROUTE_TEMPLATES.health),
      "req_1",
      leaky,
    );

    expect(response.status).toBe(500);
    const serialized = response.body.toLowerCase();
    for (const marker of ["select", "towns", "abc", "at ", ".ts:"]) {
      expect(serialized).not.toContain(marker);
    }
    expect(ProblemResponseSchema.safeParse(parseBody(response.body)).success).toBe(
      true,
    );
  });
});
