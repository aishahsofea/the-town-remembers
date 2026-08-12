/**
 * CSRF origin enforcement on every state-changing POST (`P3-17` acceptance
 * 5). `requireExactOrigin` (`http/negotiate.ts`) is the first thing each
 * handler calls — before judge-code verification, before join-secret
 * verification, before session authentication — so a foreign or missing
 * `Origin` never reaches, and never has a side effect through, any of those.
 * The fixture pool below is `{}`: any of these three routes reaching a real
 * pool call would throw a type error, which is itself proof the origin check
 * short-circuited before the route's own persistence work started.
 */

import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { routeRequest, type RouterConfig } from "../http/router.js";
import type { HttpRequest } from "../http/types.js";

const UNUSED_POOL = {} as unknown as Pool;

const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

const APP_ORIGIN = "http://localhost:5173";
const FOREIGN_ORIGIN = "https://attacker.example";

const CONFIG: RouterConfig = {
  buildId: "a1b2c3d",
  appOrigin: APP_ORIGIN,
  now: () => new Date("2026-08-02T00:00:00.000Z"),
  pool: UNUSED_POOL,
  securityConfig: SECURITY_CONFIG,
};

function postRequest(path: string, origin: string | undefined): HttpRequest {
  const headers = new Map<string, string>();
  if (origin !== undefined) headers.set("origin", origin);
  return { method: "POST", path, headers, body: "{}", sourceIp: undefined };
}

const STATE_CHANGING_POST_ROUTES = {
  "town creation": "/api/v1/towns",
  "invite join": "/api/v1/invites/some-token/join",
  "submit action": "/api/v1/towns/town_1/actions",
} as const;

describe("CSRF: state-changing POSTs reject a foreign or missing Origin (P3-17 acceptance 5)", () => {
  for (const [label, path] of Object.entries(STATE_CHANGING_POST_ROUTES)) {
    it(`rejects ${label} from a foreign Origin with 403 ORIGIN_REJECTED`, async () => {
      const { response } = await routeRequest(
        postRequest(path, FOREIGN_ORIGIN),
        "req_1",
        CONFIG,
      );
      expect(response.status).toBe(403);
      const body = JSON.parse(response.body) as { code: string };
      expect(body.code).toBe("ORIGIN_REJECTED");
    });

    it(`rejects ${label} with no Origin header with 403 ORIGIN_REJECTED`, async () => {
      const { response } = await routeRequest(
        postRequest(path, undefined),
        "req_1",
        CONFIG,
      );
      expect(response.status).toBe(403);
      const body = JSON.parse(response.body) as { code: string };
      expect(body.code).toBe("ORIGIN_REJECTED");
    });
  }

  it("accepts the exact configured app Origin as far as the origin check itself is concerned", async () => {
    // Town creation's next check is judge-code auth, which this request has
    // none of — a 401 (not 403 ORIGIN_REJECTED) is proof the origin check
    // itself passed and rejection moved on to the next boundary.
    const { response } = await routeRequest(
      postRequest("/api/v1/towns", APP_ORIGIN),
      "req_1",
      CONFIG,
    );
    expect(response.status).not.toBe(403);
  });
});
