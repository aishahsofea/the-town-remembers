/**
 * Metric recording for `packages/game-server` (`P3-18`).
 *
 * No real metrics backend exists yet — Phase 7 wires CloudWatch or an
 * equivalent. This module exists now so every dimension value recorded from
 * day one is validated against a closed set rather than retrofitted once a
 * real backend exists to point a dashboard at. Emission reuses the same safe
 * stdout channel `events.ts#logEvent` already writes to (each metric kind is
 * a `GameServerLogEvent` variant, defined in `events.ts` rather than here so
 * this module has no reverse dependency back onto its own types), so the
 * redaction tests already covering that channel (`P3-17`) cover metrics for
 * free — nothing here needs its own separate leak check.
 *
 * Every `recordX` function's *parameters* are already closed-enum-typed at
 * compile time; the runtime assertion inside each one is defense in depth,
 * matching this codebase's general style of not trusting a type alone at a
 * module boundary (`P3-18` acceptance 2) — useful the day a call site starts
 * threading a value through an `as`-widened type instead of a real one.
 */

import {
  AGENT_RUN_OUTCOMES,
  AGENT_RUN_PURPOSES,
  type AgentRunOutcome,
  type AgentRunPurpose,
  type RateLimitBucketKind,
} from "@the-town-remembers/database";
import type { ActionKind } from "@the-town-remembers/http-contracts";
import { COST_MODES, type CostMode } from "@the-town-remembers/model-runtime";

import { logEvent, type LoggableRouteTemplate } from "./events.js";

export const HTTP_METRIC_METHODS = ["GET", "POST"] as const;
export type HttpMetricMethod = (typeof HTTP_METRIC_METHODS)[number];

/** Every HTTP status this slice's routes can actually answer with. */
export const HTTP_METRIC_STATUSES = [
  200, 201, 202, 304, 400, 401, 403, 404, 409, 410, 422, 429, 500, 503,
] as const;
export type HttpMetricStatus = (typeof HTTP_METRIC_STATUSES)[number];

function assertMember<T>(
  declaredSet: readonly T[],
  value: T,
  dimensionName: string,
): void {
  if (!declaredSet.includes(value)) {
    throw new Error(
      `Metric dimension "${dimensionName}" received ${JSON.stringify(value)}, which is not a member of its declared closed set.`,
    );
  }
}

/**
 * HTTP latency and status, one point per completed request. `status` takes a
 * plain `number` — a real response status is a runtime value, never a
 * pre-narrowed literal, so its closed-set membership can only be checked
 * here, not by the type system at the call site.
 */
export function recordHttpLatency(params: {
  readonly routeTemplate: LoggableRouteTemplate;
  readonly method: HttpMetricMethod;
  readonly status: number;
  readonly latencyMs: number;
}): void {
  assertMember(HTTP_METRIC_METHODS, params.method, "method");
  assertMember(HTTP_METRIC_STATUSES, params.status as HttpMetricStatus, "status");
  logEvent({ event: "metric_http_latency", ...params });
}

/** How old a completed action's claim was by the time it finished, and how many retries/conflicts it took. */
export function recordActionProcessing(params: {
  readonly actionKind: ActionKind;
  readonly ageMs: number;
  readonly retries: number;
  readonly conflicts: number;
}): void {
  logEvent({ event: "metric_action_processing", ...params });
}

/** One admission decision, aggregatable by bucket into an admit/reject rate. */
export function recordRateLimitDecision(params: {
  readonly bucketKind: RateLimitBucketKind;
  readonly admitted: boolean;
}): void {
  logEvent({ event: "metric_rate_limit_decision", ...params });
}

/** Counted separately from the general processing metric: this is the terminal-failure case docs/007 bounds by rate, not by latency. */
export function recordActionProcessingExhausted(actionKind: ActionKind): void {
  logEvent({ event: "metric_action_processing_exhausted", actionKind });
}

/** One `model_cost_reservations` admission decision, aggregatable into an admit/reject rate per purpose and cost mode — never a dollar amount (`P4-05` acceptance 8). */
export function recordModelCostAdmission(params: {
  readonly purpose: AgentRunPurpose;
  readonly admitted: boolean;
  readonly mode: CostMode;
}): void {
  assertMember(AGENT_RUN_PURPOSES, params.purpose, "purpose");
  assertMember(COST_MODES, params.mode, "mode");
  logEvent({ event: "metric_model_cost_admission", ...params });
}

/** One resolved model call, aggregatable into latency and cost distributions per purpose and outcome. */
export function recordModelRun(params: {
  readonly purpose: AgentRunPurpose;
  readonly outcome: AgentRunOutcome;
  readonly latencyMs: number;
  readonly estimatedCostMicroUsd: number;
}): void {
  assertMember(AGENT_RUN_PURPOSES, params.purpose, "purpose");
  assertMember(AGENT_RUN_OUTCOMES, params.outcome, "outcome");
  logEvent({ event: "metric_model_run", ...params });
}

const RESERVATION_TERMINAL_STATUSES = ["settled", "released"] as const;

/** One reservation reaching a terminal state, aggregatable into a clamp rate — how often real cost exceeds the worst-case estimate that reserved for it. */
export function recordModelCostSettlement(params: {
  readonly status: "settled" | "released";
  readonly clamped: boolean;
}): void {
  assertMember(RESERVATION_TERMINAL_STATUSES, params.status, "status");
  logEvent({ event: "metric_model_cost_settlement", ...params });
}
