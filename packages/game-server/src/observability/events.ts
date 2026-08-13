/**
 * Closed structured-event union for `packages/game-server`.
 *
 * This is a diagnostic channel distinct from `apps/game-api`'s per-request
 * `http_request` summary: it exists for events raised from inside the
 * package's own dispatch and application logic, at the point a decision is
 * made rather than after the fact. Every field stays enumerated or
 * ID-shaped, the same discipline `apps/game-api/src/observability/log.ts`
 * already holds its own closed union to (`P3-17` acceptance 6,
 * `P3-18` acceptance 1) — no field here is a bare `string` that could hold
 * player-authored text; every such field is either a closed literal union
 * or a branded `Uuid`.
 */

import process from "node:process";

import type {
  AgentRunOutcome,
  AgentRunPurpose,
  RateLimitBucketKind,
  Uuid,
} from "@the-town-remembers/database";
import type {
  ActionKind,
  RouteTemplate,
  UNMATCHED_ROUTE_TEMPLATE,
} from "@the-town-remembers/http-contracts";
import type { CostMode, PricingModelKey } from "@the-town-remembers/model-runtime";

export type LoggableRouteTemplate = RouteTemplate | typeof UNMATCHED_ROUTE_TEMPLATE;

/**
 * Raised when the uniform failure boundary catches something other than an
 * `AppError` — the one place an unexpected internal failure becomes visible
 * without carrying the value that caused it.
 */
export interface UnexpectedErrorLogEvent {
  readonly event: "unexpected_error";
  readonly requestId: string;
  readonly routeTemplate: LoggableRouteTemplate;
}

/**
 * One point in a player action's lifecycle (`P3-18`): claimed, a
 * town-revision conflict that reran the plan, a stale worker's claim
 * rejected by a takeover, an ambiguous commit resolved against the durable
 * ledger, a claim taken over from an expired prior attempt, or the terminal
 * outcome. Never carries the request payload, the response body, or any
 * player-authored text — only identity and the closed decision itself.
 */
export const ACTION_LIFECYCLE_STATUSES = [
  "claimed",
  "executed",
  "conflict_retry",
  "conflict_exhausted",
  "stale_worker_rejected",
  "takeover",
  "processing_exhausted",
  "ambiguous_resolved",
] as const;
export type ActionLifecycleStatus = (typeof ACTION_LIFECYCLE_STATUSES)[number];

/** The only terminal error codes an action's own execution can itself report. */
export const ACTION_LIFECYCLE_ERROR_CODES = [
  "ACTION_CONFLICT",
  "ACTION_SUPERSEDED",
  "ACTION_PROCESSING_EXHAUSTED",
] as const;
export type ActionLifecycleErrorCode = (typeof ACTION_LIFECYCLE_ERROR_CODES)[number];

export interface ActionLifecycleLogEvent {
  readonly event: "action_lifecycle";
  readonly requestId: string;
  readonly actionKind: ActionKind;
  readonly actionId: Uuid;
  readonly status: ActionLifecycleStatus;
  /**
   * The executor's per-plan rerun counter (`P3-09`'s town-revision retry
   * budget) — meaningful for `conflict_retry`/`conflict_exhausted`/
   * `stale_worker_rejected`/`ambiguous_resolved` (all raised from inside
   * `application/actions/executor.ts`). The claim phase
   * (`persistence/actions.ts`'s `takeover`/`conflict_exhausted` for a
   * processing-token exhaustion) has no equivalent counter, so it is absent
   * there rather than a fabricated number.
   */
  readonly attempt?: number;
  readonly transactionRetries?: number;
  readonly ambiguousCommitResolution?: "applied" | "not_applied";
  readonly terminalErrorCode?: ActionLifecycleErrorCode;
}

/** One admission decision against a rate-limit bucket (`P3-18`). */
export interface RateLimitDecisionLogEvent {
  readonly event: "rate_limit_decision";
  readonly requestId: string;
  readonly bucketKind: RateLimitBucketKind;
  readonly admitted: boolean;
  readonly retryAfterSeconds?: number;
}

