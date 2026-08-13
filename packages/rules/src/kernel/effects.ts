/**
 * The three effect shapes a rule may emit. No shape carries a SQL statement
 * or a Kysely query object — only plain data orchestration can persist.
 *
 * `TRow` on {@link InsertEffect} is typically
 * `Omit<Insertable<XTable>, "id" | "town_id" | "created_at">`: the three
 * columns only the caller (which owns identity generation, tenancy, and the
 * transaction clock) can supply.
 *
 * `D4-F`: a plan may need to insert two rows in one table, or one row that
 * references another row the same plan just inserted (a `tell` plan's claim,
 * transmission, and episode, for instance) — impossible to express with only
 * `commitEffectPlan`'s pre-allocated `insertIds` map, which is keyed by table
 * name. {@link InsertEffect.ref} names such an insert; {@link PlanRef} is the
 * placeholder any later effect's `row`/`change` may use in place of a real id
 * to point back at it. `commitEffectPlan` resolves every `PlanRef` in plan
 * order and fails loudly on an unknown or forward reference — this package
 * only defines the shape, not the resolver.
 */

import type { EventType } from "@the-town-remembers/database/domains";

/**
 * A plan-local placeholder for another insert effect's not-yet-allocated id,
 * used in place of a real id inside a later effect's `row` or `change`.
 * Never persisted and never derived from a database id — resolved to the
 * real id by `commitEffectPlan` before any statement runs.
 */
export interface PlanRef {
  readonly $planRef: string;
}

export function isPlanRef(value: unknown): value is PlanRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "$planRef" in value &&
    typeof (value as { readonly $planRef: unknown }).$planRef === "string"
  );
}

export interface InsertEffect<TTable extends string = string, TRow = unknown> {
  readonly kind: "insert";
  readonly table: TTable;
  readonly row: TRow;
  /** Plan-local handle a later effect in the same plan may reference via `{ $planRef: ref }`. */
  readonly ref?: string;
}

/**
 * A change to an existing row. When the target table owns a `revision`
 * column, `expectedRevision` is the value the rule read that row at, and
 * orchestration must fail the whole plan (not apply a partial subset) if the
 * row's revision no longer matches at commit time. Some tables (for example
 * `player_visits`, `promises`) carry no `revision` column of their own —
 * `expectedRevision` is omitted for those, and the change is instead only
 * ever applied as part of a plan that also carries a `towns` conditional
 * state change guarding the whole transaction's revision.
 */
export interface ConditionalStateChangeEffect<
  TTable extends string = string,
  TChange = unknown,
> {
  readonly kind: "conditional_state_change";
  readonly table: TTable;
  readonly key: Readonly<Record<string, unknown>>;
  readonly expectedRevision?: number;
  readonly change: TChange;
}

/** Origin metadata for the world event a plan's other effects attach to. */
export interface EventOriginEffect {
  readonly kind: "event_origin";
  readonly eventType: EventType;
  readonly effectIndex: number;
}

export type EffectPlanEntry<
  TTable extends string = string,
  TRow = unknown,
  TChange = unknown,
> =
  | InsertEffect<TTable, TRow>
  | ConditionalStateChangeEffect<TTable, TChange>
  | EventOriginEffect;

export function isInsertEffect(entry: EffectPlanEntry): entry is InsertEffect {
  return entry.kind === "insert";
}

export function isConditionalStateChangeEffect(
  entry: EffectPlanEntry,
): entry is ConditionalStateChangeEffect {
  return entry.kind === "conditional_state_change";
}

export function isEventOriginEffect(
  entry: EffectPlanEntry,
): entry is EventOriginEffect {
  return entry.kind === "event_origin";
}
