/**
 * Effect-plan -> parameterized writes (`P3-09`).
 *
 * This is where the Phase 2 handoff is bound: every `EffectPlanEntry` a
 * planner emits is plain data, never a SQL statement, and this module is the
 * one place that turns it into one. Three things happen atomically inside
 * the caller's transaction, in this order:
 *
 * 1. `towns` is bumped exactly once — `revision += 1` unconditionally (every
 *    committed action moves it by exactly one, `P3-09` acceptance 1) and
 *    `last_event_sequence` by however many `event_origin` effects the plan
 *    carries (usually one; Phase 6's `resolve` can carry two). If the plan
 *    also carries an explicit `conditional_state_change` on `towns` (Decision
 *    008 §5's revision guard — `travel`/`leave` need this because they also
 *    change `player_visits`, which has no `revision` column of its own), its
 *    `expectedRevision` becomes an extra `WHERE revision = $n` on this same
 *    statement, and its `change` columns ride along in the same `SET`. A
 *    zero-row result — someone else committed first — discards the whole
 *    plan via {@link RevisionConflictError} rather than applying a partial
 *    subset.
 * 2. Each `event_origin` effect becomes one `world_events` row, numbered from
 *    the just-reserved sequence range, in plan order.
 * 3. Each remaining effect becomes an `INSERT` or a guarded `UPDATE`, in plan
 *    order. An insert's row is augmented with the three columns
 *    {@link ../../../rules/src/kernel/effects.ts | `effects.ts`} documents as
 *    the caller's (`id`, `town_id`, `created_at`), plus whatever this
 *    module's own small per-table default table supplies for context the
 *    rules layer never sees (identity, timestamps) — see
 *    `TABLE_INSERT_DEFAULTS`. A conditional state change carrying its own
 *    `expectedRevision` gets the same `WHERE revision = $n` treatment as
 *    `towns`.
 */

import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@the-town-remembers/database";
import {
  isConditionalStateChangeEffect,
  isEventOriginEffect,
  isInsertEffect,
  isPlanRef,
  type ConditionalStateChangeEffect,
  type EffectPlanEntry,
  type InsertEffect,
} from "@the-town-remembers/rules";

import {
  appendPlayerEvent,
  type WorldEventMetadata,
} from "../../persistence/events.js";

/**
 * Raised when a conditional write's `WHERE revision = $n` (or, for a
 * revision-less table, its plain key) predicate matches zero rows. The whole
 * plan is discarded — nothing else this call wrote survives, because the
 * caller's transaction rolls back when this propagates out of it.
 */
export class RevisionConflictError extends Error {
  constructor(table: string) {
    super(`A conditional write to "${table}" no longer matched its expected row.`);
    this.name = "RevisionConflictError";
  }
}

/**
 * `D4-F`: raised for a `{ $planRef }` that names no earlier `InsertEffect.ref`
 * in the same plan — an unknown handle, or one declared later (a forward
 * reference, since a plan-local id does not exist until its own insert
 * effect runs). {@link validatePlanRefs} raises this before any statement
 * executes; {@link resolveRecord} raises the identical error at apply time
 * as defense in depth, in case a future caller ever bypasses the pre-pass.
 */
export class UnknownPlanRefError extends Error {
  constructor(ref: string) {
    super(`Effect plan references unknown or forward handle "${ref}".`);
    this.name = "UnknownPlanRefError";
  }
}

function resolveValue(value: unknown, idByRef: ReadonlyMap<string, string>): unknown {
  if (!isPlanRef(value)) return value;
  const resolved = idByRef.get(value.$planRef);
  if (resolved === undefined) throw new UnknownPlanRefError(value.$planRef);
  return resolved;
}

/** Resolves every top-level `PlanRef` value in a flat `row`/`change`/`key` record — `effects.ts`'s own `TRow`/`TChange` shapes are flat, so no deeper scan is needed. */
function resolveRecord(
  record: Readonly<Record<string, unknown>>,
  idByRef: ReadonlyMap<string, string>,
): Readonly<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveValue(value, idByRef);
  }
  return resolved;
}

function assertRecordResolvable(
  record: Readonly<Record<string, unknown>>,
  declaredRefs: ReadonlySet<string>,
): void {
  for (const value of Object.values(record)) {
    if (isPlanRef(value) && !declaredRefs.has(value.$planRef)) {
      throw new UnknownPlanRefError(value.$planRef);
    }
  }
}

