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

import {
  createNormalizeClaimActionHandler,
  type NormalizeClaimSelection,
} from "../application/actions/inputs/normalize-claim.js";
import { ModelSelectionUnavailableError } from "../application/actions/model-executor.js";
import { routeRequest, type RouterConfig } from "./router.js";
import type { HttpRequest } from "./types.js";

const APP_ORIGIN = "https://town.example";
const SECURITY_CONFIG: SecurityConfig = {
  judgeCode: "test-judge-code-not-real",
  inviteSigningKeys: [{ version: "v1", key: new Uint8Array(32).fill(7) }],
  sessionTokenPepper: "B".repeat(43),
  ipHashSecret: "C".repeat(43),
};

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

function normalizedSelection(
  subjectEntityId: string,
  objectEntityId: string,
): NormalizeClaimSelection {
  return {
    npcId: "",
    text: "Corin Hale was at The Lantern Inn (on festival night).",
    responseMode: "selected",
    outcome: {
      kind: "normalized",
      subjectEntityId,
      subjectEntityType: "character",
      predicate: "was_at",
      objectEntityId,
      objectEntityType: "location",
      polarity: "positive",
      contextKey: "festival_night",
      normalizedKey: "test-normalized-key",
      allegedSource: null,
      canonicalText: "Corin Hale was at The Lantern Inn (on festival night).",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  };
}

const NEEDS_REVISION_SELECTION: NormalizeClaimSelection = {
  npcId: "",
  text: "I can't tell who that's about.",
  responseMode: "selected",
  outcome: { kind: "needs_revision", explanation: "I can't tell who that's about." },
};

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — normalize_claim", () => {
  let database: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let normalizeCalls = 0;
  let nextResult: NormalizeClaimSelection | "unavailable" = "unavailable";
  let normalizedResult: NormalizeClaimSelection;

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

    const entities = await database.pool.query<{
      readonly entity_key: string;
      readonly id: string;
    }>(
      `SELECT entity_key, id FROM public.story_entities
        WHERE town_id = $1 AND entity_key = ANY($2)`,
      [townId, ["corin_hale", "lantern_inn"]],
    );
    const idByKey = new Map(entities.rows.map((row) => [row.entity_key, row.id]));
    normalizedResult = normalizedSelection(
      idByKey.get("corin_hale")!,
      idByKey.get("lantern_inn")!,
    );
    nextResult = normalizedResult;

    const normalizeClaimActionHandler = createNormalizeClaimActionHandler({
      normalizeClaim() {
        normalizeCalls += 1;
        if (nextResult === "unavailable") {
          return Promise.reject(
            new ModelSelectionUnavailableError(503, {
              code: "MODEL_UNAVAILABLE_RETRY_ACTION",
              title: "Model unavailable",
              detail: "That statement could not be classified right now.",
              fieldErrors: [],
            }),
          );
        }
        return Promise.resolve(nextResult);
      },
    });
    config = {
      buildId: "test-build",
      appOrigin: APP_ORIGIN,
      now: () => new Date(),
      pool: database.pool,
      securityConfig: SECURITY_CONFIG,
      enableNpcMutations: true,
      normalizeClaimActionHandler,
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
      body: JSON.stringify({ displayName: `Teller ${randomUUID().slice(0, 6)}` }),
      sourceIp: randomUUID(),
    };
    const { response } = await routeRequest(request, "req_join", config);
    expect(response.status).toBe(201);
    const player = parseBody(response.body)["player"] as { readonly id: string };
    return { playerId: player.id, cookie: cookiePair(response.cookies[0]!) };
  }

  async function coLocatedNpcId(playerId: string): Promise<string> {
    const visit = await db().pool.query<{
      readonly current_location_entity_id: string;
    }>(
      `SELECT current_location_entity_id FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, playerId],
    );
    const npc = await db().pool.query<{ readonly id: string }>(
      `SELECT id FROM public.npcs
        WHERE town_id = $1 AND location_entity_id = $2
        ORDER BY id LIMIT 1`,
      [townId, visit.rows[0]!.current_location_entity_id],
    );
    return npc.rows[0]!.id;
  }

  function normalizeClaimRequest(
    npcId: string,
    text: string,
    cookie: string,
    idempotencyKey: string,
  ): HttpRequest {
    return {
      method: "POST",
      path: `/api/v1/towns/${townId}/actions`,
      headers: new Map([
        ["origin", APP_ORIGIN],
        ["content-type", "application/json"],
        ["cookie", cookie],
        ["idempotency-key", idempotencyKey],
      ]),
      body: JSON.stringify({ kind: "normalize_claim", npcId, text }),
      sourceIp: undefined,
    };
  }

  it("drafts a normalized claim and replays the saved response byte-identically", async () => {
    nextResult = normalizedResult;
    const player = await joinPlayer();
    const npcId = await coLocatedNpcId(player.playerId);
    const idempotencyKey = randomUUID();
    const request = normalizeClaimRequest(
      npcId,
      "Corin was at the inn",
      player.cookie,
      idempotencyKey,
    );

    const beforeCalls = normalizeCalls;
    const first = await routeRequest(request, "req_nc_1", config);
    const replay = await routeRequest(request, "req_nc_2", config);

    expect(first.response.status).toBe(200);
    expect(replay.response.body).toBe(first.response.body);
    expect(normalizeCalls - beforeCalls).toBe(1);

    const body = CompletedActionResponseSchema.parse(parseBody(first.response.body));
    expect(body.kind).toBe("normalize_claim");
    const result = ActionResultSchemaByKind.normalize_claim.parse(body.result);
    if (result.normalizationStatus !== "drafted") throw new Error("expected drafted");
    expect(result.canonicalText).toBe(
      "Corin Hale was at The Lantern Inn (on festival night).",
    );

    const draft = await db().pool.query<{
      readonly status: string;
      readonly original_text: string;
      readonly predicate: string;
    }>(
      `SELECT status, original_text, predicate FROM public.claim_drafts
        WHERE town_id = $1 AND id = $2`,
      [townId, result.claimDraftId],
    );
    expect(draft.rows).toStrictEqual([
      { status: "pending", original_text: "Corin was at the inn", predicate: "was_at" },
    ]);
  }, 60_000);

  it("returns needs_revision with no draft when the model cannot classify the text", async () => {
    nextResult = NEEDS_REVISION_SELECTION;
    const player = await joinPlayer();
    const npcId = await coLocatedNpcId(player.playerId);
    const request = normalizeClaimRequest(
      npcId,
      "something ambiguous",
      player.cookie,
      randomUUID(),
    );

    const { response } = await routeRequest(request, "req_nc_needs_revision", config);
    expect(response.status).toBe(200);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    const result = ActionResultSchemaByKind.normalize_claim.parse(body.result);
    expect(result).toStrictEqual({
      normalizationStatus: "needs_revision",
      explanation: "I can't tell who that's about.",
    });

    const drafts = await db().pool.query(
      `SELECT id FROM public.claim_drafts WHERE town_id = $1 AND player_id = $2`,
      [townId, player.playerId],
    );
    expect(drafts.rows).toStrictEqual([]);
  }, 60_000);

  it("denies normalize_claim when the player is not co-located with the NPC", async () => {
    nextResult = normalizedResult;
    const player = await joinPlayer();
    const request = normalizeClaimRequest(
      randomUUID(),
      "Corin was at the inn",
      player.cookie,
      randomUUID(),
    );

    const beforeCalls = normalizeCalls;
    const { response } = await routeRequest(request, "req_nc_denied", config);
    expect(response.status).toBe(200);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    expect(body.outcome).toBe("denied");
    expect(normalizeCalls).toBe(beforeCalls);
  }, 60_000);

  it("stores a terminal 503 when repair also fails, and replay never calls the model again", async () => {
    nextResult = "unavailable";
    const player = await joinPlayer();
    const npcId = await coLocatedNpcId(player.playerId);
    const idempotencyKey = randomUUID();
    const request = normalizeClaimRequest(
      npcId,
      "an unrepairable statement",
      player.cookie,
      idempotencyKey,
    );

    const beforeCalls = normalizeCalls;
    const first = await routeRequest(request, "req_nc_unavailable_1", config);
    expect(first.response.status).toBe(503);
    const firstBody = parseBody(first.response.body);
    expect(firstBody["code"]).toBe("MODEL_UNAVAILABLE_RETRY_ACTION");

    const replay = await routeRequest(request, "req_nc_unavailable_2", config);
    expect(replay.response.status).toBe(503);
    expect(parseBody(replay.response.body)["code"]).toBe(
      "MODEL_UNAVAILABLE_RETRY_ACTION",
    );
    // The same idempotency key replays the saved terminal failure; it never
    // calls the model a second time (Decision 006: "an intentional retry
    // uses a new key").
    expect(normalizeCalls - beforeCalls).toBe(1);
  }, 60_000);
});
