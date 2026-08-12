import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HEADER_ALLOWLIST } from "@the-town-remembers/game-server";
import { ROUTE_TEMPLATES } from "@the-town-remembers/http-contracts";
import { loadGameConfig } from "@the-town-remembers/runtime-config/game";
import { loadSecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  FORBIDDEN_LOG_PROPERTIES,
  SENSITIVE_TEST_MARKERS,
  captureStdout,
  findSensitiveMarkers,
} from "@the-town-remembers/test-support";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RouterContext } from "./http/router.js";
import { startLocalServer } from "./local-server.js";

/** Never queried: every route this file drives fails before reaching the pool. */
const UNUSED_POOL = {} as unknown as Pool;

const context: RouterContext = {
  config: loadGameConfig({ TTR_ENV: "local", TTR_BUILD_ID: "local-test" }),
  securityConfig: loadSecurityConfig({
    TTR_JUDGE_CODE: "test-judge-code-not-real",
    TTR_INVITE_SIGNING_KEYS: `v1:${"A".repeat(43)}`,
    TTR_SESSION_TOKEN_PEPPER: "B".repeat(43),
    TTR_IP_HASH_SECRET: "C".repeat(43),
  }),
  pool: UNUSED_POOL,
  now: () => new Date("2026-08-02T00:00:00.000Z"),
  monotonicMs: () => performance.now(),
};

let baseUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const server = await startLocalServer({ port: 0, context });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  close = async () =>
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
});

afterAll(async () => {
  await close();
});

describe("local HTTP adapter", () => {
  it("serves the same health body over a real socket", async () => {
    const response = await fetch(`${baseUrl}${ROUTE_TEMPLATES.health}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toMatch(/^req_/);
    expect(await response.json()).toStrictEqual({
      status: "ok",
      build: "local-test",
      time: "2026-08-02T00:00:00.000Z",
    });
  });

  it("answers an unimplemented route with problem+json", async () => {
    const response = await fetch(`${baseUrl}/api/v1/towns`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json; charset=utf-8",
    );
  });

  it("strips the query string before routing and logging", async () => {
    const captured = await captureStdout(async () => {
      const response = await fetch(
        `${baseUrl}${ROUTE_TEMPLATES.health}?token=${SENSITIVE_TEST_MARKERS.queryValue}`,
      );
      expect(response.status).toBe(200);
    });

    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
    expect(captured.events.at(-1)?.["routeTemplate"]).toBe(ROUTE_TEMPLATES.health);
  });

  it("logs neither the cookie nor the authorization header it received", async () => {
    const captured = await captureStdout(async () => {
      const response = await fetch(`${baseUrl}/api/v1/towns`, {
        method: "POST",
        headers: {
          cookie: `town_1=${SENSITIVE_TEST_MARKERS.cookie}`,
          authorization: `Bearer ${SENSITIVE_TEST_MARKERS.authorization}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ note: SENSITIVE_TEST_MARKERS.requestBody }),
      });
      expect(response.status).toBe(403);
    });

    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });

  it("does not echo a client-supplied request identifier", async () => {
    const response = await fetch(`${baseUrl}${ROUTE_TEMPLATES.health}`, {
      headers: { "x-request-id": "req_attacker-controlled" },
    });
    expect(response.headers.get("x-request-id")).not.toBe("req_attacker-controlled");
  });

  it("leaks no marker from any of the eight allowlisted headers, the body, the path, or the query (P3-17 acceptance 6)", async () => {
    // Every marker in every one of the eight allowlisted headers at once —
    // most of these values are malformed for their header's own schema
    // (idempotency-key isn't a UUID, join-attempt-secret isn't 256 bits of
    // base64url, ...), which is deliberate: an early-validation failure path
    // must redact exactly as well as a successful one.
    const markerBlob = Object.values(SENSITIVE_TEST_MARKERS).join("|");
    expect(HEADER_ALLOWLIST.length).toBe(8);
    const headers = Object.fromEntries(
      HEADER_ALLOWLIST.map((name) => [name, markerBlob] as const),
    );

    const captured = await captureStdout(async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/towns/${SENSITIVE_TEST_MARKERS.environmentValue}/actions` +
          `?debug=${SENSITIVE_TEST_MARKERS.queryValue}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ note: SENSITIVE_TEST_MARKERS.requestBody }),
        },
      );
      // Every marker header is malformed for its own schema, so this never
      // reaches the pool — a 4xx here is the point, not an incidental result.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });

    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.resolve(HERE, "observability/log.ts");

/** Every `readonly <name>:` field declared inside an `export interface ...LogEvent { ... }` block. */
function logEventFieldNames(source: string): string[] {
  const names: string[] = [];
  const interfaceStarts = source.matchAll(/export interface \w*LogEvent \{/g);
  for (const match of interfaceStarts) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = source.indexOf("}", bodyStart);
    const body = source.slice(bodyStart, bodyEnd);
    for (const fieldMatch of body.matchAll(/readonly\s+(\w+)\s*:/g)) {
      names.push(fieldMatch[1]!);
    }
  }
  return names;
}

describe("game-api LogEvent field names never shadow a forbidden log property (P3-17 acceptance 6)", () => {
  it("carries no forbidden field name", () => {
    const forbidden = new Set(FORBIDDEN_LOG_PROPERTIES);
    const names = logEventFieldNames(readFileSync(LOG_FILE, "utf8"));
    const offenders = names.filter((name) => forbidden.has(name));
    expect(offenders).toStrictEqual([]);
  });

  it("the scan itself is not vacuous", () => {
    const names = logEventFieldNames(readFileSync(LOG_FILE, "utf8"));
    expect(names.length).toBeGreaterThan(1);
  });
});
