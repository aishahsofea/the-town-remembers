/**
 * `GET /api/v1/towns/{townId}/player-view` acceptance suite (`P3-06`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { PROMISE_TERMS } from "@the-town-remembers/content";
import { PlayerViewSchema } from "@the-town-remembers/http-contracts";
import { readInspectedInteraction } from "../persistence/inspection.js";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPlayerAndVisit, readTownHeader } from "../persistence/view-queries.js";
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
    // Fresh per call, so this file's many joins never share the join rate
    // bucket (burst 10) and exhaust it against each other.
    sourceIp: randomUUID(),
  };
}

function playerViewRequest(
  townId: string,
  cookieHeader: string,
  ifNoneMatch?: string,
): HttpRequest {
  const headers = new Map([["cookie", cookieHeader]]);
  if (ifNoneMatch !== undefined) headers.set("if-none-match", ifNoneMatch);
  return {
    method: "GET",
    path: `/api/v1/towns/${townId}/player-view`,
    headers,
    body: undefined,
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

/** Recursively collects every JSON-Pointer-ish key path mapped to a number. */
function collectNumberPaths(
  value: unknown,
  path: string,
  found: Map<string, number>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectNumberPaths(item, `${path}[${index}]`, found),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectNumberPaths(child, path === "" ? key : `${path}.${key}`, found);
    }
    return;
  }
  if (typeof value === "number") found.set(path, value);
}

