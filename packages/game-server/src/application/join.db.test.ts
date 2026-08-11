import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import { materializeTown } from "@the-town-remembers/town-seed";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { routeRequest, type RouterConfig } from "../http/router.js";
import type { HttpRequest } from "../http/types.js";
import { join } from "./join.js";

const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

function joinAttemptSecret(): string {
  return randomBytes(32).toString("base64url");
}

function joinRequest(
  inviteToken: string,
  overrides: {
    readonly idempotencyKey?: string;
    readonly secret?: string;
    readonly displayName?: string;
    readonly sourceIp?: string | undefined;
  } = {},
): HttpRequest {
  return {
    method: "POST",
    path: `/api/v1/invites/${inviteToken}/join`,
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["idempotency-key", overrides.idempotencyKey ?? randomUUID()],
      ["join-attempt-secret", overrides.secret ?? joinAttemptSecret()],
    ]),
    body: JSON.stringify({ displayName: overrides.displayName ?? "Lin Okafor" }),
    // Fresh per call unless overridden, so unrelated test cases never share
    // the join rate bucket (burst 10) by accident.
    sourceIp: overrides.sourceIp ?? randomUUID(),
  };
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

describe.skipIf(!shouldRunDatabaseTests())("first-time join", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;
  let activeTownId: string;
  let inviteToken: string;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    config = {
      buildId: "test-build",
      appOrigin: APP_ORIGIN,
      now: () => new Date(),
      pool: handle.pool,
      securityConfig: SECURITY_CONFIG,
    };

    inviteToken = randomUUID();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    activeTownId = result.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("creates the player, session, and bootstrap visit for an active town", async () => {
    const secret = joinAttemptSecret();
    const { response } = await routeRequest(
      joinRequest(inviteToken, { displayName: "Lin Okafor", secret }),
      "req_1",
      config,
    );

    expect(response.status).toBe(201);
    const body = parseBody(response.body);
    expect(body["initialVisit"]).toMatchObject({
      locationId: expect.any(String) as string,
    });
    expect(response.cookies).toHaveLength(1);
    expect(response.cookies[0]).toContain(`ttr_town_${activeTownId}=`);

    const player = body["player"] as { id: string; displayName: string };
    const sessions = await db().pool.query(
      "SELECT id FROM public.player_sessions WHERE town_id = $1 AND player_id = $2",
      [activeTownId, player.id],
    );
    expect(sessions.rowCount).toBe(1);

    const relationships = await db().pool.query(
      "SELECT npc_id FROM public.npc_player_relationships WHERE town_id = $1 AND player_id = $2",
      [activeTownId, player.id],
    );
    expect(relationships.rowCount).toBe(3);
  }, 30_000);

  it("rejects a case-different duplicate name with no partial rows", async () => {
    const first = await routeRequest(
      joinRequest(inviteToken, { displayName: "Priya Shah" }),
      "req_1",
      config,
    );
    expect(first.response.status).toBe(201);

    const actorsBefore = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.actors WHERE town_id = $1",
      [activeTownId],
    );

    const second = await routeRequest(
      joinRequest(inviteToken, { displayName: "priya shah" }),
      "req_2",
      config,
    );
    expect(second.response.status).toBe(409);

    const actorsAfter = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.actors WHERE town_id = $1",
      [activeTownId],
    );
    expect(actorsAfter.rows[0]?.["n"]).toBe(actorsBefore.rows[0]?.["n"]);
  }, 30_000);

  it("rejects a name colliding with the authored NPC actor", async () => {
    const { response } = await routeRequest(
      joinRequest(inviteToken, { displayName: "mara venn" }),
      "req_1",
      config,
    );
    expect(response.status).toBe(409);
  }, 30_000);

  it("creates exactly one player under two concurrent identical-name joins", async () => {
    const displayName = `Concurrent ${randomUUID().slice(0, 8)}`;
    const [first, second] = await Promise.all([
      routeRequest(joinRequest(inviteToken, { displayName }), "req_1", config),
      routeRequest(joinRequest(inviteToken, { displayName }), "req_2", config),
    ]);
    const statuses = [first.response.status, second.response.status].toSorted();
    expect(statuses).toStrictEqual([201, 409]);
  }, 30_000);

  it.each([
    ["1 grapheme cluster", "a".repeat(1), false],
    ["2 grapheme clusters", "a".repeat(2), true],
    ["24 grapheme clusters", "a".repeat(24), true],
    ["25 grapheme clusters", "a".repeat(25), false],
  ] as const)(
    "%s is accepted=%s",
    async (_label, displayName, accepted) => {
      const { response } = await routeRequest(
        joinRequest(inviteToken, { displayName }),
        "req_1",
        config,
      );
      if (accepted) expect(response.status).toBe(201);
      else expect(response.status).toBe(400);
    },
    30_000,
  );

  it("returns 404, not 401, for a replay with the correct key but wrong secret", async () => {
    const idempotencyKey = randomUUID();
    const displayName = `Secret-check ${randomUUID().slice(0, 8)}`;
    const created = await routeRequest(
      joinRequest(inviteToken, { idempotencyKey, displayName }),
      "req_1",
      config,
    );
    expect(created.response.status).toBe(201);

    const replay = await routeRequest(
      joinRequest(inviteToken, {
        idempotencyKey,
        displayName,
        secret: joinAttemptSecret(),
      }),
      "req_2",
      config,
    );
    expect(replay.response.status).toBe(404);
  }, 30_000);

  it("caps concurrent replay sessions at three and exhausts the rest", async () => {
    const idempotencyKey = randomUUID();
    const secret = joinAttemptSecret();
    const displayName = `Replay ${randomUUID().slice(0, 8)}`;

    const created = await routeRequest(
      joinRequest(inviteToken, { idempotencyKey, displayName, secret }),
      "req_0",
      config,
    );
    expect(created.response.status).toBe(201);

    const replays = await Promise.all(
      Array.from({ length: 9 }, (_unused, index) =>
        routeRequest(
          joinRequest(inviteToken, { idempotencyKey, displayName, secret }),
          `req_${index + 1}`,
          config,
        ),
      ),
    );

    const succeeded = replays.filter((result) => result.response.status === 201);
    const exhausted = replays.filter((result) => result.response.status === 410);
    expect(succeeded.length).toBeLessThanOrEqual(2);
    expect(exhausted.length).toBeGreaterThan(0);
    expect(succeeded.length + exhausted.length).toBe(replays.length);

    const player = parseBody(created.response.body)["player"] as { id: string };
    const sessions = await db().pool.query(
      "SELECT id FROM public.player_sessions WHERE town_id = $1 AND player_id = $2",
      [activeTownId, player.id],
    );
    expect(sessions.rowCount).toBeLessThanOrEqual(3);
  }, 30_000);
});

