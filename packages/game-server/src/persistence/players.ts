/**
 * First-time player creation, in one transaction (Decision 006 join flow).
 *
 * Creates the player's `actors`/`players` rows, a zeroed
 * `npc_player_relationships` row per authored NPC, and one `player_sessions`
 * row. An `active` town also gets the bootstrap `start_visit`: a completed
 * `player_actions` row, the Festival Square `player_visits` row, and the
 * numbered `visit_started` `world_events` row — internal, not player
 * submitted, but shaped exactly like a real completed action so a later
 * `GET` on its action ID behaves like any other.
 *
 * `player_actions` and `player_visits` reference each other
 * (`player_visits.started_by_action_id` -> `player_actions.id`, and
 * `player_actions.visit_id` -> `player_visits.id`); the visit ID is
 * generated up front so both inserts can happen without a placeholder.
 */

import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@the-town-remembers/database";

import { actionRequestHash } from "../security/fingerprint.js";
import { mintSessionForPlayer } from "./sessions.js";

export interface CreatePlayerParams {
  readonly townId: string;
  readonly townActive: boolean;
  readonly displayName: string;
  readonly displayNameNormalized: string;
  readonly sessionTokenHash: Buffer;
  readonly joinRequestId: string;
  readonly now: Date;
}

export interface CreatePlayerResult {
  readonly playerId: string;
  readonly sessionId: string;
  readonly initialVisit: {
    readonly visitId: string;
    readonly locationId: string;
  } | null;
}

async function festivalSquareEntityId(
  transaction: TransactionContext,
  townId: string,
): Promise<string> {
  const rows = await transaction.query<{ id: string }>(
    `SELECT id FROM public.story_entities
      WHERE town_id = $1 AND entity_key = 'festival_square' AND entity_type = 'location'`,
    [townId],
  );
  const row = rows[0];
  if (!row)
    throw new Error("Festival Square is missing from this town's story entities.");
  return row.id;
}

async function createNpcRelationships(
  transaction: TransactionContext,
  townId: string,
  playerId: string,
  now: Date,
): Promise<void> {
  await transaction.query(
    `INSERT INTO public.npc_player_relationships (town_id, npc_id, player_id, created_at, updated_at)
     SELECT town_id, id, $2, $3, $3 FROM public.npcs WHERE town_id = $1`,
    [townId, playerId, now],
  );
}

async function bootstrapStartVisit(
  transaction: TransactionContext,
  townId: string,
  playerId: string,
  now: Date,
): Promise<{ visitId: string; locationId: string }> {
  const locationId = await festivalSquareEntityId(transaction, townId);
  const actionId = randomUUID();
  const visitId = randomUUID();
  const eventId = randomUUID();
  const idempotencyKey = randomUUID();
  const requestHash = actionRequestHash({
    kind: "start_visit",
    targetActorId: null,
    targetEntityId: null,
    payload: {},
  });
  const responsePayload = {
    actionId,
    kind: "start_visit",
    status: "completed",
    outcome: "applied",
    result: { disposition: "started", visitId, locationId },
  };

  await transaction.query(
    `INSERT INTO public.player_actions
       (town_id, id, player_id, visit_id, idempotency_key, action_kind, request_hash,
        request_payload, status, attempt_count, outcome, response_status,
        response_payload, created_at, updated_at, completed_at)
     VALUES ($1, $2, $3, NULL, $4, 'start_visit', $5, '{}', 'completed', 1, 'applied',
             200, $6, $7, $7, $7)`,
    [
      townId,
      actionId,
      playerId,
      idempotencyKey,
      requestHash,
      JSON.stringify(responsePayload),
      now,
    ],
  );

  const bumped = await transaction.query<{ last_event_sequence: number }>(
    `UPDATE public.towns
        SET last_event_sequence = last_event_sequence + 1, revision = revision + 1,
            updated_at = $2
      WHERE id = $1
      RETURNING last_event_sequence`,
    [townId, now],
  );
  const sequenceNo = bumped[0]?.last_event_sequence;
  if (sequenceNo === undefined) throw new Error("town vanished mid-bootstrap");

  await transaction.query(
    `INSERT INTO public.player_visits
       (town_id, id, player_id, current_location_entity_id, current_location_entity_type,
        status, start_revision, started_by_action_id, started_at)
     VALUES ($1, $2, $3, $4, 'location', 'active', $5, $6, $7)`,
    [townId, visitId, playerId, locationId, sequenceNo, actionId, now],
  );

  await transaction.query(
    "UPDATE public.player_actions SET visit_id = $3 WHERE town_id = $1 AND id = $2",
    [townId, actionId, visitId],
  );

  await transaction.query(
    `INSERT INTO public.world_events
       (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
        player_action_id, effect_index, effect_key, actor_id, location_entity_id, payload,
        created_at)
     VALUES ($1, $2, $3, 'visit_started', false, $4, 'player_action', $5, 0, $6, $7, $8, '{}', $4)`,
    [
      townId,
      eventId,
      sequenceNo,
      now,
      actionId,
      `player:${idempotencyKey}:0`,
      playerId,
      locationId,
    ],
  );

  return { visitId, locationId };
}

export async function createPlayer(
  transaction: TransactionContext,
  params: CreatePlayerParams,
): Promise<CreatePlayerResult> {
  const playerId = randomUUID();

  await transaction.query(
    `INSERT INTO public.actors (town_id, id, actor_type, display_name, display_name_normalized, created_at)
     VALUES ($1, $2, 'player', $3, $4, $5)`,
    [
      params.townId,
      playerId,
      params.displayName,
      params.displayNameNormalized,
      params.now,
    ],
  );
  await transaction.query(
    `INSERT INTO public.players (town_id, id, actor_type, last_seen_at, created_at, updated_at)
     VALUES ($1, $2, 'player', $3, $3, $3)`,
    [params.townId, playerId, params.now],
  );
  await createNpcRelationships(transaction, params.townId, playerId, params.now);
  const session = await mintSessionForPlayer(transaction, {
    townId: params.townId,
    playerId,
    joinRequestId: params.joinRequestId,
    tokenHash: params.sessionTokenHash,
    now: params.now,
  });

  const initialVisit = params.townActive
    ? await bootstrapStartVisit(transaction, params.townId, playerId, params.now)
    : null;

  return { playerId, sessionId: session.sessionId, initialVisit };
}
