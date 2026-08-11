/**
 * The recovery-aware action submission hook (Decision 011 §"Pending actions
 * and retry recovery"; `P3-15`). Wraps `journal/machine.ts`'s pure reducer
 * with the actual journal (IndexedDB), `BroadcastChannel` coordination, and
 * timing: a 1-second tick drives the 35s/70s/`ACTION_CONFLICT` transitions,
 * `online`/`offline` window events drive the offline row, and every
 * automatic resend reuses the exact same idempotency key the journal
 * already holds.
 *
 * The returned shape's first four fields (`pending`, `lastResult`, `error`,
 * `submit`) match `P3-14`'s original minimal hook exactly, so `Map`/
 * `Location` need no changes — this really is a wrap, not a replacement.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ActionRequest,
  CompletedActionResponse,
} from "@the-town-remembers/http-contracts";

import {
  pollAction,
  postAction,
  type ActionAttemptOutcome,
} from "./actionTransport.js";
import {
  deleteJournalEntry,
  readJournalEntry,
  writeJournalEntry,
} from "../journal/db.js";
import { openJournalChannel } from "../journal/channel.js";
import {
  INITIAL_RECOVERY_STATE,
  reduceRecovery,
  type RecoveryPhase,
  type RecoveryState,
} from "../journal/machine.js";

const TICK_MS = 1_000;

export interface UseActionSubmissionResult {
  readonly pending: boolean;
  readonly lastResult: CompletedActionResponse | undefined;
  readonly error: string | undefined;
  readonly submit: (request: ActionRequest) => Promise<void>;
  readonly recoveryPhase: RecoveryPhase | undefined;
  readonly rateLimitedRetryAfterSeconds: number | undefined;
  /** True while another same-origin tab has a pending action for this player. */
  readonly readOnlyPending: boolean;
  readonly tryAsNewAction: () => void;
}

const REASON_MESSAGES: Partial<Record<string, string>> = {
  IDEMPOTENCY_KEY_REUSED:
    "This browser lost track of the action. Refresh the town before trying again.",
  MODEL_UNAVAILABLE_RETRY_ACTION:
    "The town could not interpret that claim. Try again when ready.",
  ACTION_PROCESSING_EXHAUSTED:
    "The town could not finish that action. Nothing changed.",
  ACTION_IN_PROGRESS: "Another action from this browser is still being saved.",
  UNAUTHORIZED:
    "This browser no longer has its town pass. Reopen the invite link to join again.",
};

