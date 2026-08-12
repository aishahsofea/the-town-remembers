/**
 * `POST /api/v1/towns/{townId}/actions` acceptance suite for `start_visit`
 * and `travel` (`P3-10`).
 *
 * `leave` does not exist yet (`P3-12`), so every "away" fixture here ends a
 * visit with a direct `UPDATE`, the same technique `player-view.db.test.ts`
 * already uses for its own away-player fixture.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { CompletedActionResponseSchema } from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  SHA256_PLACEHOLDER,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { actionRequestHash } from "../security/fingerprint.js";
import { routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

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
  idempotencyKey: string,
  body: unknown,
): HttpRequest {
  return {
    method: "POST",
    path: `/api/v1/towns/${townId}/actions`,
    headers: new Map([
      ["origin", APP_ORIGIN],
      ["content-type", "application/json"],
      ["cookie", cookieHeader],
      ["idempotency-key", idempotencyKey],
    ]),
    body: JSON.stringify(body),
    sourceIp: undefined,
  };
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

/** The `Set-Cookie` value's `name=value` pair, reusable as a request `Cookie` header. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

/**
 * `towns`'s own `ck_towns__resolution_fields`-style check constraint requires
 * `winning_case_attempt_id`/`resolution_owner_player_id`/
 * `resolution_reservation_expires_at` all non-null while `awaiting_resolution`,
 * and `winning_case_attempt_id` carries a real composite foreign key into
 * `case_attempts` — so freezing a town for a fixture means building one real,
 * minimally valid `case_attempts` row (and the `world_events`/`player_actions`
 * rows it in turn requires), not just flipping `status`.
 */
async function freezeTownForResolution(
  pool: Pool,
  townId: string,
  ownerPlayerId: string,
): Promise<void> {
  const [suspect, motive, location] = await Promise.all([
    pool.query<{ id: string }>(
      `SELECT id FROM public.story_entities WHERE town_id = $1 AND entity_type = 'character' LIMIT 1`,
      [townId],
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM public.story_entities WHERE town_id = $1 AND entity_type = 'motive' LIMIT 1`,
      [townId],
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM public.story_entities WHERE town_id = $1 AND entity_type = 'location' LIMIT 1`,
      [townId],
    ),
  ]);

  const now = new Date();
  const bumped = await pool.query<{ last_event_sequence: number }>(
    `UPDATE public.towns SET last_event_sequence = last_event_sequence + 1, updated_at = $2
      WHERE id = $1 RETURNING last_event_sequence`,
    [townId, now],
  );
  const eventId = randomUUID();
  await pool.query(
    `INSERT INTO public.world_events
       (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
        effect_index, effect_key, actor_id, payload, created_at)
     VALUES ($1, $2, $3, 'case_attempted', false, $4, 'system_seed', 0, $5, $6, '{}', $4)`,
    [
      townId,
      eventId,
      bumped.rows[0]!.last_event_sequence,
      now,
      `test:freeze:${eventId}`,
      ownerPlayerId,
    ],
  );

  const actionId = randomUUID();
  await pool.query(
    `INSERT INTO public.player_actions
       (town_id, id, player_id, idempotency_key, action_kind, request_hash,
        request_payload, status, attempt_count, outcome, response_status,
        response_payload, created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, $4, 'accuse', $5, '{}', 'completed', 1, 'applied', 200, '{}', $6, $6, $6)`,
    [townId, actionId, ownerPlayerId, randomUUID(), SHA256_PLACEHOLDER, now],
  );

  const caseAttemptId = randomUUID();
  await pool.query(
    `INSERT INTO public.case_attempts
       (town_id, id, player_action_id, player_id, suspect_entity_id, motive_entity_id,
        location_entity_id, outcome, event_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'correct', $8, $9)`,
    [
      townId,
      caseAttemptId,
      actionId,
      ownerPlayerId,
      suspect.rows[0]!.id,
      motive.rows[0]!.id,
      location.rows[0]!.id,
      eventId,
      now,
    ],
  );

  await pool.query(
    `UPDATE public.towns
        SET status = 'awaiting_resolution', winning_case_attempt_id = $2,
            resolution_owner_player_id = $3, resolution_reservation_expires_at = $4,
            updated_at = $5
      WHERE id = $1`,
    [townId, caseAttemptId, ownerPlayerId, new Date(now.getTime() + 600_000), now],
  );
}

