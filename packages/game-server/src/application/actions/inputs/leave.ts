/**
 * `leave`'s `D3-N` narrow input loader and its full `ActionHandler`
 * (`P3-12`).
 *
 * The `D3-Q` guard lives in `plan()`: `rules#planLeaveVisit` returning an
 * `outbox` insert effect is an internal invariant violation in Phase 3 (no
 * event type any of the four enabled kinds can produce is ever
 * `ambient_eligible` — proved by a dedicated `rules` contract test), so
 * this throws rather than returning a `waiting` transition no worker exists
 * to service. The thrown error is deliberately **not** an `AppError`: it
 * falls through to the router's generic catch-all, the same opaque `500
 * INTERNAL_ERROR` any other unexpected bug produces, carrying no detail a
 * player could observe.
 */

import type { ActionResultByKind } from "@the-town-remembers/http-contracts";
import {
  deniedResult,
  dispatcherTrace,
  planLeaveVisit,
  type LeaveInputs,
  type ReasonCode,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { readPlayerAndVisit } from "../../../persistence/view-queries.js";
import type { ActionHandler, LoadInputsContext } from "../executor.js";

export interface LeaveLoadedInputs {
  readonly playerId: string;
  readonly townId: string;
  readonly townActive: boolean;
  readonly townRevision: number;
  readonly hasActiveVisit: boolean;
  readonly visitId: string | null;
  readonly lastEventSequenceAtLeave: number;
  readonly ambientScheduledThroughSequence: number;
  readonly eligibleEventCountInRange: number;
  readonly actionId: string;
  readonly now: Date;
}

/** Raised only by the `D3-Q` guard — never a normal player-facing outcome. */
export class AmbientIntentUnsupportedError extends Error {
  constructor() {
    super(
      "planLeaveVisit planned an outbox intent, which Phase 3 has no worker to service.",
    );
    this.name = "AmbientIntentUnsupportedError";
  }
}

async function readTownForLeave(
  pool: Pool,
  townId: string,
): Promise<{
  readonly active: boolean;
  readonly revision: number;
  readonly lastEventSequence: number;
  readonly ambientScheduledThroughSequence: number;
}> {
  const result = await pool.query<{
    readonly status: string;
    readonly revision: number;
    readonly last_event_sequence: number;
    readonly ambient_scheduled_through_sequence: number;
  }>(
    `SELECT status, revision, last_event_sequence, ambient_scheduled_through_sequence
       FROM public.towns WHERE id = $1`,
    [townId],
  );
  const row = result.rows[0]!;
  return {
    active: row.status === "active",
    revision: row.revision,
    lastEventSequence: row.last_event_sequence,
    ambientScheduledThroughSequence: row.ambient_scheduled_through_sequence,
  };
}

async function readEligibleEventCountInRange(
  pool: Pool,
  townId: string,
  scheduledThroughSequence: number,
  lastEventSequence: number,
): Promise<number> {
  const result = await pool.query<{ readonly n: number }>(
    `SELECT count(*)::int AS n FROM public.world_events
      WHERE town_id = $1 AND ambient_eligible = true
        AND sequence_no > $2 AND sequence_no <= $3`,
    [townId, scheduledThroughSequence, lastEventSequence],
  );
  return result.rows[0]!.n;
}

export async function loadLeaveInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<LeaveLoadedInputs> {
  const [town, playerAndVisit] = await Promise.all([
    readTownForLeave(pool, context.townId),
    readPlayerAndVisit(pool, context.townId, context.playerId),
  ]);
  const visitId = playerAndVisit?.visitId ?? null;
  const eligibleEventCountInRange = await readEligibleEventCountInRange(
    pool,
    context.townId,
    town.ambientScheduledThroughSequence,
    town.lastEventSequence,
  );

  return {
    playerId: context.playerId,
    townId: context.townId,
    townActive: town.active,
    townRevision: town.revision,
    hasActiveVisit: visitId !== null,
    visitId,
    lastEventSequenceAtLeave: town.lastEventSequence,
    ambientScheduledThroughSequence: town.ambientScheduledThroughSequence,
    eligibleEventCountInRange,
    actionId: context.actionId,
    now: context.now,
  };
}

const GENERIC_DENIAL_MESSAGE = "That isn't possible right now.";

const LEAVE_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  VISIT_NOT_ACTIVE: "You're not currently visiting this town.",
  TOWN_NOT_ACTIVE: "This town's story is no longer taking new moves.",
};

export const leaveActionHandler: ActionHandler<"leave", LeaveLoadedInputs> = {
  kind: "leave",
  loadInputs: loadLeaveInputs,
  plan(inputs) {
    // The frozen case: an active visit in a town that is no longer `active`
    // (docs/006: "active visits ... accept no further gameplay actions").
    // An away player falls through to `planLeaveVisit`'s own
    // `VISIT_NOT_ACTIVE` check below.
    if (inputs.hasActiveVisit && !inputs.townActive) {
      return deniedResult("TOWN_NOT_ACTIVE", dispatcherTrace("actions.leave"), {});
    }

    const rulesInputs: LeaveInputs = {
      hasActiveVisit: inputs.hasActiveVisit,
      lastEventSequenceAtLeave: inputs.lastEventSequenceAtLeave,
      eligibleEventCountInRange: inputs.eligibleEventCountInRange,
      ambientScheduledThroughSequence: inputs.ambientScheduledThroughSequence,
      townId: inputs.townId,
      townRevision: inputs.townRevision,
      visitId: inputs.visitId!,
      actionId: inputs.actionId,
      now: inputs.now,
    };
    const decision = planLeaveVisit(rulesInputs);
    if (
      decision.effects.some(
        (effect) => effect.kind === "insert" && effect.table === "outbox",
      )
    ) {
      throw new AmbientIntentUnsupportedError();
    }
    return decision;
  },
  buildResult(inputs): ActionResultByKind["leave"] {
    return { visitId: inputs.visitId!, transitionStatus: "not_required" };
  },
  reasonMessage: (code) => LEAVE_DENIAL_MESSAGES[code] ?? GENERIC_DENIAL_MESSAGE,
  resolveVisitId: (inputs) => inputs.visitId,
  eventMetadata: (inputs) => ({ actorId: inputs.playerId }),
};
