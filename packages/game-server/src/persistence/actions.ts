/**
 * `player_actions` claim, replay, conflict, and completion state machine
 * (`P3-08`, `D3-O`; docs/006 §"Idempotency and conflicts").
 *
 * The schema already enforces the hard invariants: `uq_player_actions__idempotency_key`
 * scopes one row per `(town_id, player_id, idempotency_key)`, and the partial
 * `uq_player_actions__one_processing` index allows at most one `processing`
 * row per `(town_id, player_id)`. This module's job is to drive the
 * transitions `application/actions/ledger.ts#decideAction` names with
 * conditional statements, never a read followed by an unconditional write —
 * every mutating statement matches its own precondition in the `WHERE`
 * clause, so a stale worker's write is rejected by the database itself
 * rather than trusted to have not raced.
 *
 * `response_payload` for a `retryable` or `failed` row stores the problem
 * body *without* `requestId`: that field names the request asking right now,
 * not the request that first wrote the row, so it is attached fresh by the
 * caller serving the read (the action-status route, or the executor) rather
 * than frozen at write time.
 */

import { randomUUID } from "node:crypto";

import {
  DatabaseError,
  asUuid,
  resolveAmbiguousCommit,
  runSerializable,
  type TransactionContext,
} from "@the-town-remembers/database";
import type { ActionKind } from "@the-town-remembers/http-contracts";
import type { Pool } from "pg";

import { logEvent, type ActionLifecycleErrorCode } from "../observability/events.js";
import { recordActionProcessingExhausted } from "../observability/metrics.js";
import {
  decideAction,
  type ActionRecordStatus,
  type BlockingActionRow,
  type ExistingActionRow,
  type LedgerDecision,
} from "../application/actions/ledger.js";
import { isDatabaseUuid } from "./identifiers.js";
import { admitRateLimitsAtomically, RATE_LIMIT_BUCKETS } from "./rate-limits.js";

/** Docs/007: player processing claims last 35 seconds and do not renew. */
const CLAIM_MS = 35_000;
/** Docs/006: the browser polls the action-status route every two seconds. */
export const POLL_AFTER_MS = 2_000;

/** Raised when a conditional completion or transition matches zero rows: the
 * caller's claim was replaced by a takeover before it could commit. */
export class StaleProcessingClaimError extends Error {
  constructor() {
    super("This worker's processing claim was replaced before it could commit.");
    this.name = "StaleProcessingClaimError";
  }
}

export interface StoredProblemBody {
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors: readonly {
    readonly path: string;
    readonly code: string;
    readonly message: string;
  }[];
}

const SUPERSEDED_BODY: StoredProblemBody = {
  code: "ACTION_SUPERSEDED",
  title: "Action superseded",
  detail: "The earlier action closed safely and changed nothing.",
  fieldErrors: [],
};

const EXHAUSTED_BODY: StoredProblemBody = {
  code: "ACTION_PROCESSING_EXHAUSTED",
  title: "Action processing exhausted",
  detail: "The town could not finish that action. Nothing changed.",
  fieldErrors: [],
};

interface RawExistingRow {
  readonly id: string;
  readonly request_hash: Buffer;
  readonly status: ActionRecordStatus;
  readonly processing_expires_at: Date | null;
  readonly retry_after_at: Date | null;
  readonly attempt_count: number;
  readonly response_status: number | null;
  readonly response_payload: unknown;
}

function toExistingRow(raw: RawExistingRow): ExistingActionRow {
  return {
    id: raw.id,
    requestHash: raw.request_hash,
    status: raw.status,
    processingExpiresAt: raw.processing_expires_at,
    retryAfterAt: raw.retry_after_at,
    attemptCount: raw.attempt_count,
    responseStatus: raw.response_status,
    responsePayload: raw.response_payload,
  };
}

