/**
 * Cross-tenant isolation probes (`P3-17` acceptance 3): another town's
 * location ID, inspectable ID, action ID, session token, and clue ID, each
 * presented to the wrong town, must draw the identical response a genuinely
 * nonexistent ID would — never a leak of the fact that the ID is real, just
 * owned by someone else's town.
 *
 * Two real towns are materialized so every probed ID is a real row in a
 * database that exists, never a syntactically-valid-but-never-inserted
 * placeholder — the property under test is tenant scoping, not "does this
 * row exist at all."
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { ProblemResponseSchema } from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  useSharedTestDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readBoardEntryExists,
  readClueDiscoveries,
} from "../persistence/discoveries.js";
import { routeRequest, type RouterConfig } from "../http/router.js";
import type { HttpRequest } from "../http/types.js";

const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

/**
 * A syntactically valid UUID that was never inserted anywhere — every
 * probed column is `uuid`-typed, so a non-UUID placeholder would draw its
 * own database type error rather than the tenant-scoping denial under test.
 */
const NONEXISTENT_ID = randomUUID();

function joinAttemptSecret(): string {
  return randomBytes(32).toString("base64url");
}

function joinRequest(inviteToken: string, displayName: string): HttpRequest {
  return {
    method: "POST",
    path: `/api/v1/invites/${inviteToken}/join`,
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["idempotency-key", randomUUID()],
      ["join-attempt-secret", joinAttemptSecret()],
    ]),
    body: JSON.stringify({ displayName }),
    sourceIp: randomUUID(),
  };
}

function actionRequest(
  townId: string,
  cookieHeader: string,
  body: unknown,
): HttpRequest {
  return {
    method: "POST",
    path: `/api/v1/towns/${townId}/actions`,
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["cookie", cookieHeader],
      ["idempotency-key", randomUUID()],
    ]),
    body: JSON.stringify(body),
    sourceIp: undefined,
  };
}

function actionStatusRequest(
  townId: string,
  cookieHeader: string,
  actionId: string,
): HttpRequest {
  return {
    method: "GET",
    path: `/api/v1/towns/${townId}/actions/${actionId}`,
    headers: new Map([["cookie", cookieHeader]]),
    body: undefined,
    sourceIp: undefined,
  };
}

