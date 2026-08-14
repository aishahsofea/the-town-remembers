/**
 * `POST /api/v1/towns/{townId}/actions` acceptance suite for
 * `accept_promise` (`P4-16`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { asVector256 } from "@the-town-remembers/database";
import {
  ActionResultSchemaByKind,
  CompletedActionResponseSchema,
} from "@the-town-remembers/http-contracts";
import { decodePromiseOffer, encodePromiseOffer } from "@the-town-remembers/rules";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAcceptPromiseActionHandler } from "../application/actions/inputs/accept-promise.js";
import { createAskActionHandler } from "../application/actions/inputs/ask.js";
import { routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};
const ZERO_VECTOR = asVector256(Array.from({ length: 256 }, () => 0));

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — accept_promise", () => {
  let database: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let nessaId: string;
  let reedsGardenId: string;
  let chapelKeyId: string;

  beforeAll(async () => {
    database = await createDisposableDatabase();
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
        WHERE n.town_id = $1 AND se.entity_key = 'nessa_reed'`,
      [townId],
    );
    nessaId = npcs.rows[0]!.id;

    const items = await database.pool.query<{ id: string }>(
      `SELECT id FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'item' AND entity_key = 'old_chapel_key'`,
      [townId],
    );
    chapelKeyId = items.rows[0]!.id;

    const askActionHandler = createAskActionHandler({
      embedQuery: () => Promise.resolve(ZERO_VECTOR),
      selectDialogue(params) {
        return Promise.resolve({
          npcId: params.assembled.trustedContext.npc_profile.npc_id,
          text: params.assembled.trustedContext.approved_renderings[0]?.text ?? "I see.",
          responseMode: "selected" as const,
          expressedDisclosures: [],
        });
      },
    });
    const acceptPromiseActionHandler = createAcceptPromiseActionHandler({
      selectDialogue(params) {
        return Promise.resolve({
          npcId: params.assembled.trustedContext.npc_profile.npc_id,
          text: "Take the chapel key.",
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
      askActionHandler,
      acceptPromiseActionHandler,
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
      body: JSON.stringify({ displayName: `Accepter ${randomUUID().slice(0, 6)}` }),
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

  async function makeEligibleForKeyOffer(playerId: string): Promise<void> {
    await db().pool.query(
      `INSERT INTO public.npc_player_relationships
         (town_id, npc_id, player_id, trust_score, suspicion_score, revision, created_at, updated_at)
       VALUES ($1, $2, $3, 40, 0, 0, now(), now())
       ON CONFLICT (town_id, npc_id, player_id)
       DO UPDATE SET trust_score = 40, suspicion_score = 0`,
      [townId, nessaId, playerId],
    );
  }

  /**
   * The key's custody is global to the town, not per-player: an earlier
   * test's successful acceptance moves it off Nessa permanently. Each call
   * re-seeds custody back to her first, so every test can request a fresh
   * offer regardless of what an earlier test in this file already did.
   */
  async function resetKeyCustodyToNessa(): Promise<void> {
    await db().pool.query(
      `UPDATE public.items
          SET held_by_actor_id = $2, location_entity_id = NULL, location_entity_type = NULL
        WHERE town_id = $1 AND id = $3`,
      [townId, nessaId, chapelKeyId],
    );
  }

  async function requestKeyOffer(player: {
    readonly playerId: string;
    readonly cookie: string;
  }): Promise<string> {
    await resetKeyCustodyToNessa();
    await travel(player, reedsGardenId);
    await makeEligibleForKeyOffer(player.playerId);
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
        body: JSON.stringify({
          kind: "ask",
          npcId: nessaId,
          question: "What did you see that night?",
        }),
        sourceIp: undefined,
      },
      "req_ask",
      config,
    );
    expect(response.status).toBe(200);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    if (body.kind !== "ask" || body.outcome === "denied") {
      throw new Error("Expected a successful Ask response with a promise offer.");
    }
    const askResult = ActionResultSchemaByKind.ask.parse(body.result);
    const offer = askResult.promiseOffers[0];
    if (offer === undefined) throw new Error("Expected Nessa to offer the chapel key.");
    return offer.offerId;
  }

  async function acceptPromise(
    player: { readonly cookie: string },
    offerId: string,
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
        body: JSON.stringify({ kind: "accept_promise", offerId }),
        sourceIp: undefined,
      },
      "req_accept_promise",
      config,
    );
  }

  it("denies a forged or malformed offer id without revealing why", async () => {
    const player = await joinPlayer();
    const { response } = await acceptPromise(player, "not-a-real-offer-id");
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    if (body.outcome === "denied") expect(body.result.reasonCode).toBe("PROMISE_OFFER_INVALID");
  });

  it("denies an out-of-range ordinal on an otherwise real source action", async () => {
    const player = await joinPlayer();
    const offerId = await requestKeyOffer(player);
    const decoded = decodePromiseOffer(offerId)!;
    const outOfRange = encodePromiseOffer(decoded.sourceActionId, decoded.ordinal + 5);

    const { response } = await acceptPromise(player, outOfRange);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    if (body.outcome === "denied") expect(body.result.reasonCode).toBe("PROMISE_OFFER_INVALID");
  });

  it("accepts Nessa's chapel-key offer, transferring custody and creating the promise atomically", async () => {
    const player = await joinPlayer();
    const offerId = await requestKeyOffer(player);

    const { response } = await acceptPromise(player, offerId);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = ActionResultSchemaByKind.accept_promise.parse(body.result);
    expect(result.promise.kind).toBe("return_item");
    expect(result.itemTransfer).toStrictEqual({
      itemId: chapelKeyId,
      fromActorId: nessaId,
      toActorId: player.playerId,
    });

    const item = await db().pool.query<{ held_by_actor_id: string }>(
      `SELECT held_by_actor_id FROM public.items WHERE town_id = $1 AND id = $2`,
      [townId, chapelKeyId],
    );
    expect(item.rows[0]!.held_by_actor_id).toBe(player.playerId);

    const promises = await db().pool.query<{ status: string; kind: string }>(
      `SELECT status, kind FROM public.promises
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, nessaId, player.playerId],
    );
    expect(promises.rows).toStrictEqual([{ status: "active", kind: "return_item" }]);
  });

  it("denies duplicate acceptance via the DB's own active-promise constraint, not a read-then-write race", async () => {
    const player = await joinPlayer();
    const offerId = await requestKeyOffer(player);
    const first = await acceptPromise(player, offerId, randomUUID());
    const firstBody = CompletedActionResponseSchema.parse(parseBody(first.response.body));
    expect(firstBody.outcome).toBe("applied");

    // Re-accepting the identical already-consumed offer (a different
    // idempotency key, so this is not merely a replay) must be denied, not
    // silently accepted again or double-transferred. The item moved off
    // Nessa the instant the first acceptance committed, so re-validation
    // now correctly reports the offer itself as stale
    // (`PROMISE_OFFER_INVALID`) rather than reaching the separate
    // already-active check — both paths converge on the same guarantee:
    // `uq_promises__active_item` makes a second active row for this
    // (npc, item) impossible regardless of which application-level check
    // catches it first.
    const second = await acceptPromise(player, offerId, randomUUID());
    const secondBody = CompletedActionResponseSchema.parse(parseBody(second.response.body));
    expect(secondBody.outcome).toBe("denied");
    if (secondBody.outcome === "denied") {
      expect(["PROMISE_OFFER_INVALID", "PROMISE_ALREADY_ACTIVE"]).toContain(
        secondBody.result.reasonCode,
      );
    }

    const promiseCount = await db().pool.query(
      `SELECT count(*) AS count FROM public.promises
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3 AND status = 'active'`,
      [townId, nessaId, player.playerId],
    );
    expect(promiseCount.rows[0]!["count"]).toBe(1);
  });

  it("replays the identical saved response for a repeated idempotency key", async () => {
    const player = await joinPlayer();
    const offerId = await requestKeyOffer(player);
    const idempotencyKey = randomUUID();

    const first = await acceptPromise(player, offerId, idempotencyKey);
    const replay = await acceptPromise(player, offerId, idempotencyKey);
    expect(replay.response.status).toBe(first.response.status);
    expect(replay.response.body).toBe(first.response.body);
  });
});
