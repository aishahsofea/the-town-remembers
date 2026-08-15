/**
 * `POST /api/v1/towns/{townId}/actions` acceptance suite for `show`
 * (`P4-14`).
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

import { createShowActionHandler } from "../application/actions/inputs/show.js";
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

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — show", () => {
  let database: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let selectionCalls = 0;

  let corinId: string;
  let nessaId: string;

  let emptyBellFrameId: string;
  let squareBenchGlintId: string;

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

    const inspectables = await database.pool.query<{
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

    const showActionHandler = createShowActionHandler({
      selectDialogue(params) {
        selectionCalls += 1;
        return Promise.resolve({
          npcId: params.assembled.trustedContext.npc_profile.npc_id,
          text: "I see.",
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
      showActionHandler,
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
      body: JSON.stringify({ displayName: `Shower ${randomUUID().slice(0, 6)}` }),
      sourceIp: randomUUID(),
    };
    const { response } = await routeRequest(request, "req_join", config);
    expect(response.status).toBe(201);
    const player = parseBody(response.body)["player"] as { readonly id: string };
    return { playerId: player.id, cookie: cookiePair(response.cookies[0]!) };
  }

  async function inspect(
    player: { readonly cookie: string },
    inspectableId: string,
  ): Promise<Record<string, unknown>> {
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
        body: JSON.stringify({ kind: "inspect", inspectableId }),
        sourceIp: undefined,
      },
      "req_inspect",
      config,
    );
    expect(response.status).toBe(200);
    return parseBody(response.body);
  }

  async function show(
    player: { readonly cookie: string },
    npcId: string,
    evidenceRef: { kind: "clue"; clueId: string } | { kind: "item"; itemId: string },
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
        body: JSON.stringify({ kind: "show", npcId, evidenceRef }),
        sourceIp: undefined,
      },
      "req_show",
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

  it("denies Show when the player is not co-located with the target NPC", async () => {
    const player = await joinPlayer();
    // A freshly-joined player starts at Festival Square with Corin; Nessa is
    // at Reeds Garden.
    const { response } = await show(player, nessaId, {
      kind: "clue",
      clueId: randomUUID(),
    });
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    if (body.outcome === "denied")
      expect(body.result.reasonCode).toBe("NPC_NOT_PRESENT");
  });

  it("denies an item Show when the player does not hold the item", async () => {
    const player = await joinPlayer();
    const lensId = await itemId("nessas_field_lens");
    const { response } = await show(player, corinId, { kind: "item", itemId: lensId });
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    if (body.outcome === "denied")
      expect(body.result.reasonCode).toBe("EVIDENCE_NOT_AUTHORIZED");
  });

  it("a no-effect item, once held, produces structuredEffect none", async () => {
    const player = await joinPlayer();
    await inspect(player, squareBenchGlintId);
    const lensId = await itemId("nessas_field_lens");
    await db().pool.query(
      `UPDATE public.items
          SET held_by_actor_id = $2, location_entity_id = NULL, location_entity_type = NULL
        WHERE town_id = $1 AND id = $3`,
      [townId, player.playerId, lensId],
    );

    const { response } = await show(player, corinId, { kind: "item", itemId: lensId });
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    const result = ActionResultSchemaByKind.show.parse(body.result);
    expect(result.structuredEffect).toBe("none");
    expect(result.appliedClueIds).toStrictEqual([]);
  });

  it("another player showing a town-discovered clue succeeds and applies structured effects to every linked claim once", async () => {
    const discoverer = await joinPlayer();
    const discovery = await inspect(discoverer, emptyBellFrameId);
    const clueId = (
      (discovery["result"] as { clue?: { clueId: string } }).clue as { clueId: string }
    ).clueId;

    const shower = await joinPlayer();
    const beforeSelections = selectionCalls;
    const { response } = await show(shower, corinId, { kind: "clue", clueId });
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");
    expect(selectionCalls - beforeSelections).toBe(1);
    const result = ActionResultSchemaByKind.show.parse(body.result);
    expect(result.structuredEffect).toBe("applied");
    expect(result.appliedClueIds).toStrictEqual([clueId]);

    const evidenceRows = await db().pool.query(
      `SELECT evidence_kind, signed_weight FROM public.belief_evidence
        WHERE town_id = $1 AND npc_id = $2 AND clue_id = $3
        ORDER BY signed_weight`,
      [townId, corinId, clueId],
    );
    // `bent_clapper_pin` supports lark_damaged_bell (+70) and contradicts
    // lark_did_not_damage_bell (-70) — both authored effects apply, and
    // neither claim was ever confirmed to Corin, so this is ordinary
    // evidence, not a caught lie (docs/009 "Caught lies").
    expect(evidenceRows.rows).toStrictEqual([
      { evidence_kind: "contradiction", signed_weight: -70 },
      { evidence_kind: "physical_clue", signed_weight: 70 },
    ]);

    const relationshipReasons = await db().pool.query<{ reason_kind: string }>(
      `SELECT reason_kind FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corinId, shower.playerId],
    );
    expect(relationshipReasons.rows.map((row) => row.reason_kind)).toStrictEqual([
      "evidence_presented",
    ]);

    // A repeat Show of the identical clue by the same player is a safe
    // no-op: no second belief_evidence row, no second relationship row.
    const { response: repeat } = await show(shower, corinId, { kind: "clue", clueId });
    const repeatBody = CompletedActionResponseSchema.parse(parseBody(repeat.body));
    const repeatResult = ActionResultSchemaByKind.show.parse(repeatBody.result);
    expect(repeatResult.structuredEffect).toBe("none");
    const evidenceAfterRepeat = await db().pool.query(
      `SELECT count(*) AS count FROM public.belief_evidence
        WHERE town_id = $1 AND npc_id = $2 AND clue_id = $3`,
      [townId, corinId, clueId],
    );
    expect(evidenceAfterRepeat.rows[0]!["count"]).toBe(2);
    const relationshipAfterRepeat = await db().pool.query(
      `SELECT count(*) AS count FROM public.relationship_changes
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corinId, shower.playerId],
    );
    expect(relationshipAfterRepeat.rows[0]!["count"]).toBe(1);
  });

  it("grants Corin's chapel capability once the gate is met, and never re-grants it", async () => {
    const discoverer = await joinPlayer();
    const cartTracks = await db().pool.query<{ id: string }>(
      `SELECT id FROM public.inspectables WHERE town_id = $1 AND inspectable_key = $2`,
      [townId, "guard_cart_tracks"],
    );
    const discovery = await inspect(discoverer, cartTracks.rows[0]!.id);
    const clueId = (
      (discovery["result"] as { clue?: { clueId: string } }).clue as { clueId: string }
    ).clueId;

    const shower = await joinPlayer();
    await db().pool.query(
      `INSERT INTO public.npc_player_relationships
         (town_id, npc_id, player_id, trust_score, suspicion_score, revision, created_at, updated_at)
       VALUES ($1, $2, $3, 50, 0, 0, now(), now())
       ON CONFLICT (town_id, npc_id, player_id)
       DO UPDATE SET trust_score = 50, suspicion_score = 0`,
      [townId, corinId, shower.playerId],
    );

    const { response } = await show(shower, corinId, { kind: "clue", clueId });
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("applied");

    const grants = await db().pool.query(
      `SELECT status FROM public.player_capabilities
        WHERE town_id = $1 AND player_id = $2 AND capability_key = 'enter_old_chapel'`,
      [townId, shower.playerId],
    );
    expect(grants.rows).toStrictEqual([{ status: "granted" }]);

    // Re-showing the identical, already-recorded clue must not insert a
    // second grant row — `alreadyGranted` short-circuits the gate check.
    const { response: repeat } = await show(shower, corinId, { kind: "clue", clueId });
    const repeatBody = CompletedActionResponseSchema.parse(parseBody(repeat.body));
    expect(repeatBody.outcome).toBe("applied");

    const grantsAfter = await db().pool.query(
      `SELECT count(*) AS count FROM public.player_capabilities
        WHERE town_id = $1 AND player_id = $2 AND capability_key = 'enter_old_chapel'`,
      [townId, shower.playerId],
    );
    expect(grantsAfter.rows[0]!["count"]).toBe(1);
  });
});