async function readExisting(
  transaction: TransactionContext,
  townId: string,
  playerId: string,
  idempotencyKey: string,
): Promise<RawExistingRow | undefined> {
  const rows = await transaction.query<RawExistingRow>(
    `SELECT id, request_hash, status, processing_expires_at, retry_after_at,
            attempt_count, response_status, response_payload
       FROM public.player_actions
      WHERE town_id = $1 AND player_id = $2 AND idempotency_key = $3`,
    [townId, playerId, idempotencyKey],
  );
  return rows[0];
}

async function readExistingViaPool(
  pool: Pool,
  townId: string,
  playerId: string,
  idempotencyKey: string,
): Promise<RawExistingRow | undefined> {
  const result = await pool.query<RawExistingRow>(
    `SELECT id, request_hash, status, processing_expires_at, retry_after_at,
            attempt_count, response_status, response_payload
       FROM public.player_actions
      WHERE town_id = $1 AND player_id = $2 AND idempotency_key = $3`,
    [townId, playerId, idempotencyKey],
  );
  return result.rows[0];
}

interface RawBlockerRow {
  readonly id: string;
  readonly processing_expires_at: Date;
}

async function readBlocker(
  transaction: TransactionContext,
  townId: string,
  playerId: string,
): Promise<RawBlockerRow | undefined> {
  const rows = await transaction.query<RawBlockerRow>(
    `SELECT id, processing_expires_at FROM public.player_actions
      WHERE town_id = $1 AND player_id = $2 AND status = 'processing'`,
    [townId, playerId],
  );
  return rows[0];
}

function toBlockerRow(raw: RawBlockerRow): BlockingActionRow {
  return { id: raw.id, processingExpiresAt: raw.processing_expires_at };
}

/** Ledger decisions that will start fresh work and therefore consume model capacity. */
function decisionChargesRateLimit(decision: LedgerDecision): boolean {
  return (
    decision.kind === "create" ||
    decision.kind === "reclaim" ||
    decision.kind === "takeover" ||
    decision.kind === "supersedeThenCreate"
  );
}

export type ClaimDecision =
  | {
      readonly outcome: "claimed";
      readonly actionId: string;
      readonly processingToken: string;
    }
  | {
      readonly outcome: "processing";
      readonly actionId: string;
      readonly pollAfterMs: number;
    }
  | {
      readonly outcome: "replay";
      readonly actionId: string;
      readonly status: "retryable" | "completed" | "failed";
      readonly responseStatus: number;
      readonly responsePayload: unknown;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly outcome: "key_reused" }
  | { readonly outcome: "blocked"; readonly blockingActionId: string }
  | { readonly outcome: "rate_limited"; readonly retryAfterSeconds: number };

export function retryAfterSecondsFrom(
  retryAfterAt: Date | null,
  now: Date,
): number | null {
  if (retryAfterAt === null) return null;
  return Math.max(1, Math.ceil((retryAfterAt.getTime() - now.getTime()) / 1000));
}

function replayFromExisting(row: ExistingActionRow, now: Date): ClaimDecision {
  if (row.status === "processing") {
    throw new DatabaseError("unknown");
  }
  return {
    outcome: "replay",
    actionId: row.id,
    status: row.status,
    responseStatus: row.responseStatus!,
    responsePayload: row.responsePayload,
    retryAfterSeconds:
      row.status === "retryable" ? retryAfterSecondsFrom(row.retryAfterAt, now) : null,
  };
}

