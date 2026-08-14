/**
 * The model-aware command executor (`P4-10`; docs/006 "Idempotency and
 * conflicts", docs/010).
 *
 * Wraps the shipped deterministic executor's shape (`executor.ts`) around
 * the six model-backed action kinds' extra step: a planner
 * (`rules/actions/model-backed.ts`) may return `ExternalSelectionRequired`
 * instead of a terminal `DecisionResult`, in which case a model must be
 * called — and a network call cannot run inside a database transaction
 * (`no-network-in-transaction.test.ts`'s own invariant). This module never
 * calls a model itself; `ModelActionHandler.runModelSelection` is the
 * per-kind seam `P4-11`-`P4-16` each fill in with their own
 * `NpcContextBuilder` + Bedrock + validation/repair/fallback composition —
 * exactly the same extensibility `ActionHandler` already gives the four
 * deterministic kinds.
 *
 * Revision staleness is checked twice, for two different reasons. Model
 * work takes real wall-clock time with nothing holding a transaction open,
 * so the town state a model's dialogue was selected over can go stale in a
 * way no database isolation level protects against on its own: `towns.
 * revision` is read once before calling `runModelSelection` and once after,
 * and a mismatch discards the model's output outright (logged
 * `"superseded"`) rather than trying to commit it. That app-level check is
 * an optimization, not the authority — the final commit transaction *also*
 * carries an explicit `towns` `conditional_state_change` guard
 * (`expectedRevision` = the pre-model snapshot), so a race in the small
 * window between the post-model re-read and the transaction's own start is
 * still caught by `commit.ts#RevisionConflictError`, the identical
 * mechanism `travel`/`leave` already rely on. Either kind of loss triggers
 * the same bounded reload-and-rerun: inputs are reloaded and the planner
 * re-run from scratch (which is what re-validates visit/co-location,
 * custody, and gates — a fresh `loadInputs`/`plan` call re-checks all of
 * them, so no bespoke revalidation step is needed on top of the reload
 * itself), at most `MODEL_RETRIES.townRevisionRerunLimit` times; exhausting
 * that budget stores the identical saved retryable `409 ACTION_CONFLICT`
 * the deterministic executor's own exhaustion path stores
 * (`persistence/actions.ts#storeRetryableConflict` — `ck_player_actions__state_fields`
 * only ever accepts `error_code = 'ACTION_CONFLICT'` for a `retryable` row,
 * so there is no separate terminal code to invent here; `"superseded"` is
 * only ever a non-terminal per-attempt telemetry status).
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
  isExternalSelectionRequired,
  resumeWithDialogue,
  type ActionPlanResult,
  type CompletedResponseFor,
  type EffectPlanEntry,
  type ExternalSelectionRequired,
  type ReasonCode,
  type ValidatedDialogueResume,
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
  storeTerminalFailure,
  type ClaimActionParams,
  type StoredProblemBody,
} from "../../persistence/actions.js";
import { rateScopeKey } from "../../persistence/rate-limits.js";
import { actionRequestHash } from "../../security/fingerprint.js";
import { commitEffectPlan, RevisionConflictError } from "./commit.js";
import type { LoadInputsContext } from "./executor.js";
import type { WorldEventMetadata } from "../../persistence/events.js";

/** One rerun after the first revision loss — identical budget to `executor.ts`'s deterministic conflict retry (docs/006 does not distinguish the two by kind, only by "town revision change"). */
const MAX_ATTEMPTS = MODEL_RETRIES.townRevisionRerunLimit + 1;

const COMPLETED_RESPONSE_STATUS = 200;

export interface RunModelSelectionParams<TInputs> {
  readonly inputs: TInputs;
  readonly pending: ExternalSelectionRequired;
  /** Model work must finish by this instant, leaving the reserved commit window free — the same budget `preCommitDeadline` derives for a deterministic action's own pre-commit reads. */
  readonly deadlineAt: number;
  readonly attempt: number;
}

/**
 * The per-model-backed-kind seam. `TInputs` is whatever that kind's narrow
 * loader returns; `plan` returns the wider `ActionPlanResult` (a terminal
 * `DecisionResult` *or* `ExternalSelectionRequired`), unlike
 * `ActionHandler.plan`'s deterministic-only `DecisionResult`.
 */
export interface ModelActionHandler<
  K extends ActionKind,
  TInputs,
  TSelection extends ValidatedDialogueResume = ValidatedDialogueResume,
> {
  readonly kind: K;
  loadInputs(pool: Pool, context: LoadInputsContext): Promise<TInputs>;
  plan(inputs: TInputs): ActionPlanResult;
  /**
   * Calls a model and returns a validated (accepted, repaired, or authored
   * fallback) result — never a raw, unvalidated model response. Runs
   * outside any transaction; must finish by `params.deadlineAt`.
   */
  runModelSelection(params: RunModelSelectionParams<TInputs>): Promise<TSelection>;
  /**
   * Projects causal rows derived from the validated selection. This stays a
   * pure callback and runs before the final transaction; only the returned
   * effect data enters `commitEffectPlan`.
   */
  applySelection?(
    inputs: TInputs,
    pending: ExternalSelectionRequired,
    selection: TSelection,
  ): readonly EffectPlanEntry[];
  allocateInsertIds?(inputs: TInputs): Readonly<Record<string, string>>;
  buildResult(
    inputs: TInputs,
    effects: readonly EffectPlanEntry[],
    insertIds: Readonly<Record<string, string>>,
    selection?: TSelection,
  ): ActionResultByKind[K];
  reasonMessage(reasonCode: ReasonCode): string;
  resolveVisitId?(
    inputs: TInputs,
    insertIds: Readonly<Record<string, string>>,
  ): string | null;
  eventMetadata?(inputs: TInputs): WorldEventMetadata;
}

