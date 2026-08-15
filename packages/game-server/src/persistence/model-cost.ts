/**
 * `model_cost_reservations` admission, settlement, and release (`P4-05`,
 * `D4-M`; docs/004 §"Cost mode ladder").
 *
 * Decision 004's ceiling is enforced at admission time, not at settlement:
 * `admitModelCost` re-reads the UTC billing month's already-settled actual
 * spend plus every still-`reserved` maximum, adds this call's own worst-case
 * reservation, and only inserts the row if the resulting projected total
 * still admits model calls (`resolveCostMode`/`modelCallsAdmitted`,
 * `@the-town-remembers/model-runtime`). Reading the aggregate and inserting
 * the new row happen in the same `SERIALIZABLE` transaction, so two
 * concurrent admissions racing the same boundary are a write-skew hazard
 * CockroachDB's own serializability detects: one commits, the other is
 * retried by `runSerializable` against the now-current sum. This mirrors
 * `rate-limits.ts`'s token bucket in spirit, though the shape here is a
 * read-aggregate-then-insert rather than a single guarded `UPDATE`, since a
 * reservation is a new row, not a mutation of one fixed-identity bucket row.
 *
 * `settleModelCost` and `releaseModelCost` can run in their own short
 * post-call transaction, while `model-runs.ts#appendRun` uses their
 * transaction-scoped helpers to finalize cost atomically with telemetry. The
 * model call itself happens over the network, between admission and
 * settlement, so it cannot be inside either transaction. Both are
 * conditional `UPDATE`s scoped to `status = 'reserved'`
 * and are safe to call more than once with the same reservation id — a
 * result already committed under an earlier, connection-lost attempt is
 * read back and returned rather than re-applied
 * (`ck_model_cost_reservations__settlement_shape`). A reservation whose call
 * outcome is still unknown is left untouched by both: it stays `reserved`
 * and keeps consuming ceiling capacity until some later call resolves it,
 * exactly as Decision 004 requires — nothing here expires a reservation by
 * wall-clock age.
 */

import {
  asBillingMonth,
  asUuid,
  runSerializable,
  type BillingMonth,
  type TransactionContext,
} from "@the-town-remembers/database";
import {
  decimalStringToMicroUsd,
  microUsdToDecimalString,
  modelCallsAdmitted,
  resolveCostMode,
  type CostMode,
} from "@the-town-remembers/model-runtime";
import type { Pool, QueryResultRow } from "pg";

import { logEvent } from "../observability/events.js";
import {
  recordModelCostAdmission,
  recordModelCostSettlement,
} from "../observability/metrics.js";

export function logModelCostSettlement(
  reservationId: string,
  status: "settled" | "released",
  clamped: boolean,
): void {
  logEvent({
    event: "model_cost_settlement",
    reservationId: asUuid(reservationId),
    status,
    clamped,
  });
  recordModelCostSettlement({ status, clamped });
}

/** Adapts a bare pool connection to `TransactionContext`, for a read used only to resolve an ambiguous commit outside any transaction. */
function poolAsTransactionContext(pool: Pool): TransactionContext {
  return {
    async query<Row extends QueryResultRow>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<Row[]> {
      const result = await pool.query<Row>(sql, [...parameters]);
      return result.rows;
    },
  };
}

export type ModelCostPurpose =
  | "claim_normalization"
  | "dialogue_selection"
  | "ambient_choice"
  | "structured_repair"
  | "episode_embedding"
  | "query_embedding";

/**
 * Exactly one caller identity (`ck_model_cost_reservations__single_source`),
 * and a town precisely when the caller is town-scoped
 * (`ck_model_cost_reservations__town_presence`) — the `non_game_operation`
 * arm structurally has no `townId` field, rather than a runtime check that a
 * caller could get wrong.
 */
export type ModelCostSource =
  | {
      readonly kind: "player_action";
      readonly townId: string;
      readonly playerActionId: string;
    }
  | {
      readonly kind: "ambient_job";
      readonly townId: string;
      readonly ambientJobExecutionId: string;
    }
  | {
      readonly kind: "world_event";
      readonly townId: string;
      readonly worldEventId: string;
    }
  | { readonly kind: "non_game_operation"; readonly nonGameOperationKey: string };

export interface AdmitModelCostParams {
  readonly reservationId: string;
  readonly source: ModelCostSource;
  /** Distinguishes retry/repair/revision-rerun reservations for the same source+purpose (`uq_model_cost_reservations__*`). */
  readonly attemptOrdinal: number;
  readonly purpose: ModelCostPurpose;
  readonly model: string;
  readonly inferenceProfile: string;
  readonly priceVersion: string;
  readonly maximumCostMicroUsd: number;
  readonly now: Date;
}

