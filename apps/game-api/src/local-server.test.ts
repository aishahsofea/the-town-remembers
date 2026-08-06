import type { AddressInfo } from "node:net";

import { ROUTE_TEMPLATES } from "@the-town-remembers/http-contracts";
import { loadGameConfig } from "@the-town-remembers/runtime-config/game";
import {
  SENSITIVE_TEST_MARKERS,
  captureStdout,
  findSensitiveMarkers,
} from "@the-town-remembers/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RouterContext } from "./http/router.js";
import { startLocalServer } from "./local-server.js";

const context: RouterContext = {
  config: loadGameConfig({ TTR_ENV: "local", TTR_BUILD_ID: "local-test" }),
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
      expect(response.status).toBe(404);
    });

    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
  });

  it("does not echo a client-supplied request identifier", async () => {
    const response = await fetch(`${baseUrl}${ROUTE_TEMPLATES.health}`, {
      headers: { "x-request-id": "req_attacker-controlled" },
    });
    expect(response.headers.get("x-request-id")).not.toBe("req_attacker-controlled");
  });
});
