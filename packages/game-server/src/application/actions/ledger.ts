/**
 * The pure claim/conflict decision table (`P3-08`, `D3-O`; docs/006
 * §"Idempotency and conflicts").
 *
 * `decideAction` takes only durable state and a clock reading — no I/O — so
 * every row of the accepted table, plus the `ACTION_IN_PROGRESS` /
 * `ACTION_SUPERSEDED` / `ACTION_PROCESSING_EXHAUSTED` paths it implies, is one
 * directly-constructible, deterministic test case. `persistence/actions.ts`
 * is the only caller: it reads the two rows this function needs inside one
 * transaction, asks for a decision, then drives the matching conditional
 * statement.
 *
 * Same-key resolution is checked unconditionally before the blocker check —
 * "Same-key replay is resolved first" — because a live blocking action must
 * never shadow a replay of its own key.
 */

/** After this many claimed attempts with no committed result, the next claim exhausts. */
export const MAX_PROCESSING_ATTEMPTS = 3;

export type ActionRecordStatus = "processing" | "retryable" | "completed" | "failed";

export interface ExistingActionRow {
  readonly id: string;
  readonly requestHash: Buffer;
  readonly status: ActionRecordStatus;
  readonly processingExpiresAt: Date | null;
  readonly retryAfterAt: Date | null;
  readonly attemptCount: number;
  readonly responseStatus: number | null;
  readonly responsePayload: unknown;
}

export interface BlockingActionRow {
  readonly id: string;
  readonly processingExpiresAt: Date;
}

export type LedgerDecision =
  | { readonly kind: "create" }
  | { readonly kind: "respondProcessing"; readonly row: ExistingActionRow }
  | { readonly kind: "replayConflict"; readonly row: ExistingActionRow }
  | { readonly kind: "reclaim" }
  | { readonly kind: "takeover" }
  | { readonly kind: "replaySaved"; readonly row: ExistingActionRow }
  | { readonly kind: "rejectKeyReuse" }
  | { readonly kind: "blockInProgress"; readonly blocker: BlockingActionRow }
  | { readonly kind: "supersedeThenCreate"; readonly blocker: BlockingActionRow }
  | { readonly kind: "exhaust" };

export interface DecideActionInput {
  /** The row for this exact `(town_id, player_id, idempotency_key)`, if any. */
  readonly existing: ExistingActionRow | undefined;
  /**
   * The player's other live `processing` row, if any. Only meaningful — and
   * only ever supplied — when `existing` is `undefined`: the schema's
   * `uq_player_actions__one_processing` index guarantees at most one
   * `processing` row per player, so a defined `existing` row already answers
   * every question a blocker could.
   */
  readonly blocker: BlockingActionRow | undefined;
  readonly requestHash: Buffer;
  readonly now: Date;
}

export function decideAction(input: DecideActionInput): LedgerDecision {
  const { existing, blocker, requestHash, now } = input;

  if (existing !== undefined) {
    if (!existing.requestHash.equals(requestHash)) {
      return { kind: "rejectKeyReuse" };
    }

    switch (existing.status) {
      case "processing": {
        if (
          existing.processingExpiresAt !== null &&
          existing.processingExpiresAt.getTime() > now.getTime()
        ) {
          return { kind: "respondProcessing", row: existing };
        }
        if (existing.attemptCount >= MAX_PROCESSING_ATTEMPTS) {
          return { kind: "exhaust" };
        }
        return { kind: "takeover" };
      }
      case "retryable": {
        if (
          existing.retryAfterAt !== null &&
          existing.retryAfterAt.getTime() > now.getTime()
        ) {
          return { kind: "replayConflict", row: existing };
        }
        return { kind: "reclaim" };
      }
      case "completed":
      case "failed":
        return { kind: "replaySaved", row: existing };
    }
  }

  if (blocker !== undefined) {
    if (blocker.processingExpiresAt.getTime() > now.getTime()) {
      return { kind: "blockInProgress", blocker };
    }
    return { kind: "supersedeThenCreate", blocker };
  }

  return { kind: "create" };
}
