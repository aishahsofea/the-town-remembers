import {
  HealthResponseSchema,
  PROBLEM_CODES,
  ProblemResponseSchema,
  ROUTE_TEMPLATES,
} from "@the-town-remembers/http-contracts";
import { loadGameConfig } from "@the-town-remembers/runtime-config/game";
import { loadSecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  FORBIDDEN_LOG_PROPERTIES,
  SENSITIVE_TEST_MARKERS,
  captureStdout,
  findSensitiveMarkers,
} from "@the-town-remembers/test-support";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  IMPLEMENTED_ROUTE_TEMPLATES,
  handleRequest,
  type RouterContext,
} from "./router.js";
import type { HttpRequest, HttpResponse } from "./types.js";

/** Never queried: every route this file drives fails before reaching the pool. */
const UNUSED_POOL = {} as unknown as Pool;

const context: RouterContext = {
  config: loadGameConfig({ TTR_ENV: "local", TTR_BUILD_ID: "a1b2c3d" }),
  securityConfig: loadSecurityConfig({
    TTR_JUDGE_CODE: "test-judge-code-not-real",
    TTR_INVITE_SIGNING_KEYS: `v1:${"A".repeat(43)}`,
    TTR_SESSION_TOKEN_PEPPER: "B".repeat(43),
    TTR_IP_HASH_SECRET: "C".repeat(43),
  }),
  pool: UNUSED_POOL,
  now: () => new Date("2026-08-02T00:00:00.000Z"),
  monotonicMs: () => 0,
};

function fixtureRequest(input: {
  readonly method: string;
  readonly path: string;
}): HttpRequest {
  return {
    method: input.method,
    path: input.path,
    headers: new Map(),
    body: undefined,
    sourceIp: undefined,
  };
}

async function request(method: string, path: string): Promise<HttpResponse> {
  let response: HttpResponse | undefined;
  await captureStdout(async () => {
    response = (await handleRequest(fixtureRequest({ method, path }), context))
      .response;
  });
  return response!;
}