export interface ClaimActionParams {
  readonly townId: string;
  readonly playerId: string;
  readonly idempotencyKey: string;
  readonly requestHash: Buffer;
  readonly actionKind: ActionKind;
  readonly requestPayload: Readonly<Record<string, unknown>>;
  readonly targetActorId: string | null;
  readonly targetEntityId: string | null;
  readonly now: () => Date;
  readonly deadlineAt: number;
  readonly requestId: string;
  /**
   * Present only for the six model-backed kinds. Both buckets are admitted
   * atomically in the claim transaction after replay/block resolution but
   * before any action row is created or reclaimed (`D4-S`).
   */
  readonly modelRateLimit?: {
    readonly playerScopeKey: Buffer;
    readonly townScopeKey: Buffer;
  };
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

type SingleAttemptOutcome = ClaimDecision | { readonly outcome: "live_processing" };

async function insertAction(
  transaction: TransactionContext,
  actionId: string,
  processingToken: string,
  params: Omit<ClaimActionParams, "now" | "deadlineAt" | "sleep">,
  now: Date,
): Promise<void> {
  const inserted = await transaction.query<{ id: string }>(
    `INSERT INTO public.player_actions
       (town_id, id, player_id, idempotency_key, action_kind, request_hash,
        request_payload, target_actor_id, target_entity_id, status,
        processing_token, processing_expires_at, attempt_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'processing', $10, $11, 1, $12, $12)
     RETURNING id`,
    [
      params.townId,
      actionId,
      params.playerId,
      params.idempotencyKey,
      params.actionKind,
      params.requestHash,
      JSON.stringify(params.requestPayload),
      params.targetActorId,
      params.targetEntityId,
      processingToken,
      new Date(now.getTime() + CLAIM_MS),
      now,
    ],
  );
  if (inserted.length === 0) {
    // Unreachable under serializable isolation: our own read above, in this
    // same transaction, already established that no row exists for this key.
    throw new DatabaseError("unknown");
  }
}

async function takeoverProcessing(
  transaction: TransactionContext,
  townId: string,
  actionId: string,
  processingToken: string,
  now: Date,
): Promise<void> {
  const updated = await transaction.query<{ id: string }>(
    `UPDATE public.player_actions
        SET processing_token = $3, processing_expires_at = $4,
            attempt_count = attempt_count + 1, updated_at = $5
      WHERE town_id = $1 AND id = $2 AND status = 'processing'
      RETURNING id`,
    [townId, actionId, processingToken, new Date(now.getTime() + CLAIM_MS), now],
  );
  if (updated.length === 0) throw new DatabaseError("unknown");
}

async function reclaimRetryable(
  transaction: TransactionContext,
  townId: string,
  actionId: string,
  processingToken: string,
  now: Date,
): Promise<void> {
  const updated = await transaction.query<{ id: string }>(
    `UPDATE public.player_actions
        SET status = 'processing', processing_token = $3, processing_expires_at = $4,
            attempt_count = attempt_count + 1, response_status = NULL,
            response_payload = NULL, error_code = NULL, retry_after_at = NULL,
            updated_at = $5
      WHERE town_id = $1 AND id = $2 AND status = 'retryable'
      RETURNING id`,
    [townId, actionId, processingToken, new Date(now.getTime() + CLAIM_MS), now],
  );
  if (updated.length === 0) throw new DatabaseError("unknown");
}

async function supersedeBlocker(
  transaction: TransactionContext,
  townId: string,
  blockerId: string,
  now: Date,
): Promise<void> {
  const updated = await transaction.query<{ id: string }>(
    `UPDATE public.player_actions
        SET status = 'failed', response_status = 409, error_code = $3,
            response_payload = $4, processing_token = NULL,
            processing_expires_at = NULL, completed_at = $5, updated_at = $5
      WHERE town_id = $1 AND id = $2 AND status = 'processing'
      RETURNING id`,
    [townId, blockerId, SUPERSEDED_BODY.code, JSON.stringify(SUPERSEDED_BODY), now],
  );
  if (updated.length === 0) throw new DatabaseError("unknown");
}

async function exhaustProcessing(
  transaction: TransactionContext,
  townId: string,
  actionId: string,
  now: Date,
): Promise<ExistingActionRow> {
  const updated = await transaction.query<RawExistingRow>(
    `UPDATE public.player_actions
        SET status = 'failed', response_status = 503, error_code = $3,
            response_payload = $4, processing_token = NULL,
            processing_expires_at = NULL, completed_at = $5, updated_at = $5
      WHERE town_id = $1 AND id = $2 AND status = 'processing'
      RETURNING id, request_hash, status, processing_expires_at, retry_after_at,
                attempt_count, response_status, response_payload`,
    [townId, actionId, EXHAUSTED_BODY.code, JSON.stringify(EXHAUSTED_BODY), now],
  );
  const row = updated[0];
  if (row === undefined) throw new DatabaseError("unknown");
  return toExistingRow(row);
}

/**
 * Set inside `runSerializable`'s callback, read only after a commit actually
 * lands — the callback re-runs whole on a CockroachDB-level retry, so a log
 * call inside it would double-report a rolled-back attempt. This is a plain
 * JS variable, not a database write, so re-assigning it on a retried attempt
 * has no atomicity concern: only the successful attempt's value survives.
 */
type ClaimLogDetail = {
  readonly status: "takeover" | "processing_exhausted";
  readonly actionId: string;
  readonly terminalErrorCode?: ActionLifecycleErrorCode;
};

async function attemptOnce(
  pool: Pool,
  deadlineAt: number,
  params: Omit<ClaimActionParams, "deadlineAt" | "sleep">,
): Promise<SingleAttemptOutcome> {
  let claimLogDetail: ClaimLogDetail | undefined;

  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();

    const existingRaw = await readExisting(
      transaction,
      params.townId,
      params.playerId,
      params.idempotencyKey,
    );
    const existing = existingRaw && toExistingRow(existingRaw);

    let blocker: BlockingActionRow | undefined;
    if (existing === undefined) {
      const blockerRaw = await readBlocker(transaction, params.townId, params.playerId);
      blocker = blockerRaw && toBlockerRow(blockerRaw);
    }

    const decision = decideAction({
      existing,
      blocker,
      requestHash: params.requestHash,
      now,
    });

    if (params.modelRateLimit && decisionChargesRateLimit(decision)) {
      const admission = await admitRateLimitsAtomically(
        transaction,
        [
          {
            bucket: RATE_LIMIT_BUCKETS.modelActionPlayer,
            scopeKey: params.modelRateLimit.playerScopeKey,
          },
          {
            bucket: RATE_LIMIT_BUCKETS.modelActionTown,
            scopeKey: params.modelRateLimit.townScopeKey,
          },
        ],
        now,
      );
      if (!admission.admitted) {
        return {
          outcome: "rate_limited",
          retryAfterSeconds: admission.retryAfterSeconds,
        } as const satisfies SingleAttemptOutcome;
      }
    }

    switch (decision.kind) {
      case "create": {
        const actionId = randomUUID();
        const processingToken = randomUUID();
        await insertAction(transaction, actionId, processingToken, params, now);
        return {
          outcome: "claimed",
          actionId,
          processingToken,
        } as const satisfies SingleAttemptOutcome;
      }
      case "respondProcessing":
        return {
          outcome: "processing",
          actionId: decision.row.id,
          pollAfterMs: POLL_AFTER_MS,
        } as const satisfies SingleAttemptOutcome;
      case "replayConflict":
        return replayFromExisting(decision.row, now);
      case "replaySaved":
        return replayFromExisting(decision.row, now);
      case "rejectKeyReuse":
        return { outcome: "key_reused" } as const satisfies SingleAttemptOutcome;
      case "blockInProgress":
        return {
          outcome: "blocked",
          blockingActionId: decision.blocker.id,
        } as const satisfies SingleAttemptOutcome;
      case "reclaim": {
        const processingToken = randomUUID();
        await reclaimRetryable(
          transaction,
          params.townId,
          existing!.id,
          processingToken,
          now,
        );
        return {
          outcome: "claimed",
          actionId: existing!.id,
          processingToken,
        } as const satisfies SingleAttemptOutcome;
      }
      case "takeover": {
        const processingToken = randomUUID();
        await takeoverProcessing(
          transaction,
          params.townId,
          existing!.id,
          processingToken,
          now,
        );
        claimLogDetail = { status: "takeover", actionId: existing!.id };
        return {
          outcome: "claimed",
          actionId: existing!.id,
          processingToken,
        } as const satisfies SingleAttemptOutcome;
      }
      case "exhaust": {
        const exhausted = await exhaustProcessing(
          transaction,
          params.townId,
          existing!.id,
          now,
        );
        claimLogDetail = {
          status: "processing_exhausted",
          actionId: existing!.id,
          terminalErrorCode: "ACTION_PROCESSING_EXHAUSTED",
        };
        return replayFromExisting(exhausted, now);
      }
      case "supersedeThenCreate": {
        await supersedeBlocker(transaction, params.townId, decision.blocker.id, now);
        const actionId = randomUUID();
        const processingToken = randomUUID();
        await insertAction(transaction, actionId, processingToken, params, now);
        return {
          outcome: "claimed",
          actionId,
          processingToken,
        } as const satisfies SingleAttemptOutcome;
      }
    }
  });

  if (result.outcome === "committed") {
    if (claimLogDetail) {
      logEvent({
        event: "action_lifecycle",
        requestId: params.requestId,
        actionKind: params.actionKind,
        actionId: asUuid(claimLogDetail.actionId),
        status: claimLogDetail.status,
        ...(claimLogDetail.terminalErrorCode
          ? { terminalErrorCode: claimLogDetail.terminalErrorCode }
          : {}),
      });
      if (claimLogDetail.status === "processing_exhausted") {
        recordActionProcessingExhausted(params.actionKind);
      }
    }
    return result.value;
  }

  // The commit's fate is unknown; read the durable ledger rather than guess
  // (`D3-O`). Only a terminal row is a safe direct answer here — anything
  // else (still processing, still retryable, or simply not found because our
  // own write did not land) is retried from scratch by the caller's loop, so
  // the fresh read re-derives the correct decision rather than duplicating
  // this function's branching against a possibly-stale snapshot.
  const resolved = await resolveAmbiguousCommit(async () =>
    readExistingViaPool(pool, params.townId, params.playerId, params.idempotencyKey),
  );
  logEvent({
    event: "action_lifecycle",
    requestId: params.requestId,
    actionKind: params.actionKind,
    // The row this claim would have written is scoped by
    // `(town_id, player_id, idempotency_key)`, not yet a known action id when
    // the commit's own fate is ambiguous — `idempotencyKey` stands in as the
    // best available `Uuid`-shaped identity for this one log line.
    actionId: asUuid(params.idempotencyKey),
    status: "ambiguous_resolved",
    ambiguousCommitResolution:
      resolved.outcome === "applied" ? "applied" : "not_applied",
  });
  if (resolved.outcome === "not_applied") return { outcome: "live_processing" };
  const row = toExistingRow(resolved.value);
  if (!row.requestHash.equals(params.requestHash)) return { outcome: "key_reused" };
  if (row.status === "completed" || row.status === "failed") {
    return replayFromExisting(row, params.now());
  }
  return { outcome: "live_processing" };
}

