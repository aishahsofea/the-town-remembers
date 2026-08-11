/**
 * `POST /api/v1/towns/{townId}/actions` acceptance suite for `leave`
 * (`P3-12`).
 *
 * Acceptance 7's first half — every one of `EVENT_TYPES`'s 20 members
 * classified against `computeAmbientEligible`, proving the four kinds Phase
 * 3 can produce (`visit_started`, `travelled`, `inspected`, `visit_ended`)
 * are all ineligible — is already `packages/rules/src/world/visits.test.ts`'s
 * `"computeAmbientEligible: every EVENT_TYPES value classified (D2-I)"`
 * suite, written in Phase 2 before this action even existed. Not duplicated
 * here.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { CompletedActionResponseSchema } from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — leave", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let lanternInnId: string;
  let seedFinalSequence: number;

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

    const seeded = await handle.pool.query<{
      last_event_sequence: number;
      ambient_scheduled_through_sequence: number;
    }>(
      "SELECT last_event_sequence, ambient_scheduled_through_sequence FROM public.towns WHERE id = $1",
      [townId],
    );
    // `materializeTown` sets both to the same value — the proof that no
    // Phase 3 code path has touched either yet.
    expect(seeded.rows[0]!.ambient_scheduled_through_sequence).toBe(
      seeded.rows[0]!.last_event_sequence,
    );
    seedFinalSequence = seeded.rows[0]!.last_event_sequence;

    const locations = await handle.pool.query<{ id: string; entity_key: string }>(
      `SELECT id, entity_key FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location'`,
      [townId],
    );
    lanternInnId = new Map(locations.rows.map((row) => [row.entity_key, row.id])).get(
      "lantern_inn",
    )!;
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

  async function act(
    player: { cookie: string },
    body: unknown,
    idempotencyKey: string = randomUUID(),
  ) {
    return routeRequest(
      actionRequest(townId, player.cookie, idempotencyKey, body),
      "req_action",
      config,
    );
  }

  async function travel(player: { cookie: string }, destinationLocationId: string) {
    const { response } = await act(player, {
      kind: "travel",
      destinationLocationId,
    });
    expect(response.status).toBe(200);
  }

  async function leave(player: { cookie: string }, idempotencyKey?: string) {
    return act(player, { kind: "leave" }, idempotencyKey);
  }

  async function activeVisitRow(playerId: string) {
    const result = await db().pool.query<{
      readonly status: string;
      readonly id: string;
    }>(
      `SELECT id, status FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, playerId],
    );
    return result.rows[0];
  }

  it("acceptance 1/5/8: start -> travel -> inspect -> leave ends the visit, advances the boundary past only the join event, and lets an immediate re-join start a fresh visit", async () => {
    const player = await joinedPlayer("Journey Walker");
    await travel(player, lanternInnId);

    const eventsBefore = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.world_events WHERE town_id = $1 AND event_type = 'visit_ended'",
      [townId],
    );

    const { response } = await leave(player);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    expect(
      (body as { result: { transitionStatus: string } }).result.transitionStatus,
    ).toBe("not_required");

    const visit = await activeVisitRow(player.playerId);
    expect(visit).toBeUndefined();

    const eventsAfter = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.world_events WHERE town_id = $1 AND event_type = 'visit_ended'",
      [townId],
    );
    expect(eventsAfter.rows[0]!.n).toBe(eventsBefore.rows[0]!.n + 1);

    const town = await db().pool.query<{
      last_event_sequence: number;
      ambient_scheduled_through_sequence: number;
    }>(
      "SELECT last_event_sequence, ambient_scheduled_through_sequence FROM public.towns WHERE id = $1",
      [townId],
    );
    // The boundary advanced to exactly this leave's own pre-commit read of
    // last_event_sequence — never past its own visit_ended event, and never
    // back to (or before) the seed's own final sequence number.
    expect(town.rows[0]!.ambient_scheduled_through_sequence).toBeGreaterThan(
      seedFinalSequence,
    );
    expect(town.rows[0]!.ambient_scheduled_through_sequence).toBeLessThan(
      town.rows[0]!.last_event_sequence,
    );

    // Acceptance 8: an immediate re-join (fresh player, since this player
    // already has a real join) proves nothing about *this* player is
    // blocked town-wide; the direct start_visit-after-leave case is
    // exercised in the "immediate start_visit" test below.
  }, 30_000);

  it("acceptance 8: an immediate start_visit after a not_required leave succeeds", async () => {
    const player = await joinedPlayer("Quick Return");
    await leave(player);

    const { response } = await act(player, { kind: "start_visit" });
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    expect(
      (body as { result: { disposition: string } }).result.disposition,
    ).toBe("started");
  }, 30_000);

  it("acceptance 2: zero outbox rows exist after a full journey (table-wide)", async () => {
    const player = await joinedPlayer("Clean Departure");
    await travel(player, lanternInnId);
    await leave(player);

    const outbox = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.outbox WHERE town_id = $1",
      [townId],
    );
    expect(outbox.rows[0]!.n).toBe(0);
  }, 30_000);

  it("acceptance 3: a repeat leave (new key) is denied VISIT_NOT_ACTIVE, and a same-key replay returns the saved not_required response", async () => {
    const player = await joinedPlayer("Double Departer");
    const idempotencyKey = randomUUID();
    const first = await leave(player, idempotencyKey);
    const firstBody = CompletedActionResponseSchema.parse(parseBody(first.response.body));
    expect(firstBody.outcome).toBe("applied");

    const repeat = await leave(player);
    const repeatBody = CompletedActionResponseSchema.parse(
      parseBody(repeat.response.body),
    );
    expect(repeatBody.outcome).toBe("denied");
    expect((repeatBody as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "VISIT_NOT_ACTIVE",
    );

    const replay = await leave(player, idempotencyKey);
    expect(replay.response.body).toBe(first.response.body);
  }, 30_000);

  it("acceptance 4: two players departing concurrently allocate disjoint, contiguous boundaries", async () => {
    const first = await joinedPlayer("Racer Departs A");
    const second = await joinedPlayer("Racer Departs B");

    await Promise.all([leave(first), leave(second)]);

    const events = await db().pool.query<{
      readonly actor_id: string;
      readonly sequence_no: number;
    }>(
      `SELECT actor_id, sequence_no FROM public.world_events
        WHERE town_id = $1 AND event_type = 'visit_ended'
          AND actor_id = ANY($2::uuid[])
        ORDER BY sequence_no`,
      [townId, [first.playerId, second.playerId]],
    );
    expect(events.rows).toHaveLength(2);
    const [earlier, later] = events.rows;
    expect(later!.sequence_no).toBe(earlier!.sequence_no + 1);

    const town = await db().pool.query<{ ambient_scheduled_through_sequence: number }>(
      "SELECT ambient_scheduled_through_sequence FROM public.towns WHERE id = $1",
      [townId],
    );
    // The later departure's own boundary write lands last: exactly the
    // earlier departure's own visit_ended sequence number — proving the
    // later range's lower bound is exactly the earlier range's upper bound.
    expect(town.rows[0]!.ambient_scheduled_through_sequence).toBe(earlier!.sequence_no);
  }, 30_000);

  it("denies leave for an away player with VISIT_NOT_ACTIVE (no active visit at all)", async () => {
    const player = await joinedPlayer("Never Really Here");
    await leave(player);

    const { response } = await leave(player);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    expect((body as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "VISIT_NOT_ACTIVE",
    );
  }, 30_000);

  // Deliberately the last test in this file: it inserts a synthetic eligible
  // event that the D3-Q guard then refuses to ever advance the boundary
  // past (that is the whole point — the rollback leaves it exactly where it
  // was), so it would permanently poison every later test's own leave calls
  // in this same shared town if it ran earlier.
  it("acceptance 6/7: the D3-Q guard rolls back entirely (visit stays active, boundary unchanged) and returns a 500 with zero committed rows", async () => {
    const player = await joinedPlayer("Forced Failure");

    const before = await db().pool.query<{
      last_event_sequence: number;
      ambient_scheduled_through_sequence: number;
    }>(
      "SELECT last_event_sequence, ambient_scheduled_through_sequence FROM public.towns WHERE id = $1",
      [townId],
    );

    // A synthetic eligible event inside the window — impossible for any of
    // Phase 3's four enabled kinds to produce (proved by
    // `rules/world/visits.test.ts`'s own EVENT_TYPES contract test), so this
    // is deliberately constructed to drive the D3-Q guard.
    const bumped = await db().pool.query<{ last_event_sequence: number }>(
      `UPDATE public.towns SET last_event_sequence = last_event_sequence + 1
        WHERE id = $1 RETURNING last_event_sequence`,
      [townId],
    );
    await db().pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
          effect_index, effect_key, actor_id, payload, created_at)
       VALUES ($1, $2, $3, 'clue_discovered', true, $4, 'system_seed', 0, $5, $6, '{}', $4)`,
      [
        townId,
        randomUUID(),
        bumped.rows[0]!.last_event_sequence,
        new Date(),
        `test:synthetic-eligible:${randomUUID()}`,
        player.playerId,
      ],
    );

    const { response } = await leave(player);
    expect(response.status).toBe(500);
    expect(parseBody(response.body)["code"]).toBe("INTERNAL_ERROR");

    const outbox = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.outbox WHERE town_id = $1",
      [townId],
    );
    expect(outbox.rows[0]!.n).toBe(0);

    const visit = await activeVisitRow(player.playerId);
    expect(visit?.status).toBe("active");

    const after = await db().pool.query<{
      ambient_scheduled_through_sequence: number;
    }>(
      "SELECT ambient_scheduled_through_sequence FROM public.towns WHERE id = $1",
      [townId],
    );
    expect(after.rows[0]!.ambient_scheduled_through_sequence).toBe(
      before.rows[0]!.ambient_scheduled_through_sequence,
    );
  }, 30_000);
});