function parseBody(response: HttpResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("health route", () => {
  it("returns liveness, build identity, and server time only", async () => {
    const response = await request("GET", ROUTE_TEMPLATES.health);
    expect(response.status).toBe(200);

    const body = parseBody(response);
    expect(Object.keys(body).toSorted()).toStrictEqual(["build", "status", "time"]);
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toStrictEqual({
      status: "ok",
      build: "a1b2c3d",
      time: "2026-08-02T00:00:00.000Z",
    });
  });

  it("claims no dependency readiness anywhere in the body", async () => {
    const serialized = (
      await request("GET", ROUTE_TEMPLATES.health)
    ).body.toLowerCase();
    for (const dependency of [
      "database",
      "cockroach",
      "bedrock",
      "sqs",
      "queue",
      "secret",
      "dependencies",
      "titan",
    ]) {
      expect(serialized).not.toContain(dependency);
    }
  });

  it("sends the accepted transport headers", async () => {
    const response = await request("GET", ROUTE_TEMPLATES.health);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("normalizes a trailing slash rather than creating a second route", async () => {
    expect((await request("GET", `${ROUTE_TEMPLATES.health}/`)).status).toBe(200);
  });

  it("serves all seven route templates", () => {
    expect([...IMPLEMENTED_ROUTE_TEMPLATES].toSorted()).toStrictEqual(
      Object.values(ROUTE_TEMPLATES).toSorted(),
    );
  });
});

describe("unimplemented routes", () => {
  it.each([
    ["GET", ROUTE_TEMPLATES.towns],
    ["GET", "/api/v1/towns/town_1/player-view"],
    ["GET", "/health"],
    ["GET", "/"],
    ["POST", ROUTE_TEMPLATES.health],
    ["DELETE", ROUTE_TEMPLATES.health],
  ])("answers %s %s with the same problem body", async (method, path) => {
    const response = await request(method, path);
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toBe(
      "application/problem+json; charset=utf-8",
    );

    const body = parseBody(response);
    expect(ProblemResponseSchema.safeParse(body).success).toBe(true);
    expect(body["code"]).toBe(PROBLEM_CODES.resourceNotFound);
  });

  it("never reveals which unimplemented path exists", async () => {
    const known = parseBody(await request("GET", ROUTE_TEMPLATES.towns));
    const unknown = parseBody(await request("GET", "/api/v1/does-not-exist"));
    expect({ ...known, requestId: "" }).toStrictEqual({ ...unknown, requestId: "" });
  });

  it("carries no stack trace, SQL, or hidden identifier", async () => {
    const body = (await request("GET", "/api/v1/towns/town_1")).body.toLowerCase();
    for (const marker of ["stack", "select ", "at handler", "sqlstate", "postgres"]) {
      expect(body).not.toContain(marker);
    }
  });
});

describe("request identity", () => {
  it("sends an opaque identifier on every response", async () => {
    const first = await request("GET", ROUTE_TEMPLATES.health);
    const second = await request("GET", "/api/v1/missing");
    expect(first.headers["x-request-id"]).toMatch(/^req_[A-Za-z0-9_-]+$/);
    expect(second.headers["x-request-id"]).toMatch(/^req_[A-Za-z0-9_-]+$/);
    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
  });

  it("matches the identifier in the problem body", async () => {
    const response = await request("GET", "/api/v1/missing");
    expect(parseBody(response)["requestId"]).toBe(response.headers["x-request-id"]);
  });
});

describe("safe logging", () => {
  it("emits one JSON event per request with only safe fields", async () => {
    const captured = await captureStdout(async () => {
      await handleRequest(
        fixtureRequest({ method: "GET", path: ROUTE_TEMPLATES.health }),
        context,
      );
    });

    expect(captured.unparsedLines).toStrictEqual([]);
    expect(captured.events).toHaveLength(1);

    const event = captured.events[0]!;
    expect(Object.keys(event).toSorted()).toStrictEqual([
      "build",
      "durationMs",
      "environment",
      "event",
      "method",
      "requestId",
      "routeTemplate",
      "status",
    ]);
    expect(event["routeTemplate"]).toBe(ROUTE_TEMPLATES.health);
    expect(event["status"]).toBe(200);
  });

  it("logs the registered route template, never the literal path it matched", async () => {
    const captured = await captureStdout(async () => {
      await handleRequest(
        fixtureRequest({
          method: "GET",
          path: `/api/v1/invites/${SENSITIVE_TEST_MARKERS.inviteToken}`,
        }),
        context,
      );
    });

    expect(captured.events[0]?.["routeTemplate"]).toBe(ROUTE_TEMPLATES.invitePreview);
    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });

  it("logs the unmatched placeholder for a path with no registered shape", async () => {
    const captured = await captureStdout(async () => {
      await handleRequest(
        fixtureRequest({ method: "GET", path: "/api/v1/x" }),
        context,
      );
    });

    expect(captured.events[0]?.["routeTemplate"]).toBe("unmatched");
  });

  it.each(Object.entries(ROUTE_TEMPLATES))(
    "logs a routeTemplate that is a member of ROUTE_TEMPLATES for %s",
    async (_name, template) => {
      const concretePath = template.replaceAll(/\{[^}]+\}/g, "id_1");
      const captured = await captureStdout(async () => {
        await handleRequest(
          fixtureRequest({ method: "GET", path: concretePath }),
          context,
        );
      });

      expect(captured.unparsedLines).toStrictEqual([]);
      expect(Object.values(ROUTE_TEMPLATES)).toContain(
        captured.events[0]?.["routeTemplate"],
      );
    },
  );

  it("carries no property that could hold raw request material", async () => {
    const captured = await captureStdout(async () => {
      await handleRequest(
        fixtureRequest({ method: "GET", path: ROUTE_TEMPLATES.health }),
        context,
      );
    });

    for (const property of FORBIDDEN_LOG_PROPERTIES) {
      if (property === "event") continue;
      expect(captured.events[0]).not.toHaveProperty(property);
    }
  });

  it("folds an unrecognized verb into one label", async () => {
    const captured = await captureStdout(async () => {
      await handleRequest(
        fixtureRequest({
          method: `PROPFIND-${SENSITIVE_TEST_MARKERS.queryValue}`,
          path: "/api/v1/x",
        }),
        context,
      );
    });

    expect(captured.events[0]?.["method"]).toBe("OTHER");
    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });
});
