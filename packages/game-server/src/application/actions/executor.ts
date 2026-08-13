/**
 * The shared five-step command executor (`P3-09`; `D3-N`, `D3-O`).
 *
 * From the caller's side, per `packages/rules/README.md`'s "five-step action
 * order": authenticate and validate (the caller's job, before this runs) ->
 * create/claim the record (`persistence/actions.ts#claimAction`) -> load
 * per-kind inputs (`D3-N`'s narrow loaders, supplied by the caller as an
 * {@link ActionHandler}) -> call the pure planner -> build the completed
 * response with `buildSucceededResponse`/`buildDeniedResponse` -> validate it
 * against `CompletedActionResponseSchema` -> commit effects, numbered events,
 * response, completion, and `towns.revision` in one transaction
 * (`commit.ts#commitEffectPlan` plus `persistence/actions.ts#runCompleteActionUpdate`,
 * sharing the same `TransactionContext`).
 *
 * A gameplay denial or a `no_change` outcome has no effects to commit, so it
 * completes through the simpler, already-existing `completeAction` (its own
 * transaction) instead — there is nothing else that needs to share a
 * transaction with it.
 *
 * Town-revision retry (`D3-O`, docs/006 "Idempotency and conflicts"): a
 * guarded write's zero-row result (`commit.ts#RevisionConflictError`) or an
 * exhausted run of CockroachDB's own three short retries both mean the same
 * thing here — relevant state moved under us. Inputs are reloaded and the
 * plan rerun `MODEL_RETRIES.townRevisionRerunLimit` times (currently one);
 * a further conflict after that stores the accepted nonterminal `retryable`
 * `409 ACTION_CONFLICT` (`persistence/actions.ts#storeRetryableConflict`)
 * rather than looping again. This reuses the same accepted rerun-once budget
 * docs/006 states for a model-backed action's revision rerun — the plan
 * doc's own numbers do not distinguish a deterministic and a model-backed
 * conflict by kind, only by "town revision change".
 */

import { DatabaseError, asUuid, runSerializable } from "@the-town-remembers/database";
import type {
  ActionKind,
  ActionResultByKind,
  CompletedActionResponse,
} from "@the-town-remembers/http-contracts";
import { CompletedActionResponseSchema } from "@the-town-remembers/http-contracts";
import {
  buildDeniedResponse,
  buildSucceededResponse,
  type CompletedResponseFor,
  type DecisionResult,
  type EffectPlanEntry,
  type ReasonCode,
} from "@the-town-remembers/rules";
import { MODEL_RETRIES } from "@the-town-remembers/runtime-config/game";
import type { Pool } from "pg";

import {
  applicationDeadlineAt,
  preCommitDeadline,
  type OperationDeadline,
} from "../deadline.js";
import { logEvent } from "../../observability/events.js";
import { recordActionProcessing } from "../../observability/metrics.js";
import {
  claimAction,
  completeAction,
  runCompleteActionUpdate,
  storeRetryableConflict,
  type ClaimActionParams,
} from "../../persistence/actions.js";
import { actionRequestHash } from "../../security/fingerprint.js";
import { commitEffectPlan, RevisionConflictError } from "./commit.js";
import type { WorldEventMetadata } from "../../persistence/events.js";

/** One rerun after the first town-revision conflict, matching docs/006's accepted budget. */
const MAX_ATTEMPTS = MODEL_RETRIES.townRevisionRerunLimit + 1;

export interface LoadInputsContext {
  readonly townId: string;
  readonly playerId: string;
  readonly deadlineAt: number;
  /** The request's own target fields — a destination location, an inspectable, and so on. */
  readonly targetActorId: string | null;
  readonly targetEntityId: string | null;
  readonly requestPayload: Readonly<Record<string, unknown>>;
  /** This claimed action's own id — `leave`'s planner needs it up front for
   * `player_visits.ended_by_action_id`, unlike the other three kinds. */
  readonly actionId: string;
  /** A fresh reading per attempt, for a planner that timestamps its own effect
   * (`leave`'s `ended_at`). */
  readonly now: Date;
}

/**
 * The per-kind seam `P3-10`/`P3-11`/`P3-12` each fill in with one real
 * planner. `TInputs` is whatever that kind's narrow loader returns —
 * `StartVisitInputs`, `TravelInputs`, and so on.
 */
