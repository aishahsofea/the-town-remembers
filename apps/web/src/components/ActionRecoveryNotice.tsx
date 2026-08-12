import { useEffect, useState } from "react";

import type { UseActionSubmissionResult } from "../api/actionSubmission.js";

export interface ActionRecoveryNoticeProps {
  readonly action: UseActionSubmissionResult;
}

export function ActionRecoveryNotice({ action }: ActionRecoveryNoticeProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [action.recoveryPhase, action.readOnlyPending]);

  if (action.readOnlyPending) {
    return (
      <aside className="action-recovery" role="status" aria-live="polite">
        Another tab is saving an action. You can keep reading here.
      </aside>
    );
  }

  if (collapsed || action.recoveryPhase === undefined) return null;

  if (action.refreshPending && action.recoveryPhase === "completed") {
    return (
      <aside className="action-recovery" role="status" aria-live="polite">
        <p>{action.error ?? "Saved. Refreshing the town…"}</p>
        {action.error ? (
          <button type="button" onClick={action.retrySafely}>
            Retry refresh
          </button>
        ) : null}
      </aside>
    );
  }

  switch (action.recoveryPhase) {
    case "offline":
      return (
        <aside className="action-recovery" role="status" aria-live="polite">
          Connection lost. Your action is still safe.
        </aside>
      );
    case "retrying_once":
      return (
        <aside className="action-recovery" role="status" aria-live="polite">
          Trying once more…
        </aside>
      );
    case "manual_recovery":
      return (
        <aside className="action-recovery" role="status" aria-live="polite">
          <p>
            This is taking longer than usual. Retrying is safe and will not apply the
            action twice.
          </p>
          <button type="button" onClick={action.retrySafely}>
            Retry safely
          </button>
          <button type="button" onClick={() => setCollapsed(true)}>
            Keep reading
          </button>
        </aside>
      );
    case "conflict_manual":
      return (
        <aside className="action-recovery" role="status" aria-live="polite">
          <p>The town changed again while this action was being saved.</p>
          <button type="button" onClick={action.retrySafely}>
            Retry safely
          </button>
        </aside>
      );
    case "rate_limited": {
      const seconds = action.rateLimitedRetryAfterSeconds ?? 0;
      return (
        <aside className="action-recovery" role="status" aria-live="polite">
          <p>
            {seconds > 0
              ? `Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`
              : "You can try this action now."}
          </p>
          <button type="button" disabled={seconds > 0} onClick={action.retrySafely}>
            Try now
          </button>
        </aside>
      );
    }
    case "requires_new_action":
      return (
        <aside className="action-recovery" role="alert">
          <p>{action.error ?? "This action needs a fresh request."}</p>
          <button type="button" onClick={action.tryAsNewAction}>
            Try as a new action
          </button>
        </aside>
      );
    case "completed":
    case "submitting":
    case "processing":
    case "conflict_auto_retry":
      return null;
    default:
      return null;
  }
}