/**
 * Validates every `PlanRef` in the plan resolves to an `InsertEffect.ref`
 * declared *earlier* in the same plan — run once, before `commitEffectPlan`
 * issues its first statement, so an unknown or forward handle fails closed
 * rather than committing a partial plan and rolling back.
 */
function validatePlanRefs(effects: readonly EffectPlanEntry[]): void {
  const declaredRefs = new Set<string>();
  for (const effect of effects) {
    if (isInsertEffect(effect)) {
      assertRecordResolvable(
        effect.row as Readonly<Record<string, unknown>>,
        declaredRefs,
      );
      if (effect.ref !== undefined) declaredRefs.add(effect.ref);
    } else if (isConditionalStateChangeEffect(effect)) {
      assertRecordResolvable(
        effect.change as Readonly<Record<string, unknown>>,
        declaredRefs,
      );
      assertRecordResolvable(effect.key, declaredRefs);
    }
  }
}

/**
 * Every identifier this module interpolates comes from the trusted rules
 * layer, never from a player-supplied value — but a dynamic-SQL boundary
 * gets the same shape check as every other one in this repository regardless
 * of who the caller is, as defense in depth against a future planner bug.
 */
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function assertSafeIdentifier(identifier: string): void {
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(
      `Refusing to interpolate an unsafe SQL identifier: "${identifier}"`,
    );
  }
}

/**
 * Tables whose insert-effect row cannot carry the event this plan originates
 * — structural, schema-derived (which column is the foreign key), not
 * per-kind business logic. The value actually used is always the most
 * recently created event at the point this insert is processed, matching
 * every existing planner's own effect ordering (an insert that needs an
 * event always follows that event's `event_origin` effect in the list).
 */
const EVENT_FOREIGN_KEY_COLUMN: Readonly<Partial<Record<string, string>>> = {
  clue_discoveries: "event_id",
  case_board_entries: "source_event_id",
  outbox: "source_event_id",
  // `episodes.event_id` (`P4-10`) — added ahead of any real planner using it,
  // for the same structural reason as the three above: NOT NULL, always this
  // plan's own event, never a per-kind business decision.
  episodes: "event_id",
};

/**
 * The `conditional_state_change` analogue of {@link EVENT_FOREIGN_KEY_COLUMN}:
 * `items.revealed_event_id` is set from this plan's own just-created event,
 * exactly like an insert's event-linked column, but a guarded `UPDATE` has no
 * shared backfill step of its own (`applyConditionalStateChange` only ever
 * applies whatever `change` the planner already supplied). `planInspect`
 * cannot know the event's id at plan time — it does not exist until
 * {@link commitEffectPlan}'s own `event_origin` step runs — so this table is
 * the one place that backfill happens for a state change rather than an
 * insert (`P3-11`; content/evidence.ts's own comment: "Revealing the bell
 * sets `revealed_event_id`").
 */
const CONDITIONAL_CHANGE_EVENT_FOREIGN_KEY_COLUMN: Readonly<
  Partial<Record<string, string>>
> = {
  items: "revealed_event_id",
};

/**
 * Tables with no `created_at` column of their own — `player_visits` records
 * `started_at` instead. Every other insert-effect table in this schema
 * carries `created_at`, so this stays the one named exception rather than a
 * per-table opt-in every table would otherwise need.
 */
const TABLES_WITHOUT_CREATED_AT: ReadonlySet<string> = new Set(["player_visits"]);

/**
 * Context an insert-effect row cannot carry because the rules layer never
 * sees it: identity (`player_visits.player_id`), the just-computed town
 * revision (`start_revision` mirrors `towns.revision` immediately after this
 * commit — see `planLeaveVisit`'s own `end_revision: townRevision + 1` for
 * the same convention on the other end of a visit), and this action's own id
 * (`started_by_action_id`). Mirrors `persistence/players.ts#bootstrapStartVisit`,
 * which hand-writes the same defaults for the synthetic join-time visit.
 */
function tableInsertDefaults(
  table: string,
  context: {
    readonly playerId: string;
    readonly actionId: string;
    readonly now: Date;
    readonly revision: number;
  },
): Readonly<Record<string, unknown>> {
  if (table === "player_visits") {
    return {
      player_id: context.playerId,
      current_location_entity_type: "location",
      start_revision: context.revision,
      started_by_action_id: context.actionId,
      started_at: context.now,
    };
  }
  return {};
}

