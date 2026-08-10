import { randomUUID } from "node:crypto";

import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { captureStdout, findSensitiveMarkers } from "@the-town-remembers/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { routeRequest, type RouterConfig } from "../http/router.js";
import type { HttpRequest } from "../http/types.js";

const JUDGE_CODE = "correct-judge-code-for-tests";
const APP_ORIGIN = "https://town.example";

const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: JUDGE_CODE,
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

function fixtureRequest(input: {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}): HttpRequest {
  return {
    method: input.method,
    path: input.path,
    headers: new Map(Object.entries(input.headers ?? {})),
    body: input.body,
    sourceIp: undefined,
  };
}

function createTownRequest(overrides: {
  readonly idempotencyKey?: string;
  readonly authorization?: string | undefined;
  readonly origin?: string | undefined;
  readonly contentType?: string;
  readonly body?: string;
}): HttpRequest {
  const headers: Record<string, string> = {};
  if (overrides.origin !== undefined) headers["origin"] = overrides.origin;
  if (overrides.authorization !== undefined)
    headers["authorization"] = overrides.authorization;
  headers["content-type"] = overrides.contentType ?? "application/json";
  headers["idempotency-key"] = overrides.idempotencyKey ?? randomUUID();

  return fixtureRequest({
    method: "POST",
    path: "/api/v1/towns",
    headers,
    body: overrides.body ?? "{}",
  });
}

describe.skipIf(!shouldRunDatabaseTests())("town creation", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    config = {
      buildId: "test-build",
      appOrigin: APP_ORIGIN,
      now: () => new Date(),
      pool: handle.pool,
      securityConfig: SECURITY_CONFIG,
    };
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("creates exactly one town under two concurrent identical requests", async () => {
    const idempotencyKey = randomUUID();
    const request = createTownRequest({
      idempotencyKey,
      authorization: `Bearer ${JUDGE_CODE}`,
      origin: APP_ORIGIN,
    });

    const [first, second] = await Promise.all([
      routeRequest(request, "req_1", config),
      routeRequest(request, "req_2", config),
    ]);

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(first.response.body).toBe(second.response.body);

    const towns = await db().pool.query("SELECT id FROM public.towns");
    expect(towns.rowCount).toBe(1);
    const requests = await db().pool.query(
      "SELECT idempotency_key FROM public.town_creation_requests WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    expect(requests.rowCount).toBe(1);
  }, 30_000);

  it("replays the identical inviteUrl even after a simulated key rotation", async () => {
    const idempotencyKey = randomUUID();
    const request = createTownRequest({
      idempotencyKey,
      authorization: `Bearer ${JUDGE_CODE}`,
      origin: APP_ORIGIN,
    });

    const created = await routeRequest(request, "req_1", config);
    expect(created.response.status).toBe(201);

    const rotatedConfig: RouterConfig = {
      ...config,
      securityConfig: {
        ...SECURITY_CONFIG,
        inviteSigningKeys: [
          { version: "v2", key: new Uint8Array(32).fill(9) },
          ...SECURITY_CONFIG.inviteSigningKeys,
        ],
      },
    };

    const replayed = await routeRequest(request, "req_2", rotatedConfig);
    expect(replayed.response.status).toBe(201);
    expect(replayed.response.body).toBe(created.response.body);
  }, 30_000);

  it("rejects an absent Authorization, a non-Bearer scheme, a wrong code, and a wrong Origin", async () => {
    const cases: ReadonlyArray<{
      readonly label: string;
      readonly request: HttpRequest;
      readonly status: number;
    }> = [
      {
        label: "absent Authorization",
        request: createTownRequest({ origin: APP_ORIGIN }),
        status: 401,
      },
      {
        label: "non-Bearer scheme",
        request: createTownRequest({
          origin: APP_ORIGIN,
          authorization: "Basic abc123",
        }),
        status: 401,
      },
      {
        label: "wrong judge code",
        request: createTownRequest({
          origin: APP_ORIGIN,
          authorization: "Bearer wrong-code",
        }),
        status: 403,
      },
      {
        label: "wrong Origin, correct code",
        request: createTownRequest({
          origin: "https://attacker.example",
          authorization: `Bearer ${JUDGE_CODE}`,
        }),
        status: 403,
      },
    ];

    const before = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.town_creation_requests",
    );

    for (const testCase of cases) {
      const { response } = await routeRequest(testCase.request, "req_1", config);
      expect(response.status, testCase.label).toBe(testCase.status);
    }

    const after = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.town_creation_requests",
    );
    expect(after.rows[0]?.["n"]).toBe(before.rows[0]?.["n"]);
  }, 30_000);

  it("stores response_payload as exactly townId and status, never the invite token", async () => {
    const idempotencyKey = randomUUID();
    const request = createTownRequest({
      idempotencyKey,
      authorization: `Bearer ${JUDGE_CODE}`,
      origin: APP_ORIGIN,
    });

    const { response } = await routeRequest(request, "req_1", config);
    expect(response.status).toBe(201);
    const parsed = JSON.parse(response.body) as { townId: string; inviteUrl: string };
    const token = parsed.inviteUrl.split("/join/")[1]!;

    const row = await db().pool.query<{ response_payload: unknown }>(
      "SELECT response_payload FROM public.town_creation_requests WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    expect(row.rows[0]?.response_payload).toStrictEqual({
      townId: parsed.townId,
      status: "active",
    });

    const townRow = await db().pool.query<{ invite_token_hash: Buffer }>(
      "SELECT invite_token_hash FROM public.towns WHERE id = $1",
      [parsed.townId],
    );
    expect(townRow.rows[0]?.invite_token_hash.toString("utf8")).not.toContain(token);
    expect(JSON.stringify(row.rows[0]?.response_payload)).not.toContain(token);
  }, 30_000);

  it("emits no judge code or invite token in the captured log output", async () => {
    const idempotencyKey = randomUUID();
    const request = createTownRequest({
      idempotencyKey,
      authorization: `Bearer ${JUDGE_CODE}`,
      origin: APP_ORIGIN,
    });

    let inviteUrl = "";
    const captured = await captureStdout(async () => {
      const { response } = await routeRequest(request, "req_1", config);
      inviteUrl = (JSON.parse(response.body) as { inviteUrl: string }).inviteUrl;
    });

    expect(findSensitiveMarkers(captured.raw)).toStrictEqual([]);
    expect(captured.raw).not.toContain(JUDGE_CODE);
    const token = inviteUrl.split("/join/")[1]!;
    expect(captured.raw).not.toContain(token);
  }, 30_000);
});