export type AdmitModelCostDecision =
  | { readonly admitted: true; readonly mode: CostMode }
  | { readonly admitted: false; readonly mode: CostMode };

/** First day of `date`'s UTC month, as `DATE` expects (`YYYY-MM-DD`). */
export function billingMonthFor(date: Date): BillingMonth {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return asBillingMonth(`${year}-${month}-01`);
}

function sourceColumns(source: ModelCostSource): {
  readonly townId: string | null;
  readonly playerActionId: string | null;
  readonly ambientJobExecutionId: string | null;
  readonly worldEventId: string | null;
  readonly nonGameOperationKey: string | null;
} {
  switch (source.kind) {
    case "player_action":
      return {
        townId: source.townId,
        playerActionId: source.playerActionId,
        ambientJobExecutionId: null,
        worldEventId: null,
        nonGameOperationKey: null,
      };
    case "ambient_job":
      return {
        townId: source.townId,
        playerActionId: null,
        ambientJobExecutionId: source.ambientJobExecutionId,
        worldEventId: null,
        nonGameOperationKey: null,
      };
    case "world_event":
      return {
        townId: source.townId,
        playerActionId: null,
        ambientJobExecutionId: null,
        worldEventId: source.worldEventId,
        nonGameOperationKey: null,
      };
    case "non_game_operation":
      return {
        townId: null,
        playerActionId: null,
        ambientJobExecutionId: null,
        worldEventId: null,
        nonGameOperationKey: source.nonGameOperationKey,
      };
  }
}

interface MonthlySpendRow {
  readonly settled_sum: string;
  readonly reserved_sum: string;
}

/**
 * The composable primitive: reads the billing month's committed spend and
 * outstanding reservations, decides admission, and inserts the reservation
 * row — all inside the caller's already-open transaction, so a caller that
 * needs to combine admission with another write (a future executor) can.
 */
export async function admitModelCost(
  transaction: TransactionContext,
  params: AdmitModelCostParams,
): Promise<AdmitModelCostDecision> {
  const billingMonth = billingMonthFor(params.now);

  const sums = await transaction.query<MonthlySpendRow>(
    `SELECT
        COALESCE(SUM(actual_cost) FILTER (WHERE status = 'settled'), 0::DECIMAL(12,6))::STRING AS settled_sum,
        COALESCE(SUM(maximum_cost) FILTER (WHERE status = 'reserved'), 0::DECIMAL(12,6))::STRING AS reserved_sum
       FROM public.model_cost_reservations
      WHERE billing_month = $1`,
    [billingMonth],
  );
  const row = sums[0]!;
  const projectedMicroUsd =
    decimalStringToMicroUsd(row.settled_sum) +
    decimalStringToMicroUsd(row.reserved_sum) +
    params.maximumCostMicroUsd;
  const mode = resolveCostMode(projectedMicroUsd);

  if (!modelCallsAdmitted(mode)) {
    return { admitted: false, mode };
  }

  const columns = sourceColumns(params.source);
  await transaction.query(
    `INSERT INTO public.model_cost_reservations
       (id, billing_month, town_id, player_action_id, ambient_job_execution_id,
        world_event_id, non_game_operation_key, attempt_ordinal, purpose, model,
        inference_profile, price_version, maximum_cost, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'reserved', $14)`,
    [
      params.reservationId,
      billingMonth,
      columns.townId,
      columns.playerActionId,
      columns.ambientJobExecutionId,
      columns.worldEventId,
      columns.nonGameOperationKey,
      params.attemptOrdinal,
      params.purpose,
      params.model,
      params.inferenceProfile,
      params.priceVersion,
      microUsdToDecimalString(params.maximumCostMicroUsd),
      params.now,
    ],
  );

  return { admitted: true, mode };
}

/**
 * Pool-scoped wrapper opening its own `SERIALIZABLE` transaction — the shape
 * a caller about to make a model call needs: reserve, see it committed, only
 * then call. An ambiguous commit is treated the same as rejection (never
 * admitted): the caller falls back rather than risking an uncounted spend,
 * matching `checkRateLimit`'s conservative choice on the same outcome.
 */