export interface ActionHandler<K extends ActionKind, TInputs> {
  readonly kind: K;
  loadInputs(pool: Pool, context: LoadInputsContext): Promise<TInputs>;
  plan(inputs: TInputs): DecisionResult<EffectPlanEntry>;
  /**
   * Pre-generates any identity an insert effect's row needs but does not
   * itself carry (`commit.ts#CommitEffectPlanParams.insertIds`) — for
   * example a new `player_visits.id`, which `start_visit`'s own response
   * must already know before the response is validated, let alone
   * committed. Called once per attempt, before `buildResult`.
   */
  allocateInsertIds?(inputs: TInputs): Readonly<Record<string, string>>;
  buildResult(
    inputs: TInputs,
    effects: readonly EffectPlanEntry[],
    insertIds: Readonly<Record<string, string>>,
  ): ActionResultByKind[K];
  reasonMessage(reasonCode: ReasonCode): string;
  /** The `player_actions.visit_id` this completed action should be attributed to, if any. */
  resolveVisitId?(
    inputs: TInputs,
    insertIds: Readonly<Record<string, string>>,
  ): string | null;
  eventMetadata?(inputs: TInputs): WorldEventMetadata;
}

export interface ExecuteActionParams<K extends ActionKind, TInputs> {
  readonly pool: Pool;
  readonly deadline: OperationDeadline;
  readonly townId: string;
  readonly playerId: string;
  readonly idempotencyKey: string;
  readonly actionKind: K;
  readonly targetActorId: string | null;
  readonly targetEntityId: string | null;
  readonly requestPayload: Readonly<Record<string, unknown>>;
  readonly handler: ActionHandler<K, TInputs>;
  readonly now: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly requestId: string;
}

export type ExecuteActionOutcome<K extends ActionKind> =
  | {
      readonly kind: "executed";
      readonly actionId: string;
      readonly responseStatus: number;
      readonly response: CompletedResponseFor<K>;
    }
  | {
      readonly kind: "processing";
      readonly actionId: string;
      readonly pollAfterMs: number;
    }
  | {
      readonly kind: "replay";
      readonly actionId: string;
      readonly status: "retryable" | "completed" | "failed";
      readonly responseStatus: number;
      readonly responsePayload: unknown;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly kind: "key_reused" }
  | { readonly kind: "blocked"; readonly blockingActionId: string };

/** `200`: every completed action — applied, no-change, or denied — is a successful synchronous response (docs/006: "Rule denials are completed `200` responses"). */
const COMPLETED_RESPONSE_STATUS = 200;

/** What the transaction body itself can conclude — it does not know its own retry count from the inside. */
type CommitBodyOutcome =
  { readonly kind: "ok"; readonly matched: boolean } | { readonly kind: "conflict" };

type CommitAttemptOutcome =
  | {
      readonly kind: "ok";
      readonly matched: boolean;
      readonly transactionRetries: number;
    }
  | { readonly kind: "conflict" };