const DEFAULT_SLEEP = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Claims a fresh or reclaimable row, or resolves the incoming request to a
 * direct terminal answer (processing, replay, conflict, blocked, or key
 * reuse). The only case this loops on is a genuinely ambiguous commit whose
 * fate is still unresolved on read — every other outcome is returned
 * immediately, since (unlike town creation and join) this route's wire
 * contract has a real `202 processing` shape and does not need one.
 */
export async function claimAction(
  pool: Pool,
  params: ClaimActionParams,
): Promise<ClaimDecision> {
  const sleep = params.sleep ?? DEFAULT_SLEEP;

  for (;;) {
    const outcome = await attemptOnce(pool, params.deadlineAt, params);
    if (outcome.outcome !== "live_processing") return outcome;

    if (params.now().getTime() >= params.deadlineAt) {
      throw new DatabaseError("deadline_exceeded");
    }
    await sleep(50);
  }
}

export interface CompleteActionParams {
  readonly townId: string;
  readonly actionId: string;
  readonly processingToken: string;
  readonly outcome: "applied" | "no_change" | "denied";
  readonly responseStatus: number;
  readonly responsePayload: Readonly<Record<string, unknown>>;
  readonly visitId: string | null;
  readonly now: () => Date;
}

/**
 * The conditional completion `UPDATE`, runnable inside a caller-supplied
 * transaction rather than its own. `application/actions/executor.ts` needs
 * this: an applied plan's effects, numbered events, and completion all
 * commit in the *same* transaction as the `towns.revision` bump
 * (`P3-09` acceptance 1), so this cannot open its own `runSerializable` the
 * way {@link completeAction} does for the denial/no-change path, which has
 * nothing else to commit alongside it.
 */