/**
 * One `model_cost_reservations` admission decision (`P4-05`). Never carries a
 * dollar amount — `mode` is the cost-ladder rung the projected total landed
 * on, which is enough to alert and dashboard from without exposing a figure
 * in a channel `test-support/redaction.ts` does not itself redact.
 */
export interface ModelCostAdmissionLogEvent {
  readonly event: "model_cost_admission";
  readonly purpose: AgentRunPurpose;
  readonly attemptOrdinal: number;
  readonly admitted: boolean;
  readonly mode: CostMode;
}

/**
 * A reservation's terminal outcome (`P4-05`): settled (with `clamped` true
 * when the real cost exceeded the reservation and was capped rather than
 * rejected at the database,
 * `ck_model_cost_reservations__settlement_within_reservation`) or released
 * (a proven non-call). Never the reservation's own dollar figures — `clamped`
 * is enough to alert on without a figure in a channel
 * `test-support/redaction.ts` does not itself redact.
 */
export interface ModelCostSettlementLogEvent {
  readonly event: "model_cost_settlement";
  readonly reservationId: Uuid;
  readonly status: "settled" | "released";
  readonly clamped: boolean;
}

/** One `agent_runs` row successfully recorded (`P4-05`) — never the prompt, the model's raw output, or player-authored text, only identity, versions, and measures. */
export interface ModelRunRecordedLogEvent {
  readonly event: "model_run_recorded";
  readonly runId: Uuid;
  readonly purpose: AgentRunPurpose;
  readonly model: PricingModelKey;
  readonly outcome: AgentRunOutcome;
  readonly latencyMs: number;
  readonly estimatedCostMicroUsd: number;
}

/**
 * The four `metrics.ts` (`P3-18`) event kinds. Defined here, not in
 * `metrics.ts`, so `metrics.ts` can import both the types and `logEvent`
 * from this one module without a circular dependency back the other way.
 */
export interface HttpLatencyMetricLogEvent {
  readonly event: "metric_http_latency";
  readonly routeTemplate: LoggableRouteTemplate;
  readonly method: "GET" | "POST";
  readonly status: number;
  readonly latencyMs: number;
}

export interface ActionProcessingMetricLogEvent {
  readonly event: "metric_action_processing";
  readonly actionKind: ActionKind;
  readonly ageMs: number;
  readonly retries: number;
  readonly conflicts: number;
}

export interface RateLimitMetricLogEvent {
  readonly event: "metric_rate_limit_decision";
  readonly bucketKind: RateLimitBucketKind;
  readonly admitted: boolean;
}

export interface ActionProcessingExhaustedMetricLogEvent {
  readonly event: "metric_action_processing_exhausted";
  readonly actionKind: ActionKind;
}

export interface ModelCostAdmissionMetricLogEvent {
  readonly event: "metric_model_cost_admission";
  readonly purpose: AgentRunPurpose;
  readonly admitted: boolean;
  readonly mode: CostMode;
}

export interface ModelRunMetricLogEvent {
  readonly event: "metric_model_run";
  readonly purpose: AgentRunPurpose;
  readonly outcome: AgentRunOutcome;
  readonly latencyMs: number;
  readonly estimatedCostMicroUsd: number;
}

export interface ModelCostSettlementMetricLogEvent {
  readonly event: "metric_model_cost_settlement";
  readonly status: "settled" | "released";
  readonly clamped: boolean;
}

export type GameServerLogEvent =
  | UnexpectedErrorLogEvent
  | ActionLifecycleLogEvent
  | RateLimitDecisionLogEvent
  | ModelCostAdmissionLogEvent
  | ModelCostSettlementLogEvent
  | ModelRunRecordedLogEvent
  | HttpLatencyMetricLogEvent
  | ActionProcessingMetricLogEvent
  | RateLimitMetricLogEvent
  | ActionProcessingExhaustedMetricLogEvent
  | ModelCostAdmissionMetricLogEvent
  | ModelRunMetricLogEvent
  | ModelCostSettlementMetricLogEvent;

/**
 * Writes exactly one JSON object per line directly to stdout, matching
 * `apps/game-api/src/observability/log.ts#logEvent`'s bypass of `console`.
 */
export function logEvent(event: GameServerLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