export interface CommitEffectPlanParams {
  readonly transaction: TransactionContext;
  readonly townId: string;
  readonly playerId: string;
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly effects: readonly EffectPlanEntry[];
  readonly now: Date;
  /** Recorded on every `world_events` row this plan originates. */
  readonly eventMetadata?: WorldEventMetadata;
  /**
   * A pre-generated `id` to use for an insert effect's row, keyed by table
   * name, for the rare table whose id the caller must already know before
   * committing — `player_visits.id` becomes `start_visit`'s own response
   * `visitId`, and that response is built (and schema-validated) before this
   * function ever runs. Any table not named here gets a fresh random id, as
   * usual.
   */
  readonly insertIds?: Readonly<Record<string, string>>;
}

export interface CommitEffectPlanResult {
  readonly revision: number;
  readonly eventIds: readonly string[];
}

interface TownGuard {
  readonly expectedRevision: number | undefined;
  readonly change: Readonly<Record<string, unknown>>;
}

function extractTownGuard(effects: readonly EffectPlanEntry[]): TownGuard | undefined {
  const townEffect = effects.find(
    (effect) => isConditionalStateChangeEffect(effect) && effect.table === "towns",
  );
  if (townEffect === undefined || !isConditionalStateChangeEffect(townEffect))
    return undefined;
  return {
    expectedRevision: townEffect.expectedRevision,
    change: townEffect.change as Readonly<Record<string, unknown>>,
  };
}

async function bumpTown(
  transaction: TransactionContext,
  townId: string,
  now: Date,
  eventCount: number,
  guard: TownGuard | undefined,
): Promise<{ revision: number; firstSequenceNo: number }> {
  const setClauses = [
    "revision = revision + 1",
    `last_event_sequence = last_event_sequence + ${eventCount}`,
    "updated_at = $2",
  ];
  const parameters: unknown[] = [townId, now];

  if (guard) {
    for (const [column, value] of Object.entries(guard.change)) {
      assertSafeIdentifier(column);
      parameters.push(value);
      setClauses.push(`${column} = $${parameters.length}`);
    }
  }

  let sql = `UPDATE public.towns SET ${setClauses.join(", ")} WHERE id = $1`;
  if (guard?.expectedRevision !== undefined) {
    parameters.push(guard.expectedRevision);
    sql += ` AND revision = $${parameters.length}`;
  }
  sql += " RETURNING revision, last_event_sequence";

  const rows = await transaction.query<{
    readonly revision: number;
    readonly last_event_sequence: number;
  }>(sql, parameters);
  const row = rows[0];
  if (row === undefined) throw new RevisionConflictError("towns");
  return {
    revision: row.revision,
    firstSequenceNo: row.last_event_sequence - eventCount + 1,
  };
}

async function applyInsert(
  transaction: TransactionContext,
  townId: string,
  now: Date,
  revision: number,
  playerId: string,
  actionId: string,
  mostRecentEventId: string | undefined,
  insertIds: Readonly<Record<string, string>>,
  idByRef: ReadonlyMap<string, string>,
  effect: InsertEffect,
): Promise<string> {
  assertSafeIdentifier(effect.table);

  const resolvedEffectRow = resolveRecord(
    effect.row as Readonly<Record<string, unknown>>,
    idByRef,
  );
  const id = insertIds[effect.table] ?? randomUUID();
  const row: Record<string, unknown> = {
    ...tableInsertDefaults(effect.table, { playerId, actionId, now, revision }),
    ...resolvedEffectRow,
    id,
    town_id: townId,
    ...(TABLES_WITHOUT_CREATED_AT.has(effect.table) ? {} : { created_at: now }),
  };

  const eventColumn = EVENT_FOREIGN_KEY_COLUMN[effect.table];
  if (eventColumn !== undefined && !(eventColumn in row)) {
    if (mostRecentEventId === undefined) {
      throw new Error(
        `"${effect.table}" needs the plan's event id, but no event_origin effect ran before it.`,
      );
    }
    row[eventColumn] = mostRecentEventId;
  }

  const columns = Object.keys(row);
  for (const column of columns) assertSafeIdentifier(column);
  const placeholders = columns.map((_, index) => `$${index + 1}`);

  await transaction.query(
    `INSERT INTO public.${effect.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`,
    columns.map((column) => row[column]),
  );
  return id;
}

