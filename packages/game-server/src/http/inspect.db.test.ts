/**
 * `POST /api/v1/towns/{townId}/actions` acceptance suite for `inspect`
 * (`P3-11`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CompletedActionResponseSchema,
  PlayerViewSchema,
} from "@the-town-remembers/http-contracts";
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

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — inspect", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;

  let oldChapelId: string;
  let reedsGardenId: string;
  let lanternInnId: string;

  let emptyBellFrameId: string;
  let squareBenchGlintId: string;
  let innHearthId: string;
  let chapelLaneHedgeId: string;
  let shroudedShapeId: string;
  let chapelThresholdId: string;

  let nessasFieldLensId: string;
  let guardDispatchSealId: string;
  let festivalBellId: string;
  let oldChapelKeyId: string;

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

    const locations = await handle.pool.query<{ id: string; entity_key: string }>(
      `SELECT id, entity_key FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location'`,
      [townId],
    );
    const locationByKey = new Map(
      locations.rows.map((row) => [row.entity_key, row.id]),
    );
    oldChapelId = locationByKey.get("old_chapel")!;
    reedsGardenId = locationByKey.get("reeds_garden")!;
    lanternInnId = locationByKey.get("lantern_inn")!;

    const inspectables = await handle.pool.query<{
      id: string;
      inspectable_key: string;
    }>(`SELECT id, inspectable_key FROM public.inspectables WHERE town_id = $1`, [
      townId,
    ]);
    const inspectableByKey = new Map(
      inspectables.rows.map((row) => [row.inspectable_key, row.id]),
    );
    emptyBellFrameId = inspectableByKey.get("empty_bell_frame")!;
    squareBenchGlintId = inspectableByKey.get("square_bench_glint")!;
    innHearthId = inspectableByKey.get("inn_hearth")!;
    chapelLaneHedgeId = inspectableByKey.get("chapel_lane_hedge")!;
    shroudedShapeId = inspectableByKey.get("shrouded_shape")!;
    chapelThresholdId = inspectableByKey.get("chapel_threshold")!;

    const items = await handle.pool.query<{ id: string; entity_key: string }>(
      `SELECT id, entity_key FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'item'`,
      [townId],
    );
    const itemByKey = new Map(items.rows.map((row) => [row.entity_key, row.id]));
    nessasFieldLensId = itemByKey.get("nessas_field_lens")!;
    guardDispatchSealId = itemByKey.get("guard_dispatch_seal")!;
    festivalBellId = itemByKey.get("festival_bell")!;
    oldChapelKeyId = itemByKey.get("old_chapel_key")!;
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

  async function travel(player: { cookie: string }, destinationLocationId: string) {
    const { response } = await routeRequest(
      actionRequest(townId, player.cookie, randomUUID(), {
        kind: "travel",
        destinationLocationId,
      }),
      "req_travel",
      config,
    );
    expect(response.status).toBe(200);
  }

  async function inspect(
    player: { cookie: string },
    inspectableId: string,
    idempotencyKey: string = randomUUID(),
  ) {
    return routeRequest(
      actionRequest(townId, player.cookie, idempotencyKey, {
        kind: "inspect",
        inspectableId,
      }),
      "req_inspect",
      config,
    );
  }

  async function grantChapelAccessByKey(playerId: string): Promise<void> {
    await db().pool.query(
      `UPDATE public.items
          SET location_entity_id = NULL, location_entity_type = NULL, held_by_actor_id = $2
        WHERE town_id = $1 AND id = $3`,
      [townId, playerId, oldChapelKeyId],
    );
  }

  it("acceptance 1/2: a first inspect is new_to_town and creates exactly one board entry", async () => {
    const player = await joinedPlayer("First Looker");
    const { response } = await inspect(player, emptyBellFrameId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = body as {
      result: {
        discovery: string;
        clue?: { clueId: string; firstContributor: { id: string } };
      };
    };
    expect(result.result.discovery).toBe("new_to_town");
    expect(result.result.clue?.firstContributor.id).toBe(player.playerId);

    const boardEntries = await db().pool.query(
      `SELECT id FROM public.case_board_entries WHERE town_id = $1 AND clue_id = $2`,
      [townId, result.result.clue!.clueId],
    );
    expect(boardEntries.rows).toHaveLength(1);
  }, 30_000);

  it("acceptance 1/2/4: a repeat by the same player is already_discovered_by_player, no_change, and writes nothing", async () => {
    const player = await joinedPlayer("Repeat Looker");
    await inspect(player, emptyBellFrameId);

    const discoveriesBefore = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.clue_discoveries WHERE town_id = $1",
      [townId],
    );
    const boardBefore = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.case_board_entries WHERE town_id = $1",
      [townId],
    );

    const { response } = await inspect(player, emptyBellFrameId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("no_change");
    expect((body as { result: { discovery: string } }).result.discovery).toBe(
      "already_discovered_by_player",
    );

    const discoveriesAfter = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.clue_discoveries WHERE town_id = $1",
      [townId],
    );
    const boardAfter = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.case_board_entries WHERE town_id = $1",
      [townId],
    );
    expect(discoveriesAfter.rows[0]!.n).toBe(discoveriesBefore.rows[0]!.n);
    expect(boardAfter.rows[0]!.n).toBe(boardBefore.rows[0]!.n);
  }, 30_000);

  it("acceptance 1/2: a second player's first look is new_to_player and creates no second board entry", async () => {
    const first = await joinedPlayer("Original Discoverer");
    const second = await joinedPlayer("Second Discoverer");
    await travel(first, lanternInnId);
    await travel(second, lanternInnId);
    const firstOutcome = await inspect(first, innHearthId);
    const firstBody = CompletedActionResponseSchema.parse(
      parseBody(firstOutcome.response.body),
    );
    const clueId = (firstBody as { result: { clue?: { clueId: string } } }).result.clue!
      .clueId;

    const boardBefore = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.case_board_entries WHERE town_id = $1 AND clue_id = $2",
      [townId, clueId],
    );

    const { response } = await inspect(second, innHearthId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    expect((body as { result: { discovery: string } }).result.discovery).toBe(
      "new_to_player",
    );

    const boardAfter = await db().pool.query(
      "SELECT count(*)::int AS n FROM public.case_board_entries WHERE town_id = $1 AND clue_id = $2",
      [townId, clueId],
    );
    expect(boardAfter.rows[0]!.n).toBe(boardBefore.rows[0]!.n);

    const discoveries = await db().pool.query<{ readonly player_id: string }>(
      "SELECT player_id FROM public.clue_discoveries WHERE town_id = $1 AND clue_id = $2",
      [townId, clueId],
    );
    expect(discoveries.rows.map((row) => row.player_id).toSorted()).toStrictEqual(
      [first.playerId, second.playerId].toSorted(),
    );
  }, 30_000);

  it("acceptance 1/5: none for a clue-less inspectable, which still portably reveals its item into inventory", async () => {
    const player = await joinedPlayer("Bench Looker");
    const { response } = await inspect(player, squareBenchGlintId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    expect((body as { result: { discovery: string } }).result.discovery).toBe("none");

    const revealed = (
      body as {
        result: { revealedItem?: { itemId: string; custody: { kind: string } } };
      }
    ).result.revealedItem;
    expect(revealed?.itemId).toBe(nessasFieldLensId);
    expect(revealed?.custody).toStrictEqual({ kind: "player_inventory" });

    const row = await db().pool.query<{ held_by_actor_id: string | null }>(
      "SELECT held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2",
      [townId, nessasFieldLensId],
    );
    expect(row.rows[0]!.held_by_actor_id).toBe(player.playerId);

    const view = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_view",
      config,
    );
    const parsedView = PlayerViewSchema.parse(parseBody(view.response.body));
    expect(parsedView.inventory.map((item) => item.itemId)).toContain(
      nessasFieldLensId,
    );
  }, 30_000);

  it("acceptance 3: two players concurrently inspecting the same undiscovered inspectable produce one board entry, two discoveries, and correctly ordered contributors", async () => {
    const first = await joinedPlayer("Racer A");
    const second = await joinedPlayer("Racer B");
    await travel(first, reedsGardenId);
    await travel(second, reedsGardenId);

    const [outcomeA, outcomeB] = await Promise.all([
      inspect(first, chapelLaneHedgeId),
      inspect(second, chapelLaneHedgeId),
    ]);

    const bodyA = CompletedActionResponseSchema.parse(
      parseBody(outcomeA.response.body),
    );
    const bodyB = CompletedActionResponseSchema.parse(
      parseBody(outcomeB.response.body),
    );
    expect(bodyA.outcome).toBe("applied");
    expect(bodyB.outcome).toBe("applied");

    const clueId = (bodyA as { result: { clue?: { clueId: string } } }).result.clue!
      .clueId;
    const boardEntries = await db().pool.query(
      "SELECT id FROM public.case_board_entries WHERE town_id = $1 AND clue_id = $2",
      [townId, clueId],
    );
    expect(boardEntries.rows).toHaveLength(1);

    const discoveries = await db().pool.query(
      "SELECT player_id FROM public.clue_discoveries WHERE town_id = $1 AND clue_id = $2",
      [townId, clueId],
    );
    expect(discoveries.rows).toHaveLength(2);

    // The item reveal races the same way, and settles to exactly one owner.
    const sealRow = await db().pool.query<{ held_by_actor_id: string | null }>(
      "SELECT held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2",
      [townId, guardDispatchSealId],
    );
    expect([first.playerId, second.playerId]).toContain(
      sealRow.rows[0]!.held_by_actor_id,
    );

    const laterBody = CompletedActionResponseSchema.parse(
      parseBody((await inspect(first, chapelLaneHedgeId, randomUUID())).response.body),
    );
    const contributors = (
      laterBody as {
        result: {
          clue?: { contributors: { id: string }[]; firstContributor: { id: string } };
        };
      }
    ).result.clue!;
    expect(contributors.contributors).toHaveLength(2);
    expect(contributors.firstContributor.id).toBe(contributors.contributors[0]!.id);
  }, 30_000);

  it("acceptance 5: a non-portable reveal (the bell) never enters inventory and leaves held_by_actor_id null", async () => {
    const player = await joinedPlayer("Bell Finder");
    await grantChapelAccessByKey(player.playerId);
    await travel(player, oldChapelId);

    const { response } = await inspect(player, shroudedShapeId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    const revealed = (
      body as {
        result: {
          revealedItem?: {
            itemId: string;
            custody: { kind: string; locationId?: string };
          };
        };
      }
    ).result.revealedItem;
    expect(revealed?.itemId).toBe(festivalBellId);
    expect(revealed?.custody.kind).toBe("location");

    const row = await db().pool.query<{ held_by_actor_id: string | null }>(
      "SELECT held_by_actor_id, revealed_event_id FROM public.items WHERE town_id = $1 AND id = $2",
      [townId, festivalBellId],
    );
    expect(row.rows[0]!.held_by_actor_id).toBeNull();

    const view = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_view",
      config,
    );
    const parsedView = PlayerViewSchema.parse(parseBody(view.response.body));
    expect(parsedView.inventory.map((item) => item.itemId)).not.toContain(
      festivalBellId,
    );
  }, 30_000);

  it("acceptance 6: inspecting from a different location is denied INSPECTABLE_NOT_FOUND, same as an unknown id", async () => {
    const player = await joinedPlayer("Wrong Room");
    // The player is at Festival Square (bootstrap); inn_hearth is at the inn.
    const wrongLocation = await inspect(player, innHearthId);
    const unknown = await inspect(player, randomUUID());
    const opaque = await inspect(player, "opaque-inspectable-id");

    const wrongBody = CompletedActionResponseSchema.parse(
      parseBody(wrongLocation.response.body),
    );
    const unknownBody = CompletedActionResponseSchema.parse(
      parseBody(unknown.response.body),
    );
    const opaqueBody = CompletedActionResponseSchema.parse(
      parseBody(opaque.response.body),
    );
    expect(wrongBody.outcome).toBe("denied");
    expect((wrongBody as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "INSPECTABLE_NOT_FOUND",
    );
    expect((unknownBody as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "INSPECTABLE_NOT_FOUND",
    );
    expect((opaqueBody as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "INSPECTABLE_NOT_FOUND",
    );
  }, 30_000);

  it("acceptance 6: inspecting an inspectable in a locked location is denied INSPECTABLE_NOT_FOUND", async () => {
    const player = await joinedPlayer("Chapel Blocked");
    const { response } = await inspect(player, chapelThresholdId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    expect((body as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "INSPECTABLE_NOT_FOUND",
    );
  }, 30_000);

  it("acceptance 7: the clue field carries only clueId, title, description, firstContributor, and contributors", async () => {
    const player = await joinedPlayer("Shape Checker");
    const { response } = await inspect(player, emptyBellFrameId);
    const body = parseBody(response.body);
    const clue = (body["result"] as { clue: Record<string, unknown> }).clue;
    expect(Object.keys(clue).toSorted()).toStrictEqual(
      ["clueId", "contributors", "description", "firstContributor", "title"].toSorted(),
    );
  }, 30_000);

  it("denies an away player with VISIT_NOT_ACTIVE", async () => {
    const player = await joinedPlayer("Away Inspector");
    const visit = await db().pool.query<{
      id: string;
      started_by_action_id: string;
      start_revision: number;
    }>(
      `SELECT id, started_by_action_id, start_revision FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId],
    );
    const row = visit.rows[0]!;
    await db().pool.query(
      `UPDATE public.player_visits
          SET status = 'ended', end_revision = $3, ended_by_action_id = $4,
              end_reason = 'left_town', ended_at = $5
        WHERE town_id = $1 AND id = $2`,
      [townId, row.id, row.start_revision, row.started_by_action_id, new Date()],
    );

    const { response } = await inspect(player, emptyBellFrameId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    expect((body as { result: { reasonCode: string } }).result.reasonCode).toBe(
      "VISIT_NOT_ACTIVE",
    );
  }, 30_000);

  it("guards the town revision: never inserts a second board entry once boardEntryAlreadyExists", async () => {
    const player = await joinedPlayer("Guard Checker");
    await inspect(player, emptyBellFrameId);
    const clue = await db().pool.query<{ id: string }>(
      "SELECT id FROM public.clues WHERE town_id = $1 AND clue_key = 'bent_clapper_pin'",
      [townId],
    );
    const another = await joinedPlayer("Guard Checker Two");
    await inspect(another, emptyBellFrameId);

    const boardEntries = await db().pool.query(
      "SELECT id FROM public.case_board_entries WHERE town_id = $1 AND clue_id = $2",
      [townId, clue.rows[0]!.id],
    );
    expect(boardEntries.rows).toHaveLength(1);
  }, 30_000);
});
