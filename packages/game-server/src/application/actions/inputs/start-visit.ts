/**
 * `start_visit`'s `D3-N` narrow input loader and its full `ActionHandler`
 * (`P3-10`).
 *
 * `priorAmbientJobStatus` is read for real from `outbox`/`ambient_job_executions`
 * rather than hardcoded to `"none"`: Phase 3 never creates an `outbox` row
 * (`D3-Q`), so this always resolves to `"none"` in practice today, but the
 * query itself is the seam Phase 5's ambient worker inherits unchanged.
 */

import { randomUUID } from "node:crypto";

import type { ActionResultByKind } from "@the-town-remembers/http-contracts";
import {
  planStartVisit,
  type PriorAmbientJobStatus,
  type ReasonCode,
  type StartVisitInputs,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import type { ActionHandler, LoadInputsContext } from "../executor.js";

export interface StartVisitLoadedInputs extends StartVisitInputs {
  readonly playerId: string;
  /** The active visit's id, when `hasActiveVisit` — the response's `visitId` for `already_active`. */
  readonly existingVisitId: string | null;
}

async function readTownActive(pool: Pool, townId: string): Promise<boolean> {
  const result = await pool.query<{ readonly status: string }>(
    "SELECT status FROM public.towns WHERE id = $1",
    [townId],
  );
  return result.rows[0]?.status === "active";
}

async function readActiveVisitId(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<string | null> {
  const result = await pool.query<{ readonly id: string }>(
    `SELECT id FROM public.player_visits
      WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
    [townId, playerId],
  );
  return result.rows[0]?.id ?? null;
}

async function readFestivalSquareLocationId(
  pool: Pool,
  townId: string,
): Promise<string> {
  const result = await pool.query<{ readonly id: string }>(
    `SELECT id FROM public.story_entities
      WHERE town_id = $1 AND entity_key = 'festival_square' AND entity_type = 'location'`,
    [townId],
  );
  const row = result.rows[0];
  if (!row)
    throw internalError("Festival Square is missing from this town's story entities.");
  return row.id;
}

/**
 * Real DB truth for `canStartNewVisit`'s prior-job gate: the player's most
 * recently ended visit, left-joined through any `outbox` job it created and
 * that job's `ambient_job_executions` row. No prior ended visit, or one that
 * created no `outbox` job at all (no eligible event in its range), both
 * resolve to `"none"` — only a real `outbox` row with no terminal execution
 * yet resolves to `"processing"`.
 */
async function readPriorAmbientJobStatus(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<PriorAmbientJobStatus> {
  const result = await pool.query<{
    readonly outbox_id: string | null;
    readonly status: "processing" | "completed" | "quarantined" | null;
  }>(
    `SELECT ob.id AS outbox_id, aje.status
       FROM public.player_visits pv
       LEFT JOIN public.outbox ob
         ON ob.town_id = pv.town_id AND ob.visit_id = pv.id
       LEFT JOIN public.ambient_job_executions aje
         ON aje.town_id = ob.town_id AND aje.outbox_id = ob.id
      WHERE pv.town_id = $1 AND pv.player_id = $2 AND pv.status = 'ended'
      ORDER BY pv.ended_at DESC
      LIMIT 1`,
    [townId, playerId],
  );
  const row = result.rows[0];
  if (!row || row.outbox_id === null) return "none";
  return row.status ?? "processing";
}

export async function loadStartVisitInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<StartVisitLoadedInputs> {
  const [townActive, existingVisitId, festivalSquareLocationId, priorAmbientJobStatus] =
    await Promise.all([
      readTownActive(pool, context.townId),
      readActiveVisitId(pool, context.townId, context.playerId),
      readFestivalSquareLocationId(pool, context.townId),
      readPriorAmbientJobStatus(pool, context.townId, context.playerId),
    ]);

  return {
    townActive,
    hasActiveVisit: existingVisitId !== null,
    priorAmbientJobStatus,
    festivalSquareLocationId,
    playerId: context.playerId,
    existingVisitId,
  };
}

const GENERIC_DENIAL_MESSAGE = "That isn't possible right now.";

const START_VISIT_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  TOWN_NOT_ACTIVE: "This town isn't accepting visits right now.",
  PRIOR_VISIT_NOT_CLOSED:
    "Your last visit is still being wrapped up. Try again in a moment.",
};

export const startVisitActionHandler: ActionHandler<
  "start_visit",
  StartVisitLoadedInputs
> = {
  kind: "start_visit",
  loadInputs: loadStartVisitInputs,
  plan: planStartVisit,
  allocateInsertIds: () => ({ player_visits: randomUUID() }),
  buildResult(inputs, effects, insertIds): ActionResultByKind["start_visit"] {
    const applied = effects.length > 0;
    const visitId = applied ? insertIds["player_visits"]! : inputs.existingVisitId!;
    return {
      disposition: applied ? "started" : "already_active",
      visitId,
      locationId: inputs.festivalSquareLocationId,
    };
  },
  reasonMessage: (code) => START_VISIT_DENIAL_MESSAGES[code] ?? GENERIC_DENIAL_MESSAGE,
  resolveVisitId: (inputs, insertIds) =>
    insertIds["player_visits"] ?? inputs.existingVisitId,
  eventMetadata: (inputs) => ({
    actorId: inputs.playerId,
    locationEntityId: inputs.festivalSquareLocationId,
  }),
};