describe.skipIf(!shouldRunDatabaseTests())("player-view", () => {
  let handle: DisposableDatabase | undefined;
  let config: RouterConfig;
  let townId: string;
  let inviteToken: string;
  let otherTownId: string;
  let festivalSquareId: string;
  let lanternInnId: string;
  let oldChapelId: string;
  let corinNpcId: string;
  let maraNpcId: string;
  let nessaNpcId: string;
  let larkDamagedBellClaimId: string;

  /** Bumps `last_event_sequence` and inserts a minimal `world_events` row, returning its id. */
  async function insertWorldEvent(eventType: string): Promise<string> {
    const bumped = await handle!.pool.query<{ last_event_sequence: number }>(
      `UPDATE public.towns SET last_event_sequence = last_event_sequence + 1, updated_at = $2
        WHERE id = $1 RETURNING last_event_sequence`,
      [townId, new Date()],
    );
    const eventId = randomUUID();
    await handle!.pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
          effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, $3, $4, false, $5, 'system_seed', 0, $6, '{}', $5)`,
      [
        townId,
        eventId,
        bumped.rows[0]!.last_event_sequence,
        eventType,
        new Date(),
        `test:${eventType}:${eventId}`,
      ],
    );
    return eventId;
  }

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

    const otherResult = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(randomUUID()).digest(),
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

    const npcs = await handle.pool.query<{ id: string; character_key: string }>(
      `SELECT n.id, ch.entity_key AS character_key
         FROM public.npcs n
         JOIN public.story_entities ch
           ON ch.town_id = n.town_id AND ch.id = n.character_entity_id
        WHERE n.town_id = $1`,
      [townId],
    );
    const npcIdByKey = new Map(npcs.rows.map((row) => [row.character_key, row.id]));
    corinNpcId = npcIdByKey.get("corin_hale")!;
    maraNpcId = npcIdByKey.get("mara_venn")!;
    nessaNpcId = npcIdByKey.get("nessa_reed")!;

    const claim = await handle.pool.query<{ id: string }>(
      `SELECT c.id FROM public.claims c
         JOIN public.story_entities subj
           ON subj.town_id = c.town_id AND subj.id = c.subject_entity_id
         JOIN public.story_entities obj
           ON obj.town_id = c.town_id AND obj.id = c.object_entity_id
        WHERE c.town_id = $1 AND subj.entity_key = 'lark_venn'
          AND obj.entity_key = 'festival_bell' AND c.predicate = 'damaged'`,
      [townId],
    );
    larkDamagedBellClaimId = claim.rows[0]!.id;
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

  it("returns a schema-valid view for a joined player at Festival Square", async () => {
    const player = await joinedPlayer("Mara Okafor");
    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );

    expect(response.status).toBe(200);
    const view = PlayerViewSchema.parse(parseBody(response.body));

    expect(view.town.status).toBe("active");
    expect(view.player.visit).toStrictEqual({
      status: "active",
      visitId: expect.any(String) as string,
      locationId: festivalSquareId,
    });
    expect(view.currentLocation?.id).toBe(festivalSquareId);
    expect(view.encounters.map((encounter) => encounter.npc.displayName)).toContain(
      "Corin Hale",
    );
    const chapel = view.map.find((location) => location.id === oldChapelId);
    expect(chapel?.access).toStrictEqual({
      state: "locked",
      message: "The chapel door is locked.",
    });
    expect(chapel?.access.state === "locked" ? chapel.access.message : "").not.toMatch(
      /key|capability|nessa|corin/i,
    );
  }, 30_000);

  it("reflects a travelled location and its co-located NPC", async () => {
    const player = await joinedPlayer("Lin Reyes");
    await db().pool.query(
      `UPDATE public.player_visits SET current_location_entity_id = $3
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId, lanternInnId],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    expect(view.currentLocation?.id).toBe(lanternInnId);
    expect(view.encounters.map((encounter) => encounter.npc.displayName)).toStrictEqual(
      ["Mara Venn"],
    );
  }, 30_000);

  it("reflects a discovered clue in discoveredClues and marks its inspectable already_inspected", async () => {
    const player = await joinedPlayer("Priya Chen");
    await db().pool.query(
      `UPDATE public.player_visits SET current_location_entity_id = $3
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId, lanternInnId],
    );

    const clueRow = await db().pool.query<{ id: string; inspectable_id: string }>(
      `SELECT id, inspectable_id FROM public.clues
        WHERE town_id = $1 AND clue_key = 'scorched_guard_note'`,
      [townId],
    );
    const clueId = clueRow.rows[0]!.id;

    const bumped = await db().pool.query<{ last_event_sequence: number }>(
      `UPDATE public.towns SET last_event_sequence = last_event_sequence + 1, updated_at = $2
        WHERE id = $1 RETURNING last_event_sequence`,
      [townId, new Date()],
    );
    const eventId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
          effect_index, effect_key, actor_id, clue_id, payload, created_at)
       VALUES ($1, $2, $3, 'clue_discovered', false, $4, 'system_seed', 0, $5, $6, $7, '{}', $4)`,
      [
        townId,
        eventId,
        bumped.rows[0]!.last_event_sequence,
        new Date(),
        `test:clue:${eventId}`,
        player.playerId,
        clueId,
      ],
    );
    await db().pool.query(
      `INSERT INTO public.clue_discoveries (town_id, id, clue_id, player_id, event_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [townId, randomUUID(), clueId, player.playerId, eventId, new Date()],
    );
    await db().pool.query(
      `INSERT INTO public.case_board_entries
         (town_id, id, entry_kind, contributed_by_player_id, source_event_id,
          clue_id, verification_status, created_at)
       VALUES ($1, $2, 'verified_evidence', $3, $4, $5,
               'verified_physical', $6)`,
      [townId, randomUUID(), player.playerId, eventId, clueId, new Date()],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    expect(view.discoveredClues).toHaveLength(1);
    expect(view.discoveredClues[0]?.title).toBe("Scorched Guard Note");
    expect(view.discoveredClues[0]?.firstContributor.id).toBe(player.playerId);
    expect(view.caseBoard).toHaveLength(1);
    expect(view.caseBoard[0]).toMatchObject({
      entryKind: "verified_evidence",
      contributedBy: { id: player.playerId, displayName: "Priya Chen" },
      clue: { clueId, title: "Scorched Guard Note" },
    });

    const inspectable = view.currentLocation?.inspectables.find(
      (candidate) => candidate.displayName === "Ash in the Back Hearth",
    );
    expect(inspectable?.inspectionState).toBe("already_inspected");
  }, 30_000);

  it("shows an away player with a null currentLocation and no encounters", async () => {
    const player = await joinedPlayer("Away Player");
    const visit = await db().pool.query<{
      id: string;
      started_by_action_id: string;
      start_revision: number;
    }>(
      `SELECT id, started_by_action_id, start_revision FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId],
    );
    const {
      id: visitId,
      started_by_action_id: actionId,
      start_revision: startRevision,
    } = visit.rows[0]!;
    await db().pool.query(
      `UPDATE public.player_visits
          SET status = 'ended', end_revision = $3, ended_by_action_id = $4,
              end_reason = 'left_town', ended_at = $5
        WHERE town_id = $1 AND id = $2`,
      [townId, visitId, startRevision, actionId, new Date()],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    expect(view.player.visit).toStrictEqual({ status: "away" });
    expect(view.currentLocation).toBeNull();
    expect(view.encounters).toStrictEqual([]);
  }, 30_000);

  it("returns an identical body and ETag across repeated calls with no state change", async () => {
    const player = await joinedPlayer("Repeat Caller");
    const first = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const second = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_2",
      config,
    );

    expect(first.response.body).toBe(second.response.body);
    expect(first.response.headers["etag"]).toBe(second.response.headers["etag"]);
  }, 30_000);

  it("leaves the ETag unchanged after a hidden-only relationship change that does not cross a stance threshold", async () => {
    const player = await joinedPlayer("Stance Steady");
    const before = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );

    const corin = await db().pool.query<{ id: string }>(
      `SELECT n.id FROM public.npcs n
         JOIN public.story_entities ch ON ch.town_id = n.town_id AND ch.id = n.character_entity_id
        WHERE n.town_id = $1 AND ch.entity_key = 'corin_hale'`,
      [townId],
    );
    await db().pool.query(
      `UPDATE public.npc_player_relationships SET trust_score = 10
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corin.rows[0]!.id, player.playerId],
    );

    const after = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_2",
      config,
    );

    expect(after.response.headers["etag"]).toBe(before.response.headers["etag"]);
    expect(after.response.body).toBe(before.response.body);
  }, 30_000);

  it("never leaks the canonical town revision", async () => {
    const player = await joinedPlayer("Revision Watcher");
    await db().pool.query("UPDATE public.towns SET revision = 918273 WHERE id = $1", [
      townId,
    ]);

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );

    expect(response.body).not.toContain("918273");
  }, 30_000);

  it("carries no belief, trust, or suspicion number — every number is mapOrder", async () => {
    const player = await joinedPlayer("Number Scanner");
    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );

    const found = new Map<string, number>();
    collectNumberPaths(parseBody(response.body), "", found);
    for (const path of found.keys()) {
      expect(path.endsWith(".mapOrder") || path === "mapOrder").toBe(true);
    }
    expect(found.size).toBeGreaterThan(0);
  }, 30_000);

  it("supports the If-None-Match short-circuit with a bodyless 304 and stable headers", async () => {
    const player = await joinedPlayer("Poller");
    const first = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const etag = first.response.headers["etag"]!;

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie, etag),
      "req_2",
      config,
    );

    expect(response.status).toBe(304);
    expect(response.body).toBe("");
    expect(response.headers["etag"]).toBe(etag);
    expect(response.headers["vary"]).toBe("Cookie");
    expect(response.headers["cache-control"]).toBe("private, no-cache");
  }, 30_000);

  it("closes the join replay window on the first authenticated view even when it returns 304", async () => {
    const player = await joinedPlayer("Bootstrap Closer");
    const first = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const etag = first.response.headers["etag"]!;

    await routeRequest(playerViewRequest(townId, player.cookie, etag), "req_2", config);

    const joinRow = await db().pool.query<{
      bootstrap_confirmed_at: Date | null;
      join_secret_hash: Buffer | null;
    }>(
      `SELECT jr.bootstrap_confirmed_at, jr.join_secret_hash
         FROM public.join_requests jr
         JOIN public.player_sessions ps
           ON ps.town_id = jr.town_id AND ps.join_request_id = jr.idempotency_key
        WHERE ps.town_id = $1 AND ps.player_id = $2`,
      [townId, player.playerId],
    );
    expect(joinRow.rows[0]?.bootstrap_confirmed_at).not.toBeNull();
    expect(joinRow.rows[0]?.join_secret_hash).toBeNull();
  }, 30_000);

  it("rejects a cookie minted for a different, real town — replayed manually under that town's cookie name", async () => {
    const player = await joinedPlayer("Cross Town");
    const forgedCookie = player.cookie.replace(townId, otherTownId);

    const { response } = await routeRequest(
      playerViewRequest(otherTownId, forgedCookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(401);
  }, 30_000);

  it("opens the Old Chapel once the player holds the physical key", async () => {
    const player = await joinedPlayer("Key Holder");
    await db().pool.query(
      `UPDATE public.items
          SET location_entity_id = NULL, location_entity_type = NULL, held_by_actor_id = $2
        WHERE town_id = $1
          AND id = (SELECT id FROM public.story_entities
                      WHERE town_id = $1 AND entity_key = 'old_chapel_key')`,
      [townId, player.playerId],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    const chapel = view.map.find((location) => location.id === oldChapelId);
    expect(chapel?.access).toStrictEqual({ state: "open" });
  }, 30_000);

  it("opens the Old Chapel once the player holds the enter_old_chapel capability", async () => {
    const player = await joinedPlayer("Capability Holder");

    const bumped = await db().pool.query<{ last_event_sequence: number }>(
      `UPDATE public.towns SET last_event_sequence = last_event_sequence + 1, updated_at = $2
        WHERE id = $1 RETURNING last_event_sequence`,
      [townId, new Date()],
    );
    const eventId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
          effect_index, effect_key, actor_id, payload, created_at)
       VALUES ($1, $2, $3, 'capability_changed', false, $4, 'system_seed', 0, $5, $6, '{}', $4)`,
      [
        townId,
        eventId,
        bumped.rows[0]!.last_event_sequence,
        new Date(),
        `test:capability:${eventId}`,
        player.playerId,
      ],
    );
    await db().pool.query(
      `INSERT INTO public.player_capabilities
         (town_id, id, player_id, capability_key, status, granted_event_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'enter_old_chapel', 'granted', $4, $5, $5)`,
      [townId, randomUUID(), player.playerId, eventId, new Date()],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    const chapel = view.map.find((location) => location.id === oldChapelId);
    expect(chapel?.access).toStrictEqual({ state: "open" });
  }, 30_000);

  it("reissues the session cookie once the monthly interval has passed", async () => {
    const player = await joinedPlayer("Stale Cookie");
    const monthAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db().pool.query(
      `UPDATE public.player_sessions SET created_at = $3, last_cookie_issued_at = $3
        WHERE town_id = $1 AND player_id = $2`,
      [townId, player.playerId, monthAgo],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );

    expect(response.cookies).toHaveLength(1);
    expect(response.cookies[0]).toContain(`ttr_town_${townId}=`);
  }, 30_000);

  it("returns 410 for a retired town", async () => {
    const retiredInvite = randomUUID();
    const retiredResult = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(retiredInvite).digest(),
    });
    if (retiredResult.outcome !== "committed")
      throw new Error("The seed did not commit.");
    const retiredTownId = retiredResult.value.townId;

    const { response: joinResponse } = await routeRequest(
      joinRequest(retiredInvite, "Soon Retired"),
      "req_join",
      config,
    );
    expect(joinResponse.status).toBe(201);
    const cookie = cookiePair(joinResponse.cookies[0]!);

    await db().pool.query("UPDATE public.towns SET status = 'retired' WHERE id = $1", [
      retiredTownId,
    ]);

    const { response } = await routeRequest(
      playerViewRequest(retiredTownId, cookie),
      "req_1",
      config,
    );
    expect(response.status).toBe(410);
  }, 30_000);

  it("gates availableActionKinds behind TTR_ENABLE_NPC_MUTATIONS, regardless of a very low stance", async () => {
    const player = await joinedPlayer("Gate Checker");
    await db().pool.query(
      `UPDATE public.npc_player_relationships SET trust_score = -80, suspicion_score = 80
        WHERE town_id = $1 AND npc_id = $2 AND player_id = $3`,
      [townId, corinNpcId, player.playerId],
    );

    const disabled = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const disabledView = PlayerViewSchema.parse(parseBody(disabled.response.body));
    const disabledEncounter = disabledView.encounters.find((e) => e.npc.id === corinNpcId);
    expect(disabledEncounter?.availableActionKinds).toStrictEqual([]);

    const mutationsConfig: RouterConfig = { ...config, enableNpcMutations: true };
    const enabled = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_2",
      mutationsConfig,
    );
    const enabledView = PlayerViewSchema.parse(parseBody(enabled.response.body));
    const enabledEncounter = enabledView.encounters.find((e) => e.npc.id === corinNpcId);
    expect(enabledEncounter?.availableActionKinds).toStrictEqual([
      "ask",
      "normalize_claim",
      "tell",
      "show",
      "give",
      "accept_promise",
    ]);
  }, 30_000);

  it("projects an active promise directly written to public.promises", async () => {
    const player = await joinedPlayer("Promise Holder");
    const eventId = await insertWorldEvent("promise_accepted");
    const promiseId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.promises
         (town_id, id, npc_id, player_id, kind, protected_claim_id, item_id, status,
          accepted_event_id, terms_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'keep_secret', $5, NULL, 'active', $6, $7, $8, $8)`,
      [
        townId,
        promiseId,
        maraNpcId,
        player.playerId,
        larkDamagedBellClaimId,
        eventId,
        PROMISE_TERMS.keepLarkAccidentSecret.termsVersion,
        new Date(),
      ],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    expect(view.activePromises).toHaveLength(1);
    expect(view.activePromises[0]).toMatchObject({
      promiseId,
      npc: { id: maraNpcId, displayName: "Mara Venn" },
      kind: "keep_secret",
      summary: PROMISE_TERMS.keepLarkAccidentSecret.summary,
      subject: { kind: "claim", claimId: larkDamagedBellClaimId },
    });
  }, 30_000);

  it("classifies a multi-hop board entry as hearsay with its alleged source and a root-first provenance path", async () => {
    const player = await joinedPlayer("Board Watcher");

    const eventA = await insertWorldEvent("claim_transmitted");
    const transmissionA = randomUUID();
    await db().pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id, recipient_actor_type,
          parent_transmission_id, parent_is_eligible, root_transmission_id, source_kind,
          hop_count, event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', NULL, NULL, $2, 'original_assertion', 0, $6, 0, $7)`,
      [
        townId,
        transmissionA,
        larkDamagedBellClaimId,
        player.playerId,
        maraNpcId,
        eventA,
        new Date(),
      ],
    );

    const eventB = await insertWorldEvent("claim_transmitted");
    const transmissionB = randomUUID();
    await db().pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id, recipient_actor_type,
          parent_transmission_id, parent_is_eligible, root_transmission_id, source_kind,
          hop_count, event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'npc', $6, true, $6, 'repeated_testimony', 1, $7, 0, $8)`,
      [
        townId,
        transmissionB,
        larkDamagedBellClaimId,
        maraNpcId,
        nessaNpcId,
        transmissionA,
        eventB,
        new Date(),
      ],
    );

    const eventC = await insertWorldEvent("claim_transmitted");
    const transmissionC = randomUUID();
    await db().pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id, recipient_actor_type,
          parent_transmission_id, parent_is_eligible, root_transmission_id, source_kind,
          hop_count, event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'player', $6, true, $7, 'repeated_testimony', 2, $8, 0, $9)`,
      [
        townId,
        transmissionC,
        larkDamagedBellClaimId,
        nessaNpcId,
        player.playerId,
        transmissionB,
        transmissionA,
        eventC,
        new Date(),
      ],
    );

    const entryId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.case_board_entries
         (town_id, id, entry_kind, contributed_by_player_id, source_event_id,
          claim_id, transmission_id, verification_status, created_at)
       VALUES ($1, $2, 'hearsay', $3, $4, $5, $6, 'attributed_hearsay', $7)`,
      [
        townId,
        entryId,
        player.playerId,
        eventC,
        larkDamagedBellClaimId,
        transmissionC,
        new Date(),
      ],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    const entry = view.caseBoard.find((candidate) => candidate.entryId === entryId);
    expect(entry).toMatchObject({
      entryKind: "hearsay",
      verificationStatus: "attributed_hearsay",
      contributedBy: { id: player.playerId, displayName: "Board Watcher" },
      speaker: { id: nessaNpcId, actorType: "npc", displayName: "Nessa Reed" },
    });
    expect(entry && "allegedSource" in entry).toBe(false);
    expect(entry && "provenancePath" in entry ? entry.provenancePath : []).toStrictEqual([
      { id: player.playerId, actorType: "player", displayName: "Board Watcher" },
      { id: maraNpcId, actorType: "npc", displayName: "Mara Venn" },
      { id: nessaNpcId, actorType: "npc", displayName: "Nessa Reed" },
    ]);
  }, 30_000);

  it("classifies a standalone alleged-hearsay entry as hearsay, carrying its alleged source with a one-hop provenance path", async () => {
    const player = await joinedPlayer("Alleged Source Watcher");

    const eventId = await insertWorldEvent("claim_transmitted");
    const transmissionId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id, recipient_actor_type,
          parent_transmission_id, root_transmission_id, alleged_source_actor_id,
          source_kind, hop_count, event_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'player', NULL, $2, $6, 'alleged_hearsay', 1, $7, 0, $8)`,
      [
        townId,
        transmissionId,
        larkDamagedBellClaimId,
        nessaNpcId,
        player.playerId,
        maraNpcId,
        eventId,
        new Date(),
      ],
    );

    const entryId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.case_board_entries
         (town_id, id, entry_kind, contributed_by_player_id, source_event_id,
          claim_id, transmission_id, verification_status, created_at)
       VALUES ($1, $2, 'hearsay', $3, $4, $5, $6, 'attributed_hearsay', $7)`,
      [townId, entryId, player.playerId, eventId, larkDamagedBellClaimId, transmissionId, new Date()],
    );

    const { response } = await routeRequest(
      playerViewRequest(townId, player.cookie),
      "req_1",
      config,
    );
    const view = PlayerViewSchema.parse(parseBody(response.body));

    const entry = view.caseBoard.find((candidate) => candidate.entryId === entryId);
    expect(entry).toMatchObject({
      entryKind: "hearsay",
      verificationStatus: "attributed_hearsay",
      speaker: { id: nessaNpcId, actorType: "npc", displayName: "Nessa Reed" },
      allegedSource: { id: maraNpcId, actorType: "npc", displayName: "Mara Venn" },
    });
    expect(entry && "provenancePath" in entry ? entry.provenancePath : []).toStrictEqual([
      { id: nessaNpcId, actorType: "npc", displayName: "Nessa Reed" },
    ]);
  }, 30_000);

  it("reconstructs one complete accepted interaction through the inspection views, ordinal and provenance root intact", async () => {
    const player = await joinedPlayer("Inspection Subject");
    const visit = await db().pool.query<{ id: string }>(
      `SELECT id FROM public.player_visits
        WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
      [townId, player.playerId],
    );
    const visitId = visit.rows[0]!.id;

    const eventId = await insertWorldEvent("npc_interaction");
    const playerActionId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.player_actions
         (town_id, id, player_id, visit_id, idempotency_key, action_kind, request_hash,
          request_payload, status, outcome, response_status, response_payload,
          created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, 'ask', $6, '{}', 'completed', 'applied', 200, '{}',
               $7, $7, $7)`,
      [
        townId,
        playerActionId,
        player.playerId,
        visitId,
        randomUUID(),
        createHash("sha256").update("test-request").digest(),
        new Date(),
      ],
    );

    const interactionId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.npc_interactions
         (town_id, id, player_action_id, visit_id, player_id, npc_id, event_id,
          input_kind, npc_text, response_mode, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ask', 'Corin answers plainly.', 'selected', $8)`,
      [
        townId,
        interactionId,
        playerActionId,
        visitId,
        player.playerId,
        corinNpcId,
        eventId,
        new Date(),
      ],
    );

    const transmissionId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.claim_transmissions
         (town_id, id, claim_id, speaker_actor_id, recipient_actor_id, recipient_actor_type,
          parent_transmission_id, root_transmission_id, source_kind, hop_count, event_id,
          interaction_id, ordinal, created_at)
       VALUES ($1, $2, $3, $4, $5, 'player', NULL, $2, 'original_assertion', 0, $6, $7, 0, $8)`,
      [
        townId,
        transmissionId,
        larkDamagedBellClaimId,
        corinNpcId,
        player.playerId,
        eventId,
        interactionId,
        new Date(),
      ],
    );

    const reconstructed = await readInspectedInteraction(
      db().pool,
      townId,
      playerActionId,
    );

    expect(reconstructed).toMatchObject({
      interactionId,
      npcName: "Corin Hale",
      inputKind: "ask",
      responseMode: "selected",
      npcText: "Corin answers plainly.",
    });
    expect(reconstructed?.eventSequence).toBeGreaterThan(0);
    expect(reconstructed?.transmissions).toStrictEqual([
      {
        transmissionId,
        claimKey: expect.any(String) as string,
        speakerName: "Corin Hale",
        speakerType: "npc",
        sourceKind: "original_assertion",
        ordinal: 0,
        hopCount: 0,
        rootTransmissionId: transmissionId,
      },
    ]);

    expect(await readInspectedInteraction(db().pool, townId, randomUUID())).toBeUndefined();
  }, 30_000);

  it("returns undefined for a town or player row that does not exist", async () => {
    expect(await readTownHeader(db().pool, randomUUID())).toBeUndefined();
    expect(await readPlayerAndVisit(db().pool, townId, randomUUID())).toBeUndefined();
  }, 30_000);
});