export async function runCompleteActionUpdate(
  transaction: TransactionContext,
  now: Date,
  params: CompleteActionParams,
): Promise<{ readonly matched: boolean }> {
  const updated = await transaction.query<{ id: string }>(
    `UPDATE public.player_actions
        SET status = 'completed', outcome = $3, response_status = $4,
            response_payload = $5, visit_id = $6, processing_token = NULL,
            processing_expires_at = NULL, completed_at = $7, updated_at = $7
      WHERE town_id = $1 AND id = $2 AND status = 'processing'
        AND processing_token = $8
      RETURNING id`,
    [
      params.townId,
      params.actionId,
      params.outcome,
      params.responseStatus,
      JSON.stringify(params.responsePayload),
      params.visitId,
      now,
      params.processingToken,
    ],
  );
  return { matched: updated.length > 0 };
}

/** Scoped to `(town_id, id)` only — used solely to resolve an ambiguous commit. */
async function readStatusByIdViaPool(
  pool: Pool,
  townId: string,
  actionId: string,
): Promise<ActionRecordStatus | undefined> {
  const result = await pool.query<{ readonly status: ActionRecordStatus }>(
    `SELECT status FROM public.player_actions WHERE town_id = $1 AND id = $2`,
    [townId, actionId],
  );
  return result.rows[0]?.status;
}