async function attemptCommit<K extends ActionKind, TInputs>(
  params: ExecuteActionParams<K, TInputs>,
  actionId: string,
  attempt: number,
  processingToken: string,
  response: CompletedResponseFor<K>,
  effects: readonly EffectPlanEntry[],
  visitId: string | null,
  insertIds: Readonly<Record<string, string>>,
  eventMetadata: WorldEventMetadata | undefined,
): Promise<CommitAttemptOutcome> {
  const deadlineAt = applicationDeadlineAt(params.deadline);

  const result = await runSerializable(
    params.pool,
    { deadlineAt },
    async (transaction) => {
      try {
        await commitEffectPlan({
          transaction,
          townId: params.townId,
          playerId: params.playerId,
          actionId,
          idempotencyKey: params.idempotencyKey,
          effects,
          now: params.now(),
          insertIds,
          ...(eventMetadata ? { eventMetadata } : {}),
        });
      } catch (error) {
        if (error instanceof RevisionConflictError) {
          return { kind: "conflict" } as const satisfies CommitBodyOutcome;
        }
        throw error;
      }

      const completion = await runCompleteActionUpdate(transaction, params.now(), {
        townId: params.townId,
        actionId,
        processingToken,
        outcome: response.outcome,
        responseStatus: COMPLETED_RESPONSE_STATUS,
        responsePayload: response as unknown as Readonly<Record<string, unknown>>,
        visitId,
        now: params.now,
      });
      return {
        kind: "ok",
        matched: completion.matched,
      } as const satisfies CommitBodyOutcome;
    },
  ).catch((error: unknown) => {
    // `runSerializable` itself throws this once it exhausts its own three
    // short retries on a genuine CockroachDB serialization conflict — a
    // `RevisionConflictError` never reaches here, because the try/catch
    // above already turns it into `{ kind: "conflict" }` data before it can
    // propagate out of the transaction body.
    if (error instanceof DatabaseError && error.category === "serialization_conflict") {
      return { outcome: "committed", value: { kind: "conflict" }, retries: 0 } as const;
    }
    throw error;
  });

  if (result.outcome === "committed") {
    if (result.retries > 0) {
      logEvent({
        event: "action_lifecycle",
        requestId: params.requestId,
        actionKind: params.actionKind,
        actionId: asUuid(actionId),
        status: "conflict_retry",
        attempt,
        transactionRetries: result.retries,
      });
    }
    return result.value.kind === "ok"
      ? {
          kind: "ok",
          matched: result.value.matched,
          transactionRetries: result.retries,
        }
      : result.value;
  }

  // Ambiguous commit (`D3-O`): consult the durable ledger rather than guess.
  const status = await readCompletedStatus(params.pool, params.townId, actionId);
  const resolution = status === "completed" ? "applied" : "not_applied";
  logEvent({
    event: "action_lifecycle",
    requestId: params.requestId,
    actionKind: params.actionKind,
    actionId: asUuid(actionId),
    status: "ambiguous_resolved",
    attempt,
    ambiguousCommitResolution: resolution,
  });
  return resolution === "applied"
    ? { kind: "ok", matched: true, transactionRetries: 0 }
    : { kind: "ok", matched: false, transactionRetries: 0 };
}

async function readCompletedStatus(
  pool: Pool,
  townId: string,
  actionId: string,
): Promise<string | undefined> {
  const result = await pool.query<{ readonly status: string }>(
    "SELECT status FROM public.player_actions WHERE town_id = $1 AND id = $2",
    [townId, actionId],
  );
  return result.rows[0]?.status;
}

/** Raised when a claimed processing token no longer matches the durable row. */
export class StaleExecutionClaimError extends Error {
  constructor() {
    super("This worker's processing claim was replaced before it could commit.");
    this.name = "StaleExecutionClaimError";
  }
}