async function unfreezeTown(pool: Pool, townId: string): Promise<void> {
  await pool.query(
    `UPDATE public.towns
        SET status = 'active', winning_case_attempt_id = NULL,
            resolution_owner_player_id = NULL, resolution_reservation_expires_at = NULL
      WHERE id = $1`,
    [townId],
  );
}

describe.skipIf(!shouldRunDatabaseTests())(
  "POST /actions — start_visit and travel",
  () => {
    let handle: DisposableDatabase | undefined;
    let config: RouterConfig;
    let townId: string;
    let inviteToken: string;
    let otherTownId: string;
    let festivalSquareId: string;
    let lanternInnId: string;
    let oldChapelId: string;
    let itemEntityId: string;
    let otherTownLocationId: string;

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
      townId = result.value.townId;

      const otherInvite = randomUUID();
      const otherResult = await materializeTown(handle.pool, {
        contentVersion: "bell-mystery-v1",
        createdAt: new Date(),
        inviteTokenHash: createHash("sha256").update(otherInvite).digest(),
      });
      if (otherResult.outcome !== "committed")
        throw new Error("The seed did not commit.");
      otherTownId = otherResult.value.townId;

      const locations = await handle.pool.query<{ id: string; entity_key: string }>(
        `SELECT id, entity_key FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location'`,
        [townId],
      );
      const byKey = new Map(locations.rows.map((row) => [row.entity_key, row.id]));
      festivalSquareId = byKey.get("festival_square")!;
      lanternInnId = byKey.get("lantern_inn")!;
      oldChapelId = byKey.get("old_chapel")!;

      const items = await handle.pool.query<{ id: string }>(
        `SELECT id FROM public.story_entities WHERE town_id = $1 AND entity_type = 'item' LIMIT 1`,
        [townId],
      );
      itemEntityId = items.rows[0]!.id;

      const otherLocations = await handle.pool.query<{ id: string }>(
        `SELECT id FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location' LIMIT 1`,
        [otherTownId],
      );
      otherTownLocationId = otherLocations.rows[0]!.id;
    }, 180_000);

    afterAll(async () => {
      await handle?.dispose();
    });

    function db(): DisposableDatabase {
      if (!handle) throw new Error("The disposable database was not created.");
      return handle;
    }

    async function joinedPlayer(displayName: string) {
      const { response } = await routeRequest(
        joinRequest(inviteToken, displayName),
        "req_join",
        config,
      );
      expect(response.status).toBe(201);
      const body = parseBody(response.body);
      const player = body["player"] as { id: string; displayName: string };
      const cookie = cookiePair(response.cookies[0]!);
      return { playerId: player.id, cookie };
    }

    async function endActiveVisit(playerId: string): Promise<void> {
      const visit = await db().pool.query<{
        id: string;
        started_by_action_id: string;
        start_revision: number;
      }>(
        `SELECT id, started_by_action_id, start_revision FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
        [townId, playerId],
      );
      const row = visit.rows[0]!;
      await db().pool.query(
        `UPDATE public.player_visits
          SET status = 'ended', end_revision = $3, ended_by_action_id = $4,
              end_reason = 'left_town', ended_at = $5
        WHERE town_id = $1 AND id = $2`,
        [townId, row.id, row.start_revision, row.started_by_action_id, new Date()],
      );
    }

    async function travel(
      player: { playerId: string; cookie: string },
      destinationLocationId: string,
      idempotencyKey: string = randomUUID(),
    ) {
      return routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, {
          kind: "travel",
          destinationLocationId,
        }),
        "req_1",
        config,
      );
    }

    async function startVisit(
      player: { playerId: string; cookie: string },
      idempotencyKey: string = randomUUID(),
    ) {
      return routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, { kind: "start_visit" }),
        "req_1",
        config,
      );
    }

    it("acceptance 1: start_visit after ending a visit restarts at Festival Square; an immediate second returns already_active and creates no second visit row", async () => {
      const player = await joinedPlayer("Fresh Start");
      await endActiveVisit(player.playerId);

      const first = await startVisit(player);
      expect(first.response.status).toBe(200);
      const firstBody = CompletedActionResponseSchema.parse(
        parseBody(first.response.body),
      );
      expect(firstBody.outcome).toBe("applied");
      expect(
        (firstBody as { result: { disposition: string; locationId: string } }).result
          .disposition,
      ).toBe("started");
      expect(
        (firstBody as { result: { disposition: string; locationId: string } }).result
          .locationId,
      ).toBe(festivalSquareId);

      const second = await startVisit(player);
      const secondBody = CompletedActionResponseSchema.parse(
        parseBody(second.response.body),
      );
      expect(secondBody.outcome).toBe("no_change");
      expect(
        (secondBody as { result: { disposition: string } }).result.disposition,
      ).toBe("already_active");

      const visits = await db().pool.query(
        `SELECT id FROM public.player_visits WHERE town_id = $1 AND player_id = $2`,
        [townId, player.playerId],
      );
      // The bootstrap visit (ended above) plus the one `first` started: never a third.
      expect(visits.rows).toHaveLength(2);
    }, 30_000);

    it("acceptance 2: start_visit in an awaiting_resolution town is a completed TOWN_NOT_ACTIVE denial", async () => {
      const player = await joinedPlayer("Frozen Starter");
      await endActiveVisit(player.playerId);
      await freezeTownForResolution(db().pool, townId, player.playerId);

      try {
        const { response } = await startVisit(player);
        expect(response.status).toBe(200);
        const body = CompletedActionResponseSchema.parse(parseBody(response.body));
        expect(body.outcome).toBe("denied");
        expect((body as { result: { reasonCode: string } }).result.reasonCode).toBe(
          "TOWN_NOT_ACTIVE",
        );
      } finally {
        await unfreezeTown(db().pool, townId);
      }
    }, 30_000);

    it("acceptance 3: travel to the Old Chapel is denied LOCATION_LOCKED with the exact message, enumerating neither unlock route", async () => {
      const player = await joinedPlayer("Locked Out");
      const { response } = await travel(player, oldChapelId);

      expect(response.status).toBe(200);
      const body = CompletedActionResponseSchema.parse(parseBody(response.body));
      expect(body.outcome).toBe("denied");
      const result = body as { result: { reasonCode: string; message: string } };
      expect(result.result.reasonCode).toBe("LOCATION_LOCKED");
      expect(result.result.message).toBe("The chapel door is locked.");
      expect(result.result.message).not.toMatch(/key|capability|nessa|corin/i);
    }, 30_000);

    it("acceptance 4: a cross-town location, an item id, and a random UUID all produce an identical DESTINATION_UNKNOWN denial", async () => {
      const player = await joinedPlayer("Prober");

      const crossTown = await travel(player, otherTownLocationId);
      const item = await travel(player, itemEntityId);
      const unknown = await travel(player, randomUUID());
      const opaque = await travel(player, "opaque-location-id");

      for (const outcome of [crossTown, item, unknown, opaque]) {
        expect(outcome.response.status).toBe(200);
      }
      const bodies = [crossTown, item, unknown, opaque].map((outcome) => {
        const parsed = parseBody(outcome.response.body) as {
          actionId: string;
          result: unknown;
        };
        const { actionId: _actionId, ...rest } = parsed;
        return rest;
      });
      expect(bodies[0]).toStrictEqual(bodies[1]);
      expect(bodies[1]).toStrictEqual(bodies[2]);
      expect(bodies[2]).toStrictEqual(bodies[3]);
      expect((bodies[0] as { result: { reasonCode: string } }).result.reasonCode).toBe(
        "DESTINATION_UNKNOWN",
      );
    }, 30_000);

    it("acceptance 5: travel to the current location returns already_there/no_change and emits no world_events row", async () => {
      const player = await joinedPlayer("Homebody");
      const before = await db().pool.query(
        "SELECT count(*)::int AS n FROM public.world_events WHERE town_id = $1",
        [townId],
      );

      const { response } = await travel(player, festivalSquareId);
      const body = CompletedActionResponseSchema.parse(parseBody(response.body));
      expect(body.outcome).toBe("no_change");
      expect((body as { result: { disposition: string } }).result.disposition).toBe(
        "already_there",
      );

      const after = await db().pool.query(
        "SELECT count(*)::int AS n FROM public.world_events WHERE town_id = $1",
        [townId],
      );
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    }, 30_000);

    it("acceptance 6: a successful travel emits exactly one travelled event and updates the visit's location in the same transaction as the revision bump", async () => {
      const player = await joinedPlayer("Wanderer");
      const revisionBefore = await db().pool.query<{ revision: number }>(
        "SELECT revision FROM public.towns WHERE id = $1",
        [townId],
      );

      const { response } = await travel(player, lanternInnId);
      const body = CompletedActionResponseSchema.parse(parseBody(response.body));
      expect(body.outcome).toBe("applied");
      expect((body as { result: { disposition: string } }).result.disposition).toBe(
        "arrived",
      );

      const revisionAfter = await db().pool.query<{ revision: number }>(
        "SELECT revision FROM public.towns WHERE id = $1",
        [townId],
      );
      expect(revisionAfter.rows[0]!.revision).toBe(
        revisionBefore.rows[0]!.revision + 1,
      );

      const events = await db().pool.query(
        `SELECT event_type FROM public.world_events
        WHERE town_id = $1 AND event_type = 'travelled' AND actor_id = $2`,
        [townId, player.playerId],
      );
      expect(events.rows).toHaveLength(1);

      const visit = await db().pool.query<{ current_location_entity_id: string }>(
        `SELECT current_location_entity_id FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
        [townId, player.playerId],
      );
      expect(visit.rows[0]!.current_location_entity_id).toBe(lanternInnId);
    }, 30_000);

    it("acceptance 6b: travel into the Old Chapel succeeds once the player holds the physical key", async () => {
      const player = await joinedPlayer("Key Bearer");
      await db().pool.query(
        `UPDATE public.items
          SET location_entity_id = NULL, location_entity_type = NULL, held_by_actor_id = $2
        WHERE town_id = $1
          AND id = (SELECT id FROM public.story_entities
                      WHERE town_id = $1 AND entity_key = 'old_chapel_key')`,
        [townId, player.playerId],
      );

      const { response } = await travel(player, oldChapelId);
      const body = CompletedActionResponseSchema.parse(parseBody(response.body));
      expect(body.outcome).toBe("applied");
    }, 30_000);

    it("acceptance 7: a different new key is rejected 409 ACTION_IN_PROGRESS while another action is live for the same player", async () => {
      // A genuinely concurrent pair of `Promise.all`-fired requests races real
      // wall-clock timing — `travel`'s own claim-to-commit window is short
      // enough locally that the second call's `readBlocker` can easily run
      // after the first has already completed, making both succeed and the
      // test flaky. Planting the live blocking row directly (the same
      // technique the "generic executor outcome wiring" tests below use for
      // `processing`/`retryable`/`failed` replays) reproduces the exact
      // decision table row deterministically instead.
      const player = await joinedPlayer("Blocked Traveler");
      const blockingActionId = randomUUID();
      await db().pool.query(
        `INSERT INTO public.player_actions
         (town_id, id, player_id, idempotency_key, action_kind, request_hash,
          request_payload, target_actor_id, target_entity_id, status,
          processing_token, processing_expires_at, attempt_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'travel', $5, '{}', NULL, NULL, 'processing',
               $6, $7, 1, $8, $8)`,
        [
          townId,
          blockingActionId,
          player.playerId,
          randomUUID(),
          SHA256_PLACEHOLDER,
          randomUUID(),
          new Date(Date.now() + 30_000),
          new Date(),
        ],
      );

      const { response } = await travel(player, lanternInnId);
      expect(response.status).toBe(409);
      expect(parseBody(response.body)["code"]).toBe("ACTION_IN_PROGRESS");
      expect(response.headers["retry-after"]).toBe("2");
      expect(response.headers["location"]).toContain(blockingActionId);
    }, 30_000);

    it("acceptance 8: an away player's travel is denied VISIT_NOT_ACTIVE, and a frozen visit (active visit, town not active) is denied TOWN_NOT_ACTIVE", async () => {
      const away = await joinedPlayer("Away Traveler");
      await endActiveVisit(away.playerId);
      const awayResult = await travel(away, lanternInnId);
      const awayBody = CompletedActionResponseSchema.parse(
        parseBody(awayResult.response.body),
      );
      expect(awayBody.outcome).toBe("denied");
      expect((awayBody as { result: { reasonCode: string } }).result.reasonCode).toBe(
        "VISIT_NOT_ACTIVE",
      );

      const frozen = await joinedPlayer("Frozen Traveler");
      await freezeTownForResolution(db().pool, townId, frozen.playerId);
      try {
        const frozenResult = await travel(frozen, lanternInnId);
        const frozenBody = CompletedActionResponseSchema.parse(
          parseBody(frozenResult.response.body),
        );
        expect(frozenBody.outcome).toBe("denied");
        expect(
          (frozenBody as { result: { reasonCode: string } }).result.reasonCode,
        ).toBe("TOWN_NOT_ACTIVE");
      } finally {
        await unfreezeTown(db().pool, townId);
      }
    }, 30_000);
  },
);