/**
 * Marks a claimed row completed, conditional on presenting the current
 * processing token. A stale worker whose claim was replaced by a takeover
 * matches zero rows and throws `StaleProcessingClaimError` rather than
 * overwriting the new owner's work.
 *
 * On an ambiguous commit (`D3-O`), the durable ledger is consulted rather
 * than guessed at: if the row now reads `completed`, this call's write did
 * land and it returns normally — the caller must not re-run to "make sure",
 * since that would apply the effect a second time. Anything else means the
 * write did not land, and the stale-claim error is raised the same as a
 * definite rejection.
 */
export async function completeAction(
  pool: Pool,
  deadlineAt: number,
  params: CompleteActionParams,
): Promise<void> {
  // `runSerializable` maps every non-`DatabaseError` thrown from the body
  // through `toDatabaseError`, which discards a custom error's identity — so
  // "did the conditional match?" is returned as data, and
  // `StaleProcessingClaimError` is only ever thrown out here, after the
  // transaction has actually committed or ambiguity has been resolved.
  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();
    return runCompleteActionUpdate(transaction, now, params);
  });

  if (result.outcome === "committed") {
    if (result.value.matched) return;
    throw new StaleProcessingClaimError();
  }

  const status = await readStatusByIdViaPool(pool, params.townId, params.actionId);
  if (status === "completed") return;
  throw new StaleProcessingClaimError();
}

export interface StoreTerminalFailureParams {
  readonly townId: string;
  readonly actionId: string;
  readonly processingToken: string;
  readonly responseStatus: number;
  readonly problemBody: StoredProblemBody;
  readonly now: () => Date;
}

/**
 * `D4-O`: writes the terminal `failed` state a model-backed action reaches
 * when its output is invalid and repair also fails — Decision 006's `503
 * MODEL_UNAVAILABLE_RETRY_ACTION`, which has no safe authored fallback
 * (unlike NPC dialogue, `normalize_claim` cannot substitute presentation
 * text for a proposition it never validated). This is the only writer of a
 * terminal model failure. `decideAction`'s `failed` branch always replays
 * the saved body unconditionally, so the same idempotency key never retries
 * — Decision 006's "an intentional retry uses a new key" is enforced by the
 * ledger table already having that row, not by anything here.
 */