describe.skipIf(!shouldRunDatabaseTests())("join into a non-active town", () => {
  let handle: DisposableDatabase | undefined;
  let townId: string;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(randomUUID()).digest(),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = result.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  it("creates the player and session but no visit, and initialVisit is null", async () => {
    if (!handle) throw new Error("The disposable database was not created.");

    // townActive: false is exercised directly rather than through a real
    // awaiting_resolution/resolved transition, which requires a real case
    // attempt and event to satisfy towns' own resolution-fields CHECK
    // constraint — machinery Phase 6 owns. This still proves the property
    // P3-04 is responsible for: createPlayer skips the bootstrap visit
    // whenever the caller reports the town is not active.
    const result = await join(
      {
        pool: handle.pool,
        sessionTokenPepper: SECURITY_CONFIG.sessionTokenPepper,
        ipHashSecret: SECURITY_CONFIG.ipHashSecret,
        now: () => new Date(),
      },
      {
        townId,
        townActive: false,
        townStatus: "awaiting_resolution",
        idempotencyKey: randomUUID(),
        joinAttemptSecret: joinAttemptSecret(),
        displayName: "Away Player",
        sourceIp: randomUUID(),
      },
    );

    expect(result.initialVisit).toBeNull();

    const visits = await handle.pool.query(
      "SELECT id FROM public.player_visits WHERE player_id = $1",
      [result.player.id],
    );
    expect(visits.rowCount).toBe(0);
    const actions = await handle.pool.query(
      "SELECT id FROM public.player_actions WHERE player_id = $1",
      [result.player.id],
    );
    expect(actions.rowCount).toBe(0);
  }, 30_000);
});