async function applyConditionalStateChange(
  transaction: TransactionContext,
  townId: string,
  mostRecentEventId: string | undefined,
  idByRef: ReadonlyMap<string, string>,
  effect: ConditionalStateChangeEffect,
): Promise<void> {
  assertSafeIdentifier(effect.table);
  const change = resolveRecord(
    effect.change as Readonly<Record<string, unknown>>,
    idByRef,
  );
  const key = resolveRecord(effect.key, idByRef);

  // Auto-backfilled separately from `change` (rather than merged into it) so
  // its SET clause can be `COALESCE(column, $n)` — `items.revealed_event_id`
  // is immutable once set (docs/005), and a later, unrelated `items` state
  // change (`resolve`'s bell relocation, Phase 6) must never overwrite an
  // already-revealed item's event id with its own.
  const eventColumn = CONDITIONAL_CHANGE_EVENT_FOREIGN_KEY_COLUMN[effect.table];
  const needsEventBackfill = eventColumn !== undefined && !(eventColumn in change);
  if (needsEventBackfill && mostRecentEventId === undefined) {
    throw new Error(
      `"${effect.table}" needs the plan's event id, but no event_origin effect ran before it.`,
    );
  }

  for (const column of [
    ...Object.keys(change),
    ...Object.keys(key),
    ...(needsEventBackfill ? [eventColumn] : []),
  ]) {
    assertSafeIdentifier(column);
  }

  const parameters: unknown[] = [townId];
  const setClauses = Object.entries(change).map(([column, value]) => {
    parameters.push(value);
    return `${column} = $${parameters.length}`;
  });
  if (needsEventBackfill) {
    parameters.push(mostRecentEventId);
    setClauses.push(`${eventColumn} = COALESCE(${eventColumn}, $${parameters.length})`);
  }
  if (effect.expectedRevision !== undefined) {
    setClauses.push("revision = revision + 1");
  }

  const whereClauses = Object.entries(key).map(([column, value]) => {
    parameters.push(value);
    return `${column} = $${parameters.length}`;
  });
  if (effect.expectedRevision !== undefined) {
    parameters.push(effect.expectedRevision);
    whereClauses.push(`revision = $${parameters.length}`);
  }

  const rows = await transaction.query<{ readonly id: unknown }>(
    `UPDATE public.${effect.table} SET ${setClauses.join(", ")}
      WHERE town_id = $1 AND ${whereClauses.join(" AND ")}
      RETURNING id`,
    parameters,
  );
  if (rows.length === 0) throw new RevisionConflictError(effect.table);
}

/** Commits one already-planned effect list atomically inside the caller's transaction. */
export async function commitEffectPlan(
  params: CommitEffectPlanParams,
): Promise<CommitEffectPlanResult> {
  // `D4-F`: fails closed on an unknown or forward `PlanRef` before any
  // statement runs — not just relying on the transaction rollback an error
  // partway through application would also produce.
  validatePlanRefs(params.effects);

  const eventOrigins = params.effects.filter(isEventOriginEffect);
  const townGuard = extractTownGuard(params.effects);
  const { revision, firstSequenceNo } = await bumpTown(
    params.transaction,
    params.townId,
    params.now,
    eventOrigins.length,
    townGuard,
  );

  const eventIds: string[] = [];
  let mostRecentEventId: string | undefined;
  const idByRef = new Map<string, string>();

  for (const effect of params.effects) {
    if (isEventOriginEffect(effect)) {
      const sequenceNo = firstSequenceNo + eventIds.length;
      const eventId = await appendPlayerEvent({
        transaction: params.transaction,
        townId: params.townId,
        sequenceNo,
        eventType: effect.eventType,
        occurredAt: params.now,
        playerActionId: params.actionId,
        effectIndex: effect.effectIndex,
        idempotencyKey: params.idempotencyKey,
        ...(params.eventMetadata ? { metadata: params.eventMetadata } : {}),
      });
      eventIds.push(eventId);
      mostRecentEventId = eventId;
      continue;
    }
    if (isInsertEffect(effect)) {
      const id = await applyInsert(
        params.transaction,
        params.townId,
        params.now,
        revision,
        params.playerId,
        params.actionId,
        mostRecentEventId,
        params.insertIds ?? {},
        idByRef,
        effect,
      );
      if (effect.ref !== undefined) idByRef.set(effect.ref, id);
      continue;
    }
    if (isConditionalStateChangeEffect(effect)) {
      if (effect.table === "towns") continue; // already applied by bumpTown above.
      await applyConditionalStateChange(
        params.transaction,
        params.townId,
        mostRecentEventId,
        idByRef,
        effect,
      );
    }
  }

  return { revision, eventIds };
}