export async function storeTerminalFailure(
  pool: Pool,
  deadlineAt: number,
  params: StoreTerminalFailureParams,
): Promise<void> {
  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();
    const updated = await transaction.query<{ id: string }>(
      `UPDATE public.player_actions
          SET status = 'failed', response_status = $3, error_code = $4,
              response_payload = $5, processing_token = NULL,
              processing_expires_at = NULL, completed_at = $6, updated_at = $6
        WHERE town_id = $1 AND id = $2 AND status = 'processing'
          AND processing_token = $7
        RETURNING id`,
      [
        params.townId,
        params.actionId,
        params.responseStatus,
        params.problemBody.code,
        JSON.stringify(params.problemBody),
        now,
        params.processingToken,
      ],
    );
    return { matched: updated.length > 0 };
  });

  if (result.outcome === "committed") {
    if (result.value.matched) return;
    throw new StaleProcessingClaimError();
  }

  const status = await readStatusByIdViaPool(pool, params.townId, params.actionId);
  if (status === "failed") return;
  throw new StaleProcessingClaimError();
}

export interface ActionStatusRow {
  readonly id: string;
  readonly status: ActionRecordStatus;
  readonly responseStatus: number | null;
  readonly responsePayload: unknown;
  readonly retryAfterAt: Date | null;
}

/**
 * Scoped to `(town_id, player_id, id)`: a wrong owner and a nonexistent
 * action ID are indistinguishable, both simply `undefined` here. Reading
 * never claims, retries, or mutates anything — polling this route can never
 * itself start work.
 */
export async function readActionForPlayer(
  pool: Pool,
  townId: string,
  playerId: string,
  actionId: string,
): Promise<ActionStatusRow | undefined> {
  if (!isDatabaseUuid(actionId)) return undefined;
  const result = await pool.query<{
    readonly id: string;
    readonly status: ActionRecordStatus;
    readonly response_status: number | null;
    readonly response_payload: unknown;
    readonly retry_after_at: Date | null;
  }>(
    `SELECT id, status, response_status, response_payload, retry_after_at
       FROM public.player_actions
      WHERE town_id = $1 AND player_id = $2 AND id = $3`,
    [townId, playerId, actionId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    status: row.status,
    responseStatus: row.response_status,
    responsePayload: row.response_payload,
    retryAfterAt: row.retry_after_at,
  };
}

export interface StoreRetryableParams {
  readonly townId: string;
  readonly actionId: string;
  readonly processingToken: string;
  readonly retryAfterAt: Date;
  readonly now: () => Date;
}

/**
 * Stores the second-conflict `409 ACTION_CONFLICT` state (`D3-O`'s
 * town-revision retry path). Not reached by this phase's own executor yet —
 * `P3-09` calls this after a second relevant conflict — but the transition
 * belongs to this state machine and `decideAction`'s `reclaim`/`replayConflict`
 * branches are meaningless without a writer to reach them from.
 */
export async function storeRetryableConflict(
  pool: Pool,
  deadlineAt: number,
  params: StoreRetryableParams,
): Promise<void> {
  const result = await runSerializable(pool, { deadlineAt }, async (transaction) => {
    const now = params.now();
    const body: StoredProblemBody = {
      code: "ACTION_CONFLICT",
      title: "Action conflict",
      detail: "The town changed while this action was processing. Retrying is safe.",
      fieldErrors: [],
    };
    const updated = await transaction.query<{ id: string }>(
      `UPDATE public.player_actions
          SET status = 'retryable', response_status = 409, error_code = $3,
              response_payload = $4, retry_after_at = $5, processing_token = NULL,
              processing_expires_at = NULL, updated_at = $6
        WHERE town_id = $1 AND id = $2 AND status = 'processing'
          AND processing_token = $7
        RETURNING id`,
      [
        params.townId,
        params.actionId,
        body.code,
        JSON.stringify(body),
        params.retryAfterAt,
        now,
        params.processingToken,
      ],
    );
    return { matched: updated.length > 0 };
  });

  if (result.outcome === "committed") {
    if (result.value.matched) return;
    throw new StaleProcessingClaimError();
  }

  const status = await readStatusByIdViaPool(pool, params.townId, params.actionId);
  if (status === "retryable") return;
  throw new StaleProcessingClaimError();
}