export async function reserveModelCost(
  pool: Pool,
  deadlineAt: number,
  params: AdmitModelCostParams,
): Promise<AdmitModelCostDecision> {
  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    admitModelCost(transaction, params),
  );
  const decision: AdmitModelCostDecision =
    result.outcome === "committed"
      ? result.value
      : { admitted: false, mode: "fallback_only" };

  // Logged once, here, after `runSerializable` has already settled (whether
  // by committing or by exhausting its retries into "ambiguous") — never
  // inside the transaction body, which can re-run more than once per call.
  logEvent({
    event: "model_cost_admission",
    purpose: params.purpose,
    attemptOrdinal: params.attemptOrdinal,
    admitted: decision.admitted,
    mode: decision.mode,
  });
  recordModelCostAdmission({
    purpose: params.purpose,
    admitted: decision.admitted,
    mode: decision.mode,
  });

  return decision;
}

export class ModelCostReservationNotSettleableError extends Error {
  constructor(reservationId: string, reason: string) {
    super(`Model cost reservation "${reservationId}" could not be settled: ${reason}`);
    this.name = "ModelCostReservationNotSettleableError";
  }
}

interface ReservationStateRow {
  readonly status: "reserved" | "settled" | "released";
  readonly maximum_cost: string;
  readonly actual_cost: string | null;
  readonly agent_run_id: string | null;
}

async function readReservationState(
  transaction: TransactionContext,
  reservationId: string,
): Promise<ReservationStateRow | undefined> {
  const rows = await transaction.query<ReservationStateRow>(
    `SELECT status, maximum_cost, actual_cost, agent_run_id
       FROM public.model_cost_reservations
      WHERE id = $1`,
    [reservationId],
  );
  return rows[0];
}

export interface SettleModelCostParams {
  readonly reservationId: string;
  readonly agentRunId: string;
  readonly settledCostMicroUsd: number;
  readonly now: Date;
}

export interface SettleModelCostResult {
  /** True when the real cost exceeded the reservation and was clamped down to it (`D4` settlement clamp, logged by the caller). */
  readonly clamped: boolean;
}

export async function settleModelCostInTransaction(
  transaction: TransactionContext,
  params: SettleModelCostParams,
): Promise<SettleModelCostResult> {
  const settledDecimal = microUsdToDecimalString(params.settledCostMicroUsd);
  const updated = await transaction.query<{
    readonly actual_cost: string;
  }>(
    `UPDATE public.model_cost_reservations
        SET status = 'settled', agent_run_id = $2,
            actual_cost = LEAST($3::DECIMAL(12,6), maximum_cost), settled_at = $4
      WHERE id = $1 AND status = 'reserved'
      RETURNING actual_cost`,
    [params.reservationId, params.agentRunId, settledDecimal, params.now],
  );
  if (updated.length > 0) {
    const clampedMicroUsd = decimalStringToMicroUsd(updated[0]!.actual_cost);
    return { clamped: clampedMicroUsd < params.settledCostMicroUsd };
  }

  // No `reserved` row matched — either this reservation was already settled
  // by an earlier attempt whose acknowledgement was lost (safe to treat as
  // success), or it is not settleable at all.
  const state = await readReservationState(transaction, params.reservationId);
  if (state === undefined) {
    throw new ModelCostReservationNotSettleableError(params.reservationId, "not found");
  }
  if (state.status === "settled" && state.agent_run_id === params.agentRunId) {
    const clampedMicroUsd = decimalStringToMicroUsd(state.actual_cost!);
    return { clamped: clampedMicroUsd < params.settledCostMicroUsd };
  }
  throw new ModelCostReservationNotSettleableError(
    params.reservationId,
    `status is "${state.status}", not "reserved"`,
  );
}

/**
 * Records a completed call's real cost against its reservation, clamping to
 * the reservation's maximum rather than throwing at the database
 * (`ck_model_cost_reservations__settlement_within_reservation`). Safe to
 * call again later with the same `reservationId` and `agentRunId` — an
 * ambiguous first attempt that actually landed is read back, not reapplied;
 * one that did not land leaves the row `reserved` for this same call to
 * settle whenever the true outcome becomes known.
 */
export async function settleModelCost(
  pool: Pool,
  deadlineAt: number,
  params: SettleModelCostParams,
): Promise<SettleModelCostResult> {
  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    settleModelCostInTransaction(transaction, params),
  );
  if (result.outcome === "committed") {
    logModelCostSettlement(params.reservationId, "settled", result.value.clamped);
    return result.value;
  }

  // The commit's fate is unknown; read the durable row rather than guess.
  const state = await readReservationState(
    poolAsTransactionContext(pool),
    params.reservationId,
  );
  if (state?.status === "settled" && state.agent_run_id === params.agentRunId) {
    const clampedMicroUsd = decimalStringToMicroUsd(state.actual_cost!);
    const clamped = clampedMicroUsd < params.settledCostMicroUsd;
    logModelCostSettlement(params.reservationId, "settled", clamped);
    return { clamped };
  }
  throw new ModelCostReservationNotSettleableError(
    params.reservationId,
    'settlement outcome is ambiguous and the durable row is still "reserved" — retry later once the call\'s true outcome is known',
  );
}

