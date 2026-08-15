/**
 * `POST /api/v1/towns/{townId}/actions` acceptance suite for `give`
 * (`P4-15`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  ActionResultSchemaByKind,
  CompletedActionResponseSchema,
} from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  useSharedTestDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGiveActionHandler } from "../application/actions/inputs/give.js";
import { routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — give", () => {
  let database: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;

  let corinId: string;
  let nessaId: string;
  let reedsGardenId: string;

  beforeAll(async () => {
    database = await useSharedTestDatabase();
    inviteToken = randomUUID();
    const seeded = await materializeTown(database.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (seeded.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = seeded.value.townId;

    const locations = await database.pool.query<{ id: string; entity_key: string }>(
      `SELECT id, entity_key FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location'`,
      [townId],
    );
    reedsGardenId = locations.rows.find((row) => row.entity_key === "reeds_garden")!.id;

    const npcs = await database.pool.query<{ id: string; character_entity_id: string }>(
      `SELECT n.id, n.character_entity_id FROM public.npcs n
         JOIN public.story_entities se ON se.town_id = n.town_id AND se.id = n.character_entity_id
        WHERE n.town_id = $1 AND se.entity_key = ANY($2)`,
      [townId, ["corin_hale", "nessa_reed"]],
    );
    const characterKeys = await database.pool.query<{ id: string; entity_key: string }>(
      `SELECT id, entity_key FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'character'`,
      [townId],
    );
    const characterKeyById = new Map(
      characterKeys.rows.map((row) => [row.id, row.entity_key]),
    );
    for (const row of npcs.rows) {
      const key = characterKeyById.get(row.character_entity_id);
      if (key === "corin_hale") corinId = row.id;
      if (key === "nessa_reed") nessaId = row.id;
    }

    const giveActionHandler = createGiveActionHandler({
      selectDialogue(params) {
        return Promise.resolve({
          npcId: params.assembled.trustedContext.npc_profile.npc_id,
          text: params.npcAcceptsItem ? "I have it now." : "Keep that for now.",
          responseMode: "selected",
        });
      },
    });

    config = {
      buildId: "test-build",
      appOrigin: APP_ORIGIN,
      now: () => new Date(),
      pool: database.pool,
      securityConfig: SECURITY_CONFIG,
      enableNpcMutations: true,
      giveActionHandler,
    };
  }, 180_000);

  afterAll(async () => {
    await database?.dispose();
  });

  function db(): DisposableDatabase {
    if (database === undefined) throw new Error("database not initialized");
    return database;
  }

  async function joinPlayer(): Promise<{
    readonly playerId: string;
    readonly cookie: string;
  }> {
    const request: HttpRequest = {
      method: "POST",
      path: `/api/v1/invites/${inviteToken}/join`,
      headers: new Map([
        ["origin", APP_ORIGIN],
        ["content-type", "application/json"],
        ["idempotency-key", randomUUID()],
        ["join-attempt-secret", randomBytes(32).toString("base64url")],
      ]),
      body: JSON.stringify({ displayName: `Giver ${randomUUID().slice(0, 6)}` }),
      sourceIp: randomUUID(),
    };
    const { response } = await routeRequest(request, "req_join", config);
    expect(response.status).toBe(201);
    const player = parseBody(response.body)["player"] as { readonly id: string };
    return { playerId: player.id, cookie: cookiePair(response.cookies[0]!) };
  }

  async function travel(
    player: { readonly cookie: string },
    destinationLocationId: string,
  ): Promise<void> {
    const { response } = await routeRequest(
      {
        method: "POST",
        path: `/api/v1/towns/${townId}/actions`,
        headers: new Map([
          ["origin", APP_ORIGIN],
          ["content-type", "application/json"],
          ["cookie", player.cookie],
          ["idempotency-key", randomUUID()],
        ]),
        body: JSON.stringify({ kind: "travel", destinationLocationId }),
        sourceIp: undefined,
      },
      "req_travel",
      config,
    );
    expect(response.status).toBe(200);
  }

  async function give(
    player: { readonly cookie: string },
    npcId: string,
    itemId: string,
    idempotencyKey: string = randomUUID(),
  ) {
    return routeRequest(
      {
        method: "POST",
        path: `/api/v1/towns/${townId}/actions`,
        headers: new Map([
          ["origin", APP_ORIGIN],
          ["content-type", "application/json"],
          ["cookie", player.cookie],
          ["idempotency-key", idempotencyKey],
        ]),
        body: JSON.stringify({ kind: "give", npcId, itemId }),
        sourceIp: undefined,
      },
      "req_give",
      config,
    );
  }

  async function itemId(entityKey: string): Promise<string> {
    const result = await db().pool.query<{ id: string }>(
      `SELECT id FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'item' AND entity_key = $2`,
      [townId, entityKey],
    );
    return result.rows[0]!.id;
  }

  async function grantCustody(playerId: string, giveItemId: string): Promise<void> {
    await db().pool.query(
      `UPDATE public.items
          SET held_by_actor_id = $2, location_entity_id = NULL, location_entity_type = NULL
        WHERE town_id = $1 AND id = $3`,
      [townId, playerId, giveItemId],
    );
  }

  it("denies Give when the player is not co-located with the target NPC", async () => {
    const player = await joinPlayer();
    const { response } = await give(player, nessaId, randomUUID());
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    if (body.outcome === "denied")
      expect(body.result.reasonCode).toBe("NPC_NOT_PRESENT");
  });

  it("denies Give when the player does not hold the item", async () => {
    const player = await joinPlayer();
    const sealId = await itemId("guard_dispatch_seal");
    const { response } = await give(player, corinId, sealId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    if (body.outcome === "denied") expect(body.result.reasonCode).toBe("ITEM_NOT_HELD");
  });

  it("transfers custody and grants requested_item_given for Corin's own requested item", async () => {
    const player = await joinPlayer();
    const sealId = await itemId("guard_dispatch_seal");
    await grantCustody(player.playerId, sealId);

    const { response } = await give(player, corinId, sealId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = ActionResultSchemaByKind.give.parse(body.result);
    expect(result.custody).toBe("transferred");

    const item = await db().pool.query<{ held_by_actor_id: string }>(
      `SELECT held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2`,
      [townId, sealId],
    );
    expect(item.rows[0]!.held_by_actor_id).toBe(corinId);

    const relationshipReasons = await db().pool.query<{ reason_kind: string }>(
      `SELECT reason_kind FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corinId, player.playerId],
    );
    expect(relationshipReasons.rows.map((row) => row.reason_kind)).toStrictEqual([
      "requested_item_given",
    ]);
  });

  it("leaves custody unchanged and grants nothing for an unrequested item", async () => {
    const player = await joinPlayer();
    const lensId = await itemId("nessas_field_lens");
    await grantCustody(player.playerId, lensId);

    // Nessa's own field lens, offered to Corin instead: not his request, no
    // active promise on it — he declines it.
    const { response } = await give(player, corinId, lensId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = ActionResultSchemaByKind.give.parse(body.result);
    expect(result.custody).toBe("unchanged");

    const item = await db().pool.query<{ held_by_actor_id: string | null }>(
      `SELECT held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2`,
      [townId, lensId],
    );
    expect(item.rows[0]!.held_by_actor_id).toBe(player.playerId);

    const relationshipCount = await db().pool.query(
      `SELECT count(*) AS count FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corinId, player.playerId],
    );
    expect(relationshipCount.rows[0]!["count"]).toBe(0);
  });

  async function insertActiveChapelKeyPromise(
    playerId: string,
    keyItemId: string,
  ): Promise<string> {
    const sequence = await db().pool.query<{ next: string }>(
      `SELECT last_event_sequence + 1 AS next FROM public.towns WHERE id = $1`,
      [townId],
    );
    const eventId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, effect_index, effect_key, actor_id, target_actor_id, promise_id,
          payload, created_at)
       VALUES ($1, $2, $3, 'promise_accepted', false, now(), 'system_seed', 0, $4, $5, $6,
               NULL, '{}', now())`,
      [townId, eventId, sequence.rows[0]!.next, `test:${eventId}`, playerId, nessaId],
    );
    await db().pool.query(
      `UPDATE public.towns SET last_event_sequence = last_event_sequence + 1 WHERE id = $1`,
      [townId],
    );
    const promiseId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.promises
         (town_id, id, npc_id, player_id, kind, item_id, status, accepted_event_id,
          terms_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'return_item', $5, 'active', $6, 'return-chapel-key-v1', now(), now())`,
      [townId, promiseId, nessaId, playerId, keyItemId, eventId],
    );
    return promiseId;
  }

  it("fulfils the chapel-key promise when it returns to Nessa", async () => {
    const player = await joinPlayer();
    await travel(player, reedsGardenId);
    const keyId = await itemId("old_chapel_key");
    await grantCustody(player.playerId, keyId);
    const promiseId = await insertActiveChapelKeyPromise(player.playerId, keyId);

    const { response } = await give(player, nessaId, keyId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = ActionResultSchemaByKind.give.parse(body.result);
    expect(result.custody).toBe("transferred");

    const promise = await db().pool.query<{ status: string }>(
      `SELECT status FROM public.promises WHERE town_id = $1 AND id = $2`,
      [townId, promiseId],
    );
    expect(promise.rows[0]!.status).toBe("fulfilled");

    const relationshipReasons = await db().pool.query<{ reason_kind: string }>(
      `SELECT reason_kind FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, nessaId, player.playerId],
    );
    expect(relationshipReasons.rows.map((row) => row.reason_kind)).toStrictEqual([
      "promise_fulfilled",
    ]);
  });

  it("breaks the chapel-key promise when it goes to Corin instead, still transferring custody", async () => {
    const player = await joinPlayer();
    const keyId = await itemId("old_chapel_key");
    await grantCustody(player.playerId, keyId);
    const promiseId = await insertActiveChapelKeyPromise(player.playerId, keyId);

    const { response } = await give(player, corinId, keyId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = ActionResultSchemaByKind.give.parse(body.result);
    expect(result.custody).toBe("transferred");

    const item = await db().pool.query<{ held_by_actor_id: string }>(
      `SELECT held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2`,
      [townId, keyId],
    );
    expect(item.rows[0]!.held_by_actor_id).toBe(corinId);

    const promise = await db().pool.query<{ status: string }>(
      `SELECT status FROM public.promises WHERE town_id = $1 AND id = $2`,
      [townId, promiseId],
    );
    expect(promise.rows[0]!.status).toBe("broken");

    // The consequence lands on Nessa (the promise's own NPC), not Corin
    // (the actual recipient).
    const nessaReasons = await db().pool.query<{ reason_kind: string }>(
      `SELECT reason_kind FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, nessaId, player.playerId],
    );
    expect(nessaReasons.rows.map((row) => row.reason_kind)).toStrictEqual([
      "promise_broken",
    ]);
    const corinReasons = await db().pool.query(
      `SELECT count(*) AS count FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corinId, player.playerId],
    );
    expect(corinReasons.rows[0]!["count"]).toBe(0);
  });

  it("a second Give of an already-transferred unique item is a safe denial with no custody change", async () => {
    // True OS-level concurrency on one item is not reachable over HTTP: a
    // second request from the same player while the first is still
    // processing is rejected outright (`blocked`), and only one player can
    // ever hold a unique item at a time. This exercises the same guarantee
    // (`items`' conditional `expectedRevision` write) the race protects,
    // sequentially: once custody has moved, a second Give attempt reads a
    // fresh, honest `itemHeldByPlayer: false` and denies cleanly rather than
    // silently no-op'ing or double-transferring.
    const giver = await joinPlayer();
    const sealId = await itemId("guard_dispatch_seal");
    await grantCustody(giver.playerId, sealId);
    const before = await db().pool.query<{ revision: number }>(
      `SELECT revision FROM public.items WHERE town_id = $1 AND id = $2`,
      [townId, sealId],
    );
    const revisionBefore = before.rows[0]!.revision;

    const first = await give(giver, corinId, sealId, randomUUID());
    const firstBody = CompletedActionResponseSchema.parse(
      parseBody(first.response.body),
    );
    expect(firstBody.outcome).toBe("applied");

    const second = await give(giver, corinId, sealId, randomUUID());
    const secondBody = CompletedActionResponseSchema.parse(
      parseBody(second.response.body),
    );
    expect(secondBody.outcome).toBe("denied");
    if (secondBody.outcome === "denied") {
      expect(secondBody.result.reasonCode).toBe("ITEM_NOT_HELD");
    }

    const item = await db().pool.query<{ held_by_actor_id: string; revision: number }>(
      `SELECT held_by_actor_id, revision FROM public.items WHERE town_id = $1 AND id = $2`,
      [townId, sealId],
    );
    expect(item.rows[0]!.held_by_actor_id).toBe(corinId);
    // Exactly one conditional write applied — the denial touched nothing.
    expect(item.rows[0]!.revision).toBe(revisionBefore + 1);
  });

  it("replays the identical saved response for a repeated idempotency key", async () => {
    const player = await joinPlayer();
    const sealId = await itemId("guard_dispatch_seal");
    await grantCustody(player.playerId, sealId);
    const idempotencyKey = randomUUID();

    const first = await give(player, corinId, sealId, idempotencyKey);
    const replay = await give(player, corinId, sealId, idempotencyKey);
    expect(replay.response.status).toBe(first.response.status);
    expect(replay.response.body).toBe(first.response.body);
  });
});