function playerViewRequest(townId: string, cookieHeader: string): HttpRequest {
  return {
    method: "GET",
    path: `/api/v1/towns/${townId}/player-view`,
    headers: new Map([["cookie", cookieHeader]]),
    body: undefined,
    sourceIp: undefined,
  };
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

/** `requestId` is intentionally per-request; strip it before an equality check. */
function withoutRequestId<T extends { requestId: string }>(
  problem: T,
): Omit<T, "requestId"> {
  const { requestId: _requestId, ...rest } = problem;
  return rest;
}

/** `actionId` is intentionally unique per attempt; strip it before an equality check. */
function withoutActionId(body: Record<string, unknown>): Record<string, unknown> {
  const { actionId: _actionId, ...rest } = body;
  return rest;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

function cookieValue(cookiePairString: string): string {
  return cookiePairString.split("=").slice(1).join("=");
}

describe.skipIf(!shouldRunDatabaseTests())(
  "cross-tenant isolation (P3-17 acceptance 3)",
  () => {
    let handleA: DisposableDatabase | undefined;
    let config: RouterConfig;

    let townAId: string;
    let townBId: string;
    let inviteTokenA: string;
    let inviteTokenB: string;

    let playerACookie: string;
    let playerBCookie: string;

    let locationBId: string;
    let inspectableBId: string;
    let actionBId: string;
    let clueBId: string;

    beforeAll(async () => {
      // Both towns share one disposable database (a single CockroachDB
      // instance, two independent town rows) — the property under test is
      // `town_id` scoping inside one database, not database-per-tenant
      // isolation, so one shared handle is both sufficient and faster.
      handleA = await useSharedTestDatabase();

      config = {
        buildId: "test-build",
        appOrigin: APP_ORIGIN,
        now: () => new Date(),
        pool: handleA.pool,
        securityConfig: SECURITY_CONFIG,
      };

      inviteTokenA = randomUUID();
      const townA = await materializeTown(handleA.pool, {
        contentVersion: "bell-mystery-v1",
        createdAt: new Date(),
        inviteTokenHash: createHash("sha256").update(inviteTokenA).digest(),
      });
      if (townA.outcome !== "committed") throw new Error("Town A did not commit.");
      townAId = townA.value.townId;

      inviteTokenB = randomUUID();
      const townB = await materializeTown(handleA.pool, {
        contentVersion: "bell-mystery-v1",
        createdAt: new Date(),
        inviteTokenHash: createHash("sha256").update(inviteTokenB).digest(),
      });
      if (townB.outcome !== "committed") throw new Error("Town B did not commit.");
      townBId = townB.value.townId;

      const { response: joinA } = await routeRequest(
        joinRequest(inviteTokenA, "Player A"),
        "req_join_a",
        config,
      );
      expect(joinA.status).toBe(201);
      playerACookie = cookiePair(joinA.cookies[0]!);

      const { response: joinB } = await routeRequest(
        joinRequest(inviteTokenB, "Player B"),
        "req_join_b",
        config,
      );
      expect(joinB.status).toBe(201);
      playerBCookie = cookiePair(joinB.cookies[0]!);

      const locationRows = await handleA.pool.query<{ id: string }>(
        `SELECT id FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location' AND entity_key = 'lantern_inn'`,
        [townBId],
      );
      locationBId = locationRows.rows[0]!.id;

      const inspectableRows = await handleA.pool.query<{ id: string }>(
        `SELECT id FROM public.inspectables
        WHERE town_id = $1 AND inspectable_key = 'empty_bell_frame'`,
        [townBId],
      );
      inspectableBId = inspectableRows.rows[0]!.id;

      const actionRows = await handleA.pool.query<{ id: string }>(
        `SELECT id FROM public.player_actions WHERE town_id = $1 LIMIT 1`,
        [townBId],
      );
      actionBId = actionRows.rows[0]!.id;

      const clueRows = await handleA.pool.query<{ id: string }>(
        `SELECT id FROM public.clues WHERE town_id = $1 LIMIT 1`,
        [townBId],
      );
      clueBId = clueRows.rows[0]!.id;
    }, 180_000);

    afterAll(async () => {
      await handleA?.dispose();
    });

    it("travel to another town's real location denies identically to a nonexistent one", async () => {
      const { response: real } = await routeRequest(
        actionRequest(townAId, playerACookie, {
          kind: "travel",
          destinationLocationId: locationBId,
        }),
        "req_real",
        config,
      );
      const { response: fake } = await routeRequest(
        actionRequest(townAId, playerACookie, {
          kind: "travel",
          destinationLocationId: NONEXISTENT_ID,
        }),
        "req_fake",
        config,
      );

      expect(real.status).toBe(fake.status);
      expect(withoutActionId(parseBody(real.body))).toStrictEqual(
        withoutActionId(parseBody(fake.body)),
      );
    });

    it("inspecting another town's real inspectable denies identically to a nonexistent one", async () => {
      const { response: real } = await routeRequest(
        actionRequest(townAId, playerACookie, {
          kind: "inspect",
          inspectableId: inspectableBId,
        }),
        "req_real",
        config,
      );
      const { response: fake } = await routeRequest(
        actionRequest(townAId, playerACookie, {
          kind: "inspect",
          inspectableId: NONEXISTENT_ID,
        }),
        "req_fake",
        config,
      );

      expect(real.status).toBe(fake.status);
      expect(withoutActionId(parseBody(real.body))).toStrictEqual(
        withoutActionId(parseBody(fake.body)),
      );
    });

    it("polling another town's real action ID 404s identically to a nonexistent one", async () => {
      const { response: real } = await routeRequest(
        actionStatusRequest(townAId, playerACookie, actionBId),
        "req_real",
        config,
      );
      const { response: fake } = await routeRequest(
        actionStatusRequest(townAId, playerACookie, NONEXISTENT_ID),
        "req_fake",
        config,
      );

      expect(real.status).toBe(404);
      expect(fake.status).toBe(404);
      expect(
        withoutRequestId(ProblemResponseSchema.parse(parseBody(real.body))),
      ).toStrictEqual(
        withoutRequestId(ProblemResponseSchema.parse(parseBody(fake.body))),
      );
    });

    it("presenting another town's real session token under this town's cookie name is invalid, identically to a forged token", async () => {
      const forgedCookie = `ttr_town_${townAId}=${cookieValue(playerBCookie)}`;
      const bogusCookie = `ttr_town_${townAId}=not-a-real-token-at-all`;

      const { response: real } = await routeRequest(
        playerViewRequest(townAId, forgedCookie),
        "req_real",
        config,
      );
      const { response: fake } = await routeRequest(
        playerViewRequest(townAId, bogusCookie),
        "req_fake",
        config,
      );

      expect(real.status).toBe(401);
      expect(fake.status).toBe(401);
      expect(
        withoutRequestId(ProblemResponseSchema.parse(parseBody(real.body))),
      ).toStrictEqual(
        withoutRequestId(ProblemResponseSchema.parse(parseBody(fake.body))),
      );
    });

    it("reading another town's real clue by ID returns the same empty result as a nonexistent clue", async () => {
      // No Phase 3 route accepts a raw clue ID from the client yet (`tell`/
      // `show`/`give` — the routes that would — are Phase 4+), so this probes
      // the persistence layer directly: the same tenant-scoping the HTTP-level
      // probes above exercise through a route.
      const realDiscoveries = await readClueDiscoveries(
        handleA!.pool,
        townAId,
        clueBId,
      );
      const fakeDiscoveries = await readClueDiscoveries(
        handleA!.pool,
        townAId,
        NONEXISTENT_ID,
      );
      expect(realDiscoveries).toStrictEqual(fakeDiscoveries);
      expect(realDiscoveries).toStrictEqual([]);

      const realBoardEntry = await readBoardEntryExists(
        handleA!.pool,
        townAId,
        clueBId,
      );
      const fakeBoardEntry = await readBoardEntryExists(
        handleA!.pool,
        townAId,
        NONEXISTENT_ID,
      );
      expect(realBoardEntry).toBe(fakeBoardEntry);
      expect(realBoardEntry).toBe(false);
    });
  },
);