describe.skipIf(!shouldRunDatabaseTests())(
  "POST /actions — generic executor outcome wiring",
  () => {
    let handle: DisposableDatabase | undefined;
    let config: RouterConfig;
    let townId: string;
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
      townId = result.value.townId;
    }, 180_000);

    afterAll(async () => {
      await handle?.dispose();
    });

    function db(): DisposableDatabase {
      if (!handle) throw new Error("The disposable database was not created.");
      return handle;
    }

    async function joinedPlayer(displayName: string) {
      const { response } = await routeRequest(
        joinRequest(inviteToken, displayName),
        "req_join",
        config,
      );
      expect(response.status).toBe(201);
      const body = parseBody(response.body);
      const player = body["player"] as { id: string; displayName: string };
      const cookie = cookiePair(response.cookies[0]!);
      return { playerId: player.id, cookie };
    }

    it("replays the completed response byte-identically for a repeated idempotency key", async () => {
      const player = await joinedPlayer("Replayer");
      const idempotencyKey = randomUUID();
      const request = actionRequest(townId, player.cookie, idempotencyKey, {
        kind: "start_visit",
      });

      const first = await routeRequest(request, "req_1", config);
      const second = await routeRequest(request, "req_2", config);

      expect(first.response.status).toBe(second.response.status);
      expect(first.response.body).toBe(second.response.body);
    }, 30_000);

    it("returns 409 IDEMPOTENCY_KEY_REUSED for the same key submitted with a different action kind", async () => {
      const player = await joinedPlayer("Key Reuser");
      const idempotencyKey = randomUUID();

      const first = await routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, { kind: "start_visit" }),
        "req_1",
        config,
      );
      expect(first.response.status).toBe(200);

      const reused = await routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, {
          kind: "travel",
          destinationLocationId: randomUUID(),
        }),
        "req_2",
        config,
      );
      expect(reused.response.status).toBe(409);
      expect(parseBody(reused.response.body)["code"]).toBe("IDEMPOTENCY_KEY_REUSED");
    }, 30_000);

    it("returns 202 processing while a claim is still live", async () => {
      const player = await joinedPlayer("Poller");
      const idempotencyKey = randomUUID();
      const requestHash = actionRequestHash({
        kind: "start_visit",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      });

      await db().pool.query(
        `INSERT INTO public.player_actions
         (town_id, id, player_id, idempotency_key, action_kind, request_hash,
          request_payload, target_actor_id, target_entity_id, status,
          processing_token, processing_expires_at, attempt_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'start_visit', $5, '{}', NULL, NULL, 'processing',
               $6, $7, 1, $8, $8)`,
        [
          townId,
          randomUUID(),
          player.playerId,
          idempotencyKey,
          requestHash,
          randomUUID(),
          new Date(Date.now() + 30_000),
          new Date(),
        ],
      );

      const { response } = await routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, { kind: "start_visit" }),
        "req_1",
        config,
      );
      expect(response.status).toBe(202);
      expect(response.headers["retry-after"]).toBe("2");
      expect(parseBody(response.body)["status"]).toBe("processing");
    }, 30_000);

    it("returns a saved 409 ACTION_CONFLICT with Retry-After for a retryable replay before its retry_after_at", async () => {
      const player = await joinedPlayer("Conflicted");
      const idempotencyKey = randomUUID();
      const requestHash = actionRequestHash({
        kind: "start_visit",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      });
      const storedBody = {
        code: "ACTION_CONFLICT",
        title: "Action conflict",
        detail: "The town changed while this action was processing. Retrying is safe.",
        fieldErrors: [],
      };

      await db().pool.query(
        `INSERT INTO public.player_actions
         (town_id, id, player_id, idempotency_key, action_kind, request_hash,
          request_payload, target_actor_id, target_entity_id, status,
          response_status, response_payload, error_code, retry_after_at,
          attempt_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'start_visit', $5, '{}', NULL, NULL, 'retryable',
               409, $6, $7, $8, 1, $9, $9)`,
        [
          townId,
          randomUUID(),
          player.playerId,
          idempotencyKey,
          requestHash,
          JSON.stringify(storedBody),
          storedBody.code,
          new Date(Date.now() + 30_000),
          new Date(),
        ],
      );

      const { response } = await routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, { kind: "start_visit" }),
        "req_1",
        config,
      );
      expect(response.status).toBe(409);
      expect(response.headers["retry-after"]).toBeTruthy();
      expect(parseBody(response.body)["code"]).toBe("ACTION_CONFLICT");
    }, 30_000);

    it("returns the saved problem body for a terminal failed replay, with the current requestId attached", async () => {
      const player = await joinedPlayer("Superseded");
      const idempotencyKey = randomUUID();
      const requestHash = actionRequestHash({
        kind: "start_visit",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      });
      const storedBody = {
        code: "ACTION_SUPERSEDED",
        title: "Action superseded",
        detail: "The earlier action closed safely and changed nothing.",
        fieldErrors: [],
      };

      await db().pool.query(
        `INSERT INTO public.player_actions
         (town_id, id, player_id, idempotency_key, action_kind, request_hash,
          request_payload, target_actor_id, target_entity_id, status,
          response_status, response_payload, error_code, completed_at,
          attempt_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'start_visit', $5, '{}', NULL, NULL, 'failed',
               409, $6, $7, $8, 1, $8, $8)`,
        [
          townId,
          randomUUID(),
          player.playerId,
          idempotencyKey,
          requestHash,
          JSON.stringify(storedBody),
          storedBody.code,
          new Date(),
        ],
      );

      const { response } = await routeRequest(
        actionRequest(townId, player.cookie, idempotencyKey, { kind: "start_visit" }),
        "req_current",
        config,
      );
      expect(response.status).toBe(409);
      const body = parseBody(response.body);
      expect(body["code"]).toBe("ACTION_SUPERSEDED");
      expect(body["requestId"]).toBe("req_current");
    }, 30_000);
  },
);
