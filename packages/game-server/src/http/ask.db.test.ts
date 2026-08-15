import { createHash, randomBytes, randomUUID } from "node:crypto";

import { asVector256, encodeVector } from "@the-town-remembers/database";
import {
  ActionResultSchemaByKind,
  CompletedActionResponseSchema,
} from "@the-town-remembers/http-contracts";
import { decodePromiseOffer } from "@the-town-remembers/rules";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!.trim();
}

function parseBody(body: string): Record<string, unknown> {
  return JSON.parse(body) as Record<string, unknown>;
}

describe.skipIf(!shouldRunDatabaseTests())("POST /actions — ask", () => {
  let database: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let embeddingCalls = 0;
  let selectionCalls = 0;

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

    const askActionHandler = createAskActionHandler({
      embedQuery(params) {
        embeddingCalls += 1;
        return Promise.resolve(
          params.question.includes("embedding unavailable") ? undefined : ZERO_VECTOR,
        );
      },
      selectDialogue(params) {
        selectionCalls += 1;
        const claimIdByEphemeral = new Map(
          params.assembled.trustedContext.approved_disclosures.map((entry) => [
            entry.disclosure_id,
            entry.claim_id,
          ]),
        );
        const disclosureByClaimId = new Map(
          params.pending.trustedContext.approvedDisclosures.map((entry) => [
            entry.claimId,
            entry,
          ]),
        );
        const ephemeralByClaimId = new Map(
          params.assembled.trustedContext.approved_disclosures.map((entry) => [
            entry.claim_id,
            entry.disclosure_id,
          ]),
        );
        const playerText = params.assembled.input.untrusted_player_text;
        const secretDisclosureId =
          params.assembled.trustedContext.approved_renderings.find((rendering) =>
            rendering.text.includes("The clapper pin, the rope"),
          )?.disclosure_ids[0];
        const secretClaimId =
          secretDisclosureId === undefined
            ? undefined
            : claimIdByEphemeral.get(secretDisclosureId);
        const requestedDisclosures = playerText?.includes("secret offer")
          ? [
              params.pending.trustedContext.approvedDisclosures.find(
                (entry) => entry.claimId === secretClaimId,
              ),
            ].filter((entry) => entry !== undefined)
          : playerText?.includes("provenance")
            ? [
                params.pending.trustedContext.approvedDisclosures.find(
                  (entry) =>
                    entry.parentTransmissionId === null &&
                    entry.sourceEpisodeId !== null,
                ),
                params.pending.trustedContext.approvedDisclosures.find(
                  (entry) => entry.parentTransmissionId !== null,
                ),
              ].filter((entry) => entry !== undefined)
            : [];
        const renderings =
          requestedDisclosures.length === 0
            ? [params.assembled.trustedContext.approved_renderings[0]!]
            : requestedDisclosures.map((disclosure) => {
                const ephemeralId = ephemeralByClaimId.get(disclosure.claimId)!;
                return params.assembled.trustedContext.approved_renderings.find(
                  (rendering) => rendering.disclosure_ids.includes(ephemeralId),
                )!;
              });
        return Promise.resolve({
          npcId: params.assembled.trustedContext.npc_profile.npc_id,
          text: renderings.map((rendering) => rendering.text).join(" "),
          responseMode: "selected" as const,
          expressedDisclosures:
            requestedDisclosures.length > 0
              ? requestedDisclosures
              : renderings.flatMap((rendering) =>
                  rendering.disclosure_ids.flatMap((ephemeralId) => {
                    const claimId = claimIdByEphemeral.get(ephemeralId);
                    const disclosure =
                      claimId === undefined
                        ? undefined
                        : disclosureByClaimId.get(claimId);
                    return disclosure === undefined ? [] : [disclosure];
                  }),
                ),
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
      body: JSON.stringify({ displayName: `Asker ${randomUUID().slice(0, 6)}` }),
      sourceIp: randomUUID(),
    };
    const { response } = await routeRequest(request, "req_join", config);
    expect(response.status).toBe(201);
    const player = parseBody(response.body)["player"] as { readonly id: string };
    return { playerId: player.id, cookie: cookiePair(response.cookies[0]!) };
  }

  it("commits grounded effects once and replays the saved response byte-identically", async () => {
    const player = await joinPlayer();
    const visit = await db().pool.query<{
      readonly id: string;
      readonly current_location_entity_id: string;
    }>(
      `SELECT id, current_location_entity_id FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId],
    );
    const npc = await db().pool.query<{ readonly id: string }>(
      `SELECT id FROM public.npcs
        WHERE town_id = $1 AND location_entity_id = $2
        ORDER BY id LIMIT 1`,
      [townId, visit.rows[0]!.current_location_entity_id],
    );
    const npcId = npc.rows[0]!.id;
    const idempotencyKey = randomUUID();
    const request: HttpRequest = {
      method: "POST",
      path: `/api/v1/towns/${townId}/actions`,
      headers: new Map([
        ["origin", APP_ORIGIN],
        ["content-type", "application/json"],
        ["cookie", player.cookie],
        ["idempotency-key", idempotencyKey],
      ]),
      body: JSON.stringify({
        kind: "ask",
        npcId,
        question: "What did you notice? (embedding unavailable)",
      }),
      sourceIp: undefined,
    };

    const beforeEmbedding = embeddingCalls;
    const beforeSelection = selectionCalls;
    const first = await routeRequest(request, "req_ask_1", config);
    const replay = await routeRequest(request, "req_ask_2", config);

    expect(first.response.status).toBe(200);
    expect(replay.response.status).toBe(200);
    expect(replay.response.body).toBe(first.response.body);
    const body = CompletedActionResponseSchema.parse(parseBody(first.response.body));
    expect(body.kind).toBe("ask");
    expect(body.outcome).toBe("applied");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/prompt|renderingId|rendering_id|score|revision/iu);
    expect(embeddingCalls - beforeEmbedding).toBe(1);
    expect(selectionCalls - beforeSelection).toBe(1);

    const actionId = body.actionId;
    const counts = await db().pool.query<{
      readonly interactions: string;
      readonly transmissions: string;
      readonly episodes: string;
      readonly cards: string;
    }>(
      `SELECT
         (SELECT count(*) FROM public.npc_interactions
           WHERE town_id = $1 AND player_action_id = $2)::STRING AS interactions,
         (SELECT count(*) FROM public.claim_transmissions ct
           JOIN public.npc_interactions ni
             ON ni.town_id = ct.town_id AND ni.id = ct.interaction_id
          WHERE ct.town_id = $1 AND ni.player_action_id = $2)::STRING AS transmissions,
         (SELECT count(*) FROM public.episodes e
           JOIN public.world_events we
             ON we.town_id = e.town_id AND we.id = e.event_id
          WHERE e.town_id = $1 AND we.player_action_id = $2
            AND e.episode_kind = 'player_interaction')::STRING AS episodes,
         (SELECT count(*) FROM public.case_board_entries cbe
           JOIN public.world_events we
             ON we.town_id = cbe.town_id AND we.id = cbe.source_event_id
          WHERE cbe.town_id = $1 AND we.player_action_id = $2)::STRING AS cards`,
      [townId, actionId],
    );
    expect(Number(counts.rows[0]!.interactions)).toBe(1);
    expect(Number(counts.rows[0]!.episodes)).toBe(1);
    // Titan was deliberately unavailable, so anchors kept the request
    // operational without widening the public relevance gate. The authored
    // no-disclosure deflection is persisted, but no claim was spoken.
    expect(Number(counts.rows[0]!.transmissions)).toBe(0);
    expect(Number(counts.rows[0]!.cards)).toBe(0);
  }, 60_000);

  it("persists direct testimony and repeated hearsay with matching board provenance", async () => {
    const player = await joinPlayer();
    const npc = await db().pool.query<{
      readonly id: string;
      readonly location_entity_id: string;
    }>(
      `SELECT n.id, n.location_entity_id FROM public.npcs n
        JOIN public.story_entities character
          ON character.town_id = n.town_id AND character.id = n.character_entity_id
       WHERE n.town_id = $1 AND character.entity_key = 'nessa_reed'`,
      [townId],
    );
    const npcId = npc.rows[0]!.id;
    await db().pool.query(
      `UPDATE public.player_visits
          SET current_location_entity_id = $3
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId, npc.rows[0]!.location_entity_id],
    );
    await Promise.all([
      db().pool.query(
        `UPDATE public.episodes
            SET embedding = $3, embedding_status = 'ready', updated_at = now()
          WHERE town_id = $1 AND npc_id = $2`,
        [townId, npcId, encodeVector(ZERO_VECTOR)],
      ),
      db().pool.query(
        `UPDATE public.npc_player_relationships
            SET trust_score = 40, suspicion_score = 0, updated_at = now()
          WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
        [townId, npcId, player.playerId],
      ),
    ]);

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
          npcId,
          question: "Show me direct and hearsay provenance.",
        }),
        sourceIp: undefined,
      },
      "req_ask_provenance",
      config,
    );
    expect(response.status).toBe(200);
    const body = CompletedActionResponseSchema.parse(parseBody(response.body));
    if (body.kind !== "ask" || body.outcome === "denied") {
      throw new Error("Expected a successful Ask response.");
    }
    const askResult = ActionResultSchemaByKind.ask.parse(body.result);
    expect(askResult.promiseOffers).toMatchObject([
      {
        sourceActionId: body.actionId,
        ordinal: 0,
        npcId,
        kind: "return_item",
        termsVersion: "return-chapel-key-v1",
        subject: { kind: "item", displayName: "Old Chapel Key" },
      },
    ]);
    expect(decodePromiseOffer(askResult.promiseOffers[0]!.offerId)).toEqual({
      sourceActionId: body.actionId,
      ordinal: 0,
    });

    const transmissions = await db().pool.query<{
      readonly id: string;
      readonly ordinal: number;
      readonly source_kind: string;
      readonly source_episode_id: string | null;
      readonly parent_transmission_id: string | null;
      readonly root_transmission_id: string;
      readonly parent_root_transmission_id: string | null;
      readonly entry_kind: string;
      readonly verification_status: string;
    }>(
      `SELECT ct.id, ct.ordinal, ct.source_kind, ct.source_episode_id,
              ct.parent_transmission_id, ct.root_transmission_id,
              parent.root_transmission_id AS parent_root_transmission_id,
              board.entry_kind, board.verification_status
         FROM public.claim_transmissions ct
         JOIN public.npc_interactions interaction
           ON interaction.town_id = ct.town_id AND interaction.id = ct.interaction_id
         LEFT JOIN public.claim_transmissions parent
           ON parent.town_id = ct.town_id AND parent.id = ct.parent_transmission_id
         JOIN public.case_board_entries board
           ON board.town_id = ct.town_id AND board.transmission_id = ct.id
        WHERE ct.town_id = $1 AND interaction.player_action_id = $2
        ORDER BY ct.ordinal`,
      [townId, body.actionId],
    );
    expect(transmissions.rows).toHaveLength(2);
    expect(transmissions.rows[0]).toMatchObject({
      ordinal: 0,
      source_kind: "direct_observation",
      entry_kind: "testimony",
      verification_status: "attributed_testimony",
      parent_transmission_id: null,
    });
    expect(transmissions.rows[0]!.source_episode_id).not.toBeNull();
    expect(transmissions.rows[0]!.root_transmission_id).toBe(transmissions.rows[0]!.id);
    expect(transmissions.rows[1]).toMatchObject({
      ordinal: 1,
      source_kind: "repeated_testimony",
      entry_kind: "hearsay",
      verification_status: "attributed_hearsay",
      source_episode_id: null,
    });
    expect(transmissions.rows[1]!.parent_transmission_id).not.toBeNull();
    expect(transmissions.rows[1]!.root_transmission_id).toBe(
      transmissions.rows[1]!.parent_root_transmission_id,
    );
  }, 60_000);

  it("offers Mara's secrecy promise only with the first confidential disclosure", async () => {
    const player = await joinPlayer();
    const npc = await db().pool.query<{
      readonly id: string;
      readonly location_entity_id: string;
    }>(
      `SELECT n.id, n.location_entity_id FROM public.npcs n
        JOIN public.story_entities character
          ON character.town_id = n.town_id AND character.id = n.character_entity_id
       WHERE n.town_id = $1 AND character.entity_key = 'mara_venn'`,
      [townId],
    );
    const npcId = npc.rows[0]!.id;
    await Promise.all([
      db().pool.query(
        `UPDATE public.player_visits
            SET current_location_entity_id = $3
          WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
        [townId, player.playerId, npc.rows[0]!.location_entity_id],
      ),
      db().pool.query(
        `UPDATE public.npc_player_relationships
            SET trust_score = 40, suspicion_score = 0, updated_at = now()
          WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
        [townId, npcId, player.playerId],
      ),
    ]);

    async function ask(idempotencyKey: string, requestId: string) {
      const { response } = await routeRequest(
        {
          method: "POST",
          path: `/api/v1/towns/${townId}/actions`,
          headers: new Map([
            ["origin", APP_ORIGIN],
            ["content-type", "application/json"],
            ["cookie", player.cookie],
            ["idempotency-key", idempotencyKey],
          ]),
          body: JSON.stringify({
            kind: "ask",
            npcId,
            question: "Tell me the Lark secret offer.",
          }),
          sourceIp: undefined,
        },
        requestId,
        config,
      );
      expect(response.status).toBe(200);
      const completed = CompletedActionResponseSchema.parse(parseBody(response.body));
      if (completed.kind !== "ask" || completed.outcome === "denied") {
        throw new Error("Expected a successful Ask response.");
      }
      return {
        actionId: completed.actionId,
        result: ActionResultSchemaByKind.ask.parse(completed.result),
      };
    }

    const first = await ask(randomUUID(), "req_ask_secret_first");
    expect(first.result.promiseOffers).toMatchObject([
      {
        sourceActionId: first.actionId,
        ordinal: 0,
        npcId,
        kind: "keep_secret",
        termsVersion: "keep-lark-accident-secret-v1",
        subject: {
          kind: "claim",
          text: "Lark Venn damaged the Festival Bell.",
        },
      },
    ]);

    const second = await ask(randomUUID(), "req_ask_secret_repeat");
    expect(second.result.promiseOffers).toEqual([]);
  }, 60_000);
});