export interface ExecuteModelActionParams<
  K extends ActionKind,
  TInputs,
  TSelection extends ValidatedDialogueResume = ValidatedDialogueResume,
> {
  readonly pool: Pool;
  readonly deadline: OperationDeadline;
  readonly townId: string;
  readonly playerId: string;
  readonly idempotencyKey: string;
  readonly actionKind: K;
  readonly targetActorId: string | null;
  readonly targetEntityId: string | null;
  readonly requestPayload: Readonly<Record<string, unknown>>;
  readonly handler: ModelActionHandler<K, TInputs, TSelection>;
  readonly now: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly requestId: string;
}

export type ExecuteModelActionOutcome<K extends ActionKind> =
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
  | { readonly kind: "blocked"; readonly blockingActionId: string }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

async function readTownRevision(pool: Pool, townId: string): Promise<number> {
  const result = await pool.query<{ readonly revision: number }>(
    "SELECT revision FROM public.towns WHERE id = $1",
    [townId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Town "${townId}" does not exist.`);
  return row.revision;
}

type CommitBodyOutcome =
  { readonly kind: "ok"; readonly matched: boolean } | { readonly kind: "conflict" };

type CommitAttemptOutcome =
  | {
      readonly kind: "ok";
      readonly matched: boolean;
      readonly transactionRetries: number;
    }
  | { readonly kind: "conflict" };

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

/**
 * Commits the resumed effect plan, with an explicit `towns` guard against
 * `preModelRevision` — the authoritative revision check, on top of the
 * app-level pre/post snapshot comparison in the caller's loop.
 */
async function attemptModelCommit<
  K extends ActionKind,
  TInputs,
  TSelection extends ValidatedDialogueResume,
>(
  params: ExecuteModelActionParams<K, TInputs, TSelection>,
  actionId: string,
  attempt: number,
  processingToken: string,
  response: CompletedResponseFor<K>,
  effects: readonly EffectPlanEntry[],
  preModelRevision: number,
  visitId: string | null,
  insertIds: Readonly<Record<string, string>>,
  eventMetadata: WorldEventMetadata | undefined,
): Promise<CommitAttemptOutcome> {
  const deadlineAt = applicationDeadlineAt(params.deadline);
  const guardedEffects: readonly EffectPlanEntry[] = [
    {
      kind: "conditional_state_change",
      table: "towns",
      key: { id: params.townId },
      expectedRevision: preModelRevision,
      change: {},
    },
    ...effects,
  ];

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
          effects: guardedEffects,
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

async function runClaimedModelAction<
  K extends ActionKind,
  TInputs,
  TSelection extends ValidatedDialogueResume,
>(
  params: ExecuteModelActionParams<K, TInputs, TSelection>,
  actionId: string,
  processingToken: string,
): Promise<ExecuteModelActionOutcome<K>> {
  const startedAtMs = params.now().getTime();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const inputs = await params.handler.loadInputs(params.pool, {
      townId: params.townId,
      playerId: params.playerId,
      deadlineAt: preCommitDeadline(params.deadline),
      attempt,
      targetActorId: params.targetActorId,
      targetEntityId: params.targetEntityId,
      requestPayload: params.requestPayload,
      actionId,
      now: params.now(),
    });
    const plan = params.handler.plan(inputs);

    if (isExternalSelectionRequired(plan)) {
      const preModelRevision = await readTownRevision(params.pool, params.townId);
      let dialogue: TSelection;
      try {
        dialogue = await params.handler.runModelSelection({
          inputs,
          pending: plan,
          deadlineAt: preCommitDeadline(params.deadline),
          attempt,
        });
      } catch (error) {
        if (!(error instanceof ModelSelectionUnavailableError)) throw error;
        await storeTerminalFailure(
          params.pool,
          applicationDeadlineAt(params.deadline),
          {
            townId: params.townId,
            actionId,
            processingToken,
            responseStatus: error.responseStatus,
            problemBody: error.problemBody,
            now: params.now,
          },
        );
        logEvent({
          event: "action_lifecycle",
          requestId: params.requestId,
          actionKind: params.actionKind,
          actionId: asUuid(actionId),
          status: "model_unavailable",
          attempt,
          terminalErrorCode: "MODEL_UNAVAILABLE_RETRY_ACTION",
        });
        return {
          kind: "replay",
          actionId,
          status: "failed",
          responseStatus: error.responseStatus,
          responsePayload: error.problemBody,
          retryAfterSeconds: null,
        };
      }
      const postModelRevision = await readTownRevision(params.pool, params.townId);

      if (postModelRevision !== preModelRevision) {
        logEvent({
          event: "action_lifecycle",
          requestId: params.requestId,
          actionKind: params.actionKind,
          actionId: asUuid(actionId),
          status: "superseded",
          attempt,
        });
        continue;
      }
      const resumed = resumeWithDialogue(plan, dialogue);
      const decision = {
        ...resumed,
        effects: [
          ...resumed.effects,
          ...(params.handler.applySelection?.(inputs, plan, dialogue) ?? []),
        ],
      };
      if (decision.outcome !== "applied") {
        // `resumeWithDialogue`'s own implementation always returns
        // `"applied"` — this narrows the type accordingly and documents
        // the invariant rather than silently trusting it.
        throw new Error("resumeWithDialogue returned a non-applied outcome.");
      }

      const insertIds = params.handler.allocateInsertIds?.(inputs) ?? {};
      const response: CompletedResponseFor<K> = buildSucceededResponse(
        actionId,
        params.actionKind,
        decision.outcome,
        params.handler.buildResult(inputs, decision.effects, insertIds, dialogue),
      );
      CompletedActionResponseSchema.parse(response satisfies CompletedActionResponse);

      const visitId = params.handler.resolveVisitId?.(inputs, insertIds) ?? null;
      const eventMetadata = params.handler.eventMetadata?.(inputs);
      const outcome = await attemptModelCommit(
        params,
        actionId,
        attempt,
        processingToken,
        response,
        decision.effects,
        preModelRevision,
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
          throw new StaleModelExecutionClaimError();
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

      // The final transaction's own guard caught a race the app-level
      // pre/post revision comparison missed — the identical reload-and-
      // rerun treatment as a `superseded` loss above.
      logEvent({
        event: "action_lifecycle",
        requestId: params.requestId,
        actionKind: params.actionKind,
        actionId: asUuid(actionId),
        status: "superseded",
        attempt,
      });
      continue;
    }

    const decision = plan;
    if (decision.outcome === "allowed") {
      // `allowed` is `DecisionResult`'s internal step-1 precondition gate
      // (packages/rules/src/kernel/decision.ts) — every real planner
      // already resolves to one of the three terminal outcomes before
      // returning, matching `executor.ts`'s identical guard.
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

    // A terminal `applied` from the planner directly (no dialogue needed at
    // all) commits with no revision guard beyond `commitEffectPlan`'s own —
    // matching a deterministic action exactly, since nothing here read
    // town state that could have gone stale during a network call that
    // never happened.
    const visitId = params.handler.resolveVisitId?.(inputs, insertIds) ?? null;
    const eventMetadata = params.handler.eventMetadata?.(inputs);
    const outcome = await attemptModelCommit(
      params,
      actionId,
      attempt,
      processingToken,
      response,
      decision.effects,
      await readTownRevision(params.pool, params.townId),
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
        throw new StaleModelExecutionClaimError();
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

/**
 * Raised from `ModelActionHandler.runModelSelection` when a kind has no safe
 * authored fallback and the model's output stayed invalid through repair
 * (`D4-O`; docs/006's `503 MODEL_UNAVAILABLE_RETRY_ACTION`). Every
 * dialogue-shaped kind (`ask`, `tell`, ...) always resolves to *some*
 * `ValidatedDialogueResume` — an authored deflection is a safe last resort
 * for presentation text. `normalize_claim` has no such fallback: it cannot
 * present a proposition it never validated as though it were canonical.
 * Caught only here, one level above every handler, so the terminal-failure
 * write stays the single `storeTerminalFailure` call site regardless of
 * which kind raised it.
 */
export class ModelSelectionUnavailableError extends Error {
  readonly responseStatus: number;
  readonly problemBody: StoredProblemBody;

  constructor(responseStatus: number, problemBody: StoredProblemBody) {
    super(problemBody.detail);
    this.name = "ModelSelectionUnavailableError";
    this.responseStatus = responseStatus;
    this.problemBody = problemBody;
  }
}

/** Raised when a claimed processing token no longer matches the durable row. */
export class StaleModelExecutionClaimError extends Error {
  constructor() {
    super("This worker's processing claim was replaced before it could commit.");
    this.name = "StaleModelExecutionClaimError";
  }
}

/** Claims, executes (including any model call the planner requires), and commits one player action end to end. */
export async function executeModelAction<
  K extends ActionKind,
  TInputs,
  TSelection extends ValidatedDialogueResume = ValidatedDialogueResume,
>(
  params: ExecuteModelActionParams<K, TInputs, TSelection>,
): Promise<ExecuteModelActionOutcome<K>> {
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
    modelRateLimit: {
      playerScopeKey: rateScopeKey("player", params.townId, params.playerId),
      townScopeKey: rateScopeKey("town", params.townId, params.townId),
    },
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
    case "rate_limited":
      return {
        kind: "rate_limited",
        retryAfterSeconds: claim.retryAfterSeconds,
      };
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
      return runClaimedModelAction(params, claim.actionId, claim.processingToken);
  }
}