export async function releaseModelCostInTransaction(
  transaction: TransactionContext,
  reservationId: string,
  now: Date,
): Promise<void> {
  const updated = await transaction.query<{ readonly id: string }>(
    `UPDATE public.model_cost_reservations
        SET status = 'released', actual_cost = 0, settled_at = $2
      WHERE id = $1 AND status = 'reserved'
      RETURNING id`,
    [reservationId, now],
  );
  if (updated.length > 0) return;

  const state = await readReservationState(transaction, reservationId);
  if (state === undefined) {
    throw new ModelCostReservationNotSettleableError(reservationId, "not found");
  }
  if (state.status === "released") return;
  throw new ModelCostReservationNotSettleableError(
    reservationId,
    `status is "${state.status}", not "reserved"`,
  );
}

/**
 * Releases a reservation whose call is proven never to have happened (the
 * worst case never fit before the reserve, or a transport failure occurred
 * before any request was sent) — `actual_cost = 0`, freeing its maximum from
 * the monthly projection immediately rather than waiting for a later
 * settlement that will never come. Never call this for an outcome that is
 * merely *unknown*; that case must stay `reserved`.
 */
export async function releaseModelCost(
  pool: Pool,
  deadlineAt: number,
  reservationId: string,
  now: Date,
): Promise<void> {
  const result = await runSerializable(pool, { deadlineAt }, (transaction) =>
    releaseModelCostInTransaction(transaction, reservationId, now),
  );
  if (result.outcome === "committed") {
    logModelCostSettlement(reservationId, "released", false);
    return;
  }

  const state = await readReservationState(
    poolAsTransactionContext(pool),
    reservationId,
  );
  if (state?.status === "released") {
    logModelCostSettlement(reservationId, "released", false);
    return;
  }
  throw new ModelCostReservationNotSettleableError(
    reservationId,
    'release outcome is ambiguous and the durable row is still "reserved" — retry later',
  );
}

export interface ReadModelCostFinalizationParams {
  readonly kind: "settled" | "released";
  readonly reservationId: string;
  readonly agentRunId?: string;
  readonly settledCostMicroUsd?: number;
}

/** Resolves an ambiguous combined agent-run/finalization commit from durable state. */
export async function readModelCostFinalization(
  pool: Pool,
  params: ReadModelCostFinalizationParams,
): Promise<SettleModelCostResult | undefined> {
  const state = await readReservationState(
    poolAsTransactionContext(pool),
    params.reservationId,
  );
  if (params.kind === "released") {
    return state?.status === "released" ? { clamped: false } : undefined;
  }
  if (
    state?.status !== "settled" ||
    params.agentRunId === undefined ||
    state.agent_run_id !== params.agentRunId ||
    params.settledCostMicroUsd === undefined
  ) {
    return undefined;
  }
  const clampedMicroUsd = decimalStringToMicroUsd(state.actual_cost!);
  return { clamped: clampedMicroUsd < params.settledCostMicroUsd };
}

export interface MonthlyCostModeParams {
  readonly now: Date;
}

/** The cost mode the current committed+reserved monthly total resolves to, with no pending call added — used for read-only reporting, never for an admission decision. */
export async function currentCostMode(
  pool: Pool,
  params: MonthlyCostModeParams,
): Promise<CostMode> {
  const billingMonth = billingMonthFor(params.now);
  const result = await pool.query<MonthlySpendRow>(
    `SELECT
        COALESCE(SUM(actual_cost) FILTER (WHERE status = 'settled'), 0::DECIMAL(12,6))::STRING AS settled_sum,
        COALESCE(SUM(maximum_cost) FILTER (WHERE status = 'reserved'), 0::DECIMAL(12,6))::STRING AS reserved_sum
       FROM public.model_cost_reservations
      WHERE billing_month = $1`,
    [billingMonth],
  );
  const row = result.rows[0]!;
  return resolveCostMode(
    decimalStringToMicroUsd(row.settled_sum) +
      decimalStringToMicroUsd(row.reserved_sum),
  );
}