async function runClaimed<K extends ActionKind, TInputs>(
  params: ExecuteActionParams<K, TInputs>,
  actionId: string,
  processingToken: string,
): Promise<ExecuteActionOutcome<K>> {
  const startedAtMs = params.now().getTime();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const inputs = await params.handler.loadInputs(params.pool, {
      townId: params.townId,
      playerId: params.playerId,
      deadlineAt: preCommitDeadline(params.deadline),
      targetActorId: params.targetActorId,
      targetEntityId: params.targetEntityId,
      requestPayload: params.requestPayload,
      actionId,
      now: params.now(),
    });
    const decision = params.handler.plan(inputs);
    if (decision.outcome === "allowed") {
      // `allowed` is `DecisionResult`'s internal step-1 precondition gate
      // (packages/rules/src/kernel/decision.ts) — every real planner already
      // resolves to one of the three terminal outcomes before returning.
      throw new Error("A planner returned the non-terminal 'allowed' outcome.");
    }
    const insertIds = params.handler.allocateInsertIds?.(inputs) ?? {};

    const response: CompletedResponseFor<K> =
      decision.outcome === "denied"
        ? buildDeniedResponse(
            actionId,
            params.actionKind,
            decision.reasonCode,
            params.handler.reasonMessage(decision.reasonCode),
          )
        : buildSucceededResponse(
            actionId,
            params.actionKind,
            decision.outcome,
            params.handler.buildResult(inputs, decision.effects, insertIds),
          );
    CompletedActionResponseSchema.parse(response satisfies CompletedActionResponse);

    if (decision.outcome !== "applied") {
      await completeAction(params.pool, applicationDeadlineAt(params.deadline), {
        townId: params.townId,
        actionId,
        processingToken,
        outcome: decision.outcome,
        responseStatus: COMPLETED_RESPONSE_STATUS,
        responsePayload: response as unknown as Readonly<Record<string, unknown>>,
        visitId: null,
        now: params.now,
      });
      recordActionProcessing({
        actionKind: params.actionKind,
        ageMs: Math.max(0, params.now().getTime() - startedAtMs),
        retries: 0,
        conflicts: attempt,
      });
      return {
        kind: "executed",
        actionId,
        responseStatus: COMPLETED_RESPONSE_STATUS,
        response,
      };
    }

    const visitId = params.handler.resolveVisitId?.(inputs, insertIds) ?? null;
    const eventMetadata = params.handler.eventMetadata?.(inputs);
    const outcome = await attemptCommit(
      params,
      actionId,
      attempt,
      processingToken,
      response,
      decision.effects,
      visitId,
      insertIds,
      eventMetadata,
    );

    if (outcome.kind === "ok") {
      if (!outcome.matched) {
        logEvent({
          event: "action_lifecycle",
          requestId: params.requestId,
          actionKind: params.actionKind,
          actionId: asUuid(actionId),
          status: "stale_worker_rejected",
          attempt,
        });
        throw new StaleExecutionClaimError();
      }
      recordActionProcessing({
        actionKind: params.actionKind,
        ageMs: Math.max(0, params.now().getTime() - startedAtMs),
        retries: outcome.transactionRetries,
        conflicts: attempt,
      });
      return {
        kind: "executed",
        actionId,
        responseStatus: COMPLETED_RESPONSE_STATUS,
        response,
      };
    }
    // "conflict": relevant state moved under us. Loop again — the next
    // iteration reloads inputs and replans from scratch, never reusing this
    // attempt's stale snapshot.
    logEvent({
      event: "action_lifecycle",
      requestId: params.requestId,
      actionKind: params.actionKind,
      actionId: asUuid(actionId),
      status: "conflict_retry",
      attempt,
    });
  }

  const retryAfterAt = new Date(params.now().getTime() + 1_000);
  await storeRetryableConflict(params.pool, applicationDeadlineAt(params.deadline), {
    townId: params.townId,
    actionId,
    processingToken,
    retryAfterAt,
    now: params.now,
  });
  logEvent({
    event: "action_lifecycle",
    requestId: params.requestId,
    actionKind: params.actionKind,
    actionId: asUuid(actionId),
    status: "conflict_exhausted",
    attempt: MAX_ATTEMPTS,
    terminalErrorCode: "ACTION_CONFLICT",
  });
  return {
    kind: "replay",
    actionId,
    status: "retryable",
    responseStatus: 409,
    responsePayload: {
      code: "ACTION_CONFLICT",
      title: "Action conflict",
      detail: "The town changed while this action was processing. Retrying is safe.",
      fieldErrors: [],
    },
    retryAfterSeconds: 1,
  };
}

/** Claims, executes, and commits one player action end to end. */
export async function executeAction<K extends ActionKind, TInputs>(
  params: ExecuteActionParams<K, TInputs>,
): Promise<ExecuteActionOutcome<K>> {
  const requestHash = actionRequestHash({
    kind: params.actionKind,
    targetActorId: params.targetActorId,
    targetEntityId: params.targetEntityId,
    payload: params.requestPayload,
  });

  const claimParams: ClaimActionParams = {
    townId: params.townId,
    playerId: params.playerId,
    idempotencyKey: params.idempotencyKey,
    requestHash,
    actionKind: params.actionKind,
    requestPayload: params.requestPayload,
    targetActorId: params.targetActorId,
    targetEntityId: params.targetEntityId,
    now: params.now,
    deadlineAt: preCommitDeadline(params.deadline),
    requestId: params.requestId,
    ...(params.sleep ? { sleep: params.sleep } : {}),
  };
  const claim = await claimAction(params.pool, claimParams);

  switch (claim.outcome) {
    case "processing":
      return {
        kind: "processing",
        actionId: claim.actionId,
        pollAfterMs: claim.pollAfterMs,
      };
    case "key_reused":
      return { kind: "key_reused" };
    case "blocked":
      return { kind: "blocked", blockingActionId: claim.blockingActionId };
    case "replay":
      return {
        kind: "replay",
        actionId: claim.actionId,
        status: claim.status,
        responseStatus: claim.responseStatus,
        responsePayload: claim.responsePayload,
        retryAfterSeconds: claim.retryAfterSeconds,
      };
    case "claimed":
      return runClaimed(params, claim.actionId, claim.processingToken);
  }
}
