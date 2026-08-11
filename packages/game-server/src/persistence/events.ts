/**
 * `world_events` append for the player-action executor (`P3-09`).
 *
 * `effectKey` matches Decision 005's derivation exactly:
 * `"player:" + idempotencyKey + ":" + effectIndex`. It is exposed on its own
 * because `application/actions/commit.ts` needs the same value both as the
 * row's `effect_key` and, unique per `(town_id, effect_key)`, as the
 * database's own duplicate-application guard — a second commit attempt under
 * the same idempotency key can never insert a second event for the same
 * effect index.
 *
 * `sequence_no` is not allocated here: the caller (`commit.ts`) reserves the
 * whole contiguous range for a plan's events in the same `towns` update that
 * bumps `last_event_sequence`, then passes each event's already-assigned
 * number in here. Allocating it locally per insert would let two events in
 * the same plan race for the same number.
 */

import { randomUUID } from "node:crypto";

import type { EventType } from "@the-town-remembers/database/domains";
import type { TransactionContext } from "@the-town-remembers/database";
import {
  computeAmbientEligible,
  type AmbientEligibilityOptions,
} from "@the-town-remembers/rules";

export function effectKey(idempotencyKey: string, effectIndex: number): string {
  return `player:${idempotencyKey}:${effectIndex}`;
}

/**
 * Every column `world_events` carries beyond identity, origin, and ordering.
 * None of the four Phase 3 kinds populate anything but `actorId` and,
 * for `travel`/`inspect`, `locationEntityId` — the remaining fields exist so
 * a later phase's planner does not need a second append path.
 */
export interface WorldEventMetadata {
  readonly actorId?: string | null;
  readonly targetActorId?: string | null;
  readonly subjectEntityId?: string | null;
  readonly locationEntityId?: string | null;
  readonly claimId?: string | null;
  readonly clueId?: string | null;
  readonly promiseId?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly ambientEligibilityOptions?: AmbientEligibilityOptions;
}

export interface AppendPlayerEventParams {
  readonly transaction: TransactionContext;
  readonly townId: string;
  readonly sequenceNo: number;
  readonly eventType: EventType;
  readonly occurredAt: Date;
  readonly playerActionId: string;
  readonly effectIndex: number;
  readonly idempotencyKey: string;
  readonly metadata?: WorldEventMetadata;
}

/** Inserts one numbered, player-originated `world_events` row and returns its id. */
export async function appendPlayerEvent(
  params: AppendPlayerEventParams,
): Promise<string> {
  const eventId = randomUUID();
  const metadata = params.metadata ?? {};
  const ambientEligible = computeAmbientEligible(
    params.eventType,
    metadata.ambientEligibilityOptions,
  );

  await params.transaction.query(
    `INSERT INTO public.world_events
       (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at, origin_kind,
        player_action_id, effect_index, effect_key, actor_id, target_actor_id,
        subject_entity_id, location_entity_id, claim_id, clue_id, promise_id, payload,
        created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'player_action', $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $6)`,
    [
      params.townId,
      eventId,
      params.sequenceNo,
      params.eventType,
      ambientEligible,
      params.occurredAt,
      params.playerActionId,
      params.effectIndex,
      effectKey(params.idempotencyKey, params.effectIndex),
      metadata.actorId ?? null,
      metadata.targetActorId ?? null,
      metadata.subjectEntityId ?? null,
      metadata.locationEntityId ?? null,
      metadata.claimId ?? null,
      metadata.clueId ?? null,
      metadata.promiseId ?? null,
      JSON.stringify(metadata.payload ?? {}),
    ],
  );

  return eventId;
}