export function useActionSubmission(
  townId: string,
  playerId: string,
  onSettled: () => void,
): UseActionSubmissionResult {
  const [recovery, setRecovery] = useState<RecoveryState | undefined>(undefined);
  const [readOnlyPending, setReadOnlyPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const startedAtRef = useRef(0);
  const requestRef = useRef<
    { idempotencyKey: string; request: ActionRequest } | undefined
  >(undefined);
  const channelRef = useRef(openJournalChannel());

  const elapsed = useCallback(() => Date.now() - startedAtRef.current, []);

  const finalize = useCallback(async () => {
    onSettled();
    await deleteJournalEntry(townId, playerId);
    channelRef.current?.post({ type: "cleared", townId, playerId });
  }, [onSettled, townId, playerId]);

  const handleOutcome = useCallback(
    (outcome: ActionAttemptOutcome) => {
      const current = requestRef.current;
      if (!current) return;

      switch (outcome.kind) {
        case "completed": {
          const { state } = reduceRecovery(
            recovery ?? INITIAL_RECOVERY_STATE,
            { type: "completed", result: outcome.result },
            elapsed(),
          );
          setRecovery(state);
          void finalize();
          return;
        }
        case "processing": {
          const { state } = reduceRecovery(
            recovery ?? INITIAL_RECOVERY_STATE,
            {
              type: "processing",
              actionId: outcome.actionId,
              pollAfterMs: outcome.pollAfterMs,
            },
            elapsed(),
          );
          setRecovery(state);
          void writeJournalEntry({
            townId,
            playerId,
            idempotencyKey: current.idempotencyKey,
            requestBody: current.request,
            createdAt: new Date(startedAtRef.current).toISOString(),
            actionId: outcome.actionId,
            pollAfterMs: outcome.pollAfterMs,
            takeoverPostSent: false,
          });
          setTimeout(() => {
            void pollAction(townId, outcome.actionId).then(handleOutcomeRef.current);
          }, outcome.pollAfterMs);
          return;
        }
        case "conflict": {
          const { state, shouldResend } = reduceRecovery(
            recovery ?? INITIAL_RECOVERY_STATE,
            { type: "actionConflict" },
            elapsed(),
          );
          setRecovery(state);
          if (shouldResend) {
            setTimeout(() => {
              void postAction(townId, current.idempotencyKey, current.request).then(
                handleOutcomeRef.current,
              );
            }, 1_000);
          }
          return;
        }
        case "rateLimited": {
          const { state } = reduceRecovery(
            recovery ?? INITIAL_RECOVERY_STATE,
            { type: "rateLimited", retryAfterSeconds: outcome.retryAfterSeconds },
            elapsed(),
          );
          setRecovery(state);
          return;
        }
        case "actionInProgress":
        case "requiresNewAction": {
          const reason =
            outcome.kind === "actionInProgress" ? "ACTION_IN_PROGRESS" : outcome.reason;
          const { state } = reduceRecovery(
            recovery ?? INITIAL_RECOVERY_STATE,
            { type: "requiresNewAction", reason },
            elapsed(),
          );
          setRecovery(state);
          setErrorMessage(
            REASON_MESSAGES[reason] ?? "Something went wrong. Try again.",
          );
          void deleteJournalEntry(townId, playerId);
          channelRef.current?.post({ type: "cleared", townId, playerId });
          return;
        }
        case "offline": {
          const { state } = reduceRecovery(
            recovery ?? INITIAL_RECOVERY_STATE,
            { type: "offline" },
            elapsed(),
          );
          setRecovery(state);
          return;
        }
      }
    },
    [recovery, elapsed, finalize, townId, playerId],
  );

  // `handleOutcome` closes over `recovery`, which changes every dispatch —
  // callbacks scheduled by `setTimeout` need the *current* handler, not the
  // one captured when they were scheduled.
  const handleOutcomeRef = useRef(handleOutcome);
  useEffect(() => {
    handleOutcomeRef.current = handleOutcome;
  }, [handleOutcome]);

  // Resume a journaled action left behind by a reload.
  useEffect(() => {
    let active = true;
    void readJournalEntry(townId, playerId).then((entry) => {
      if (!active || !entry) return;
      startedAtRef.current = new Date(entry.createdAt).getTime();
      requestRef.current = {
        idempotencyKey: entry.idempotencyKey,
        request: entry.requestBody,
      };
      setRecovery(INITIAL_RECOVERY_STATE);
      if (entry.actionId) {
        void pollAction(townId, entry.actionId).then((outcome) =>
          handleOutcomeRef.current(outcome),
        );
      } else {
        void postAction(townId, entry.idempotencyKey, entry.requestBody).then(
          (outcome) => handleOutcomeRef.current(outcome),
        );
      }
    });
    return () => {
      active = false;
    };
    // Runs once per (townId, playerId) pair; `handleOutcomeRef` is a stable ref.
  }, [townId, playerId]);

  // The 1-second tick driving 35s/70s recovery transitions.
  useEffect(() => {
    if (!recovery) return;
    const terminal: readonly RecoveryPhase[] = [
      "completed",
      "requires_new_action",
      "manual_recovery",
      "conflict_manual",
      "rate_limited",
    ];
    if (terminal.includes(recovery.phase)) return;

    const interval = setInterval(() => {
      const { state, shouldResend } = reduceRecovery(
        recovery,
        { type: "tick" },
        elapsed(),
      );
      setRecovery(state);
      const current = requestRef.current;
      if (shouldResend && current) {
        void postAction(townId, current.idempotencyKey, current.request).then(
          handleOutcomeRef.current,
        );
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [recovery, elapsed, townId]);

  // Offline/online.
  useEffect(() => {
    function onOffline() {
      setRecovery((prev) =>
        prev ? reduceRecovery(prev, { type: "offline" }, elapsed()).state : prev,
      );
    }
    function onOnline() {
      setRecovery((prev) => {
        if (!prev) return prev;
        const next = reduceRecovery(prev, { type: "online" }, elapsed()).state;
        const current = requestRef.current;
        if (current) {
          if (next.actionId) {
            void pollAction(townId, next.actionId).then(handleOutcomeRef.current);
          } else {
            void postAction(townId, current.idempotencyKey, current.request).then(
              handleOutcomeRef.current,
            );
          }
        }
        return next;
      });
    }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [elapsed, townId]);

  // A second tab's pending action puts this tab into read-only pending mode.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    return channel.subscribe((message) => {
      if (message.townId !== townId || message.playerId !== playerId) return;
      setReadOnlyPending(message.type === "pending");
    });
  }, [townId, playerId]);

  const submit = useCallback(
    async (request: ActionRequest) => {
      const idempotencyKey = crypto.randomUUID();
      startedAtRef.current = Date.now();
      requestRef.current = { idempotencyKey, request };
      setErrorMessage(undefined);
      setRecovery(INITIAL_RECOVERY_STATE);

      await writeJournalEntry({
        townId,
        playerId,
        idempotencyKey,
        requestBody: request,
        createdAt: new Date(startedAtRef.current).toISOString(),
        pollAfterMs: 2_000,
        takeoverPostSent: false,
      });
      channelRef.current?.post({ type: "pending", townId, playerId });

      const outcome = await postAction(townId, idempotencyKey, request);
      handleOutcomeRef.current(outcome);
    },
    [townId, playerId],
  );

  const tryAsNewAction = useCallback(() => {
    requestRef.current = undefined;
    setRecovery(undefined);
    setErrorMessage(undefined);
  }, []);

  return {
    pending: recovery !== undefined && recovery.phase !== "completed",
    lastResult: recovery?.result,
    error: errorMessage,
    submit,
    recoveryPhase: recovery?.phase,
    rateLimitedRetryAfterSeconds: recovery?.rateLimitedRetryAfterSeconds,
    readOnlyPending,
    tryAsNewAction,
  };
}
