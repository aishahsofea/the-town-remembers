/**
 * Claim normalization and Tell confirmation (Decision 011 §"Claim
 * normalization and confirmation"; `P4-19`). `Interpret claim` and
 * `Tell {npc}` are two separate actions with two separate idempotency keys —
 * this panel never reuses one action's key for the other, and the review
 * sheet closes only after the saved `tell` response actually arrives.
 *
 * `action` is the single shared submission hook for the whole encounter
 * screen (only one action can ever be in flight at once), so this panel
 * tracks which of its own two action kinds it is waiting on and only reacts
 * to `action.lastResult` once that kind's result actually lands.
 */

import { useEffect, useRef, useState } from "react";

import { countGraphemeClusters } from "@the-town-remembers/http-contracts";
import type {
  ActionResultByKind,
  CompletedActionResponse,
} from "@the-town-remembers/http-contracts";

import type { UseActionSubmissionResult } from "../api/actionSubmission.js";

const MAX_GRAPHEMES = 500;

type Phase = "composing" | "interpreting" | "review" | "telling";

interface Draft {
  readonly claimDraftId: string;
  readonly rawText: string;
  readonly canonicalText: string;
  readonly allegedSourceName: string | undefined;
  readonly expiresAt: string;
}

export interface TellPanelProps {
  readonly npc: { readonly id: string; readonly displayName: string };
  readonly action: UseActionSubmissionResult;
  readonly onExchangeComplete: (response: CompletedActionResponse) => void;
  /** Lets the parent gate its own navigation controls while a draft is under review. */
  readonly onReviewActiveChange: (active: boolean) => void;
  readonly onCancel: () => void;
}

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function TellPanel({
  npc,
  action,
  onExchangeComplete,
  onReviewActiveChange,
  onCancel,
}: TellPanelProps) {
  const [phase, setPhase] = useState<Phase>("composing");
  const [rawText, setRawText] = useState("");
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [revisionNotice, setRevisionNotice] = useState<string | undefined>(undefined);
  const [deniedNotice, setDeniedNotice] = useState<string | undefined>(undefined);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const awaitingKindRef = useRef<"normalize_claim" | "tell" | undefined>(undefined);

  useEffect(() => {
    onReviewActiveChange(phase === "review");
  }, [phase, onReviewActiveChange]);

  // A real tab close/reload while a draft is under review — the server draft
  // survives, but the reader should know the review state itself will not.
  useEffect(() => {
    if (phase !== "review") return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  useEffect(() => {
    if (phase !== "review" || !draft) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [phase, draft]);

  useEffect(() => {
    const awaitingKind = awaitingKindRef.current;
    if (!awaitingKind || action.pending) return;
    const result = action.lastResult;
    if (!result || result.kind !== awaitingKind) return;

    awaitingKindRef.current = undefined;

    if (awaitingKind === "normalize_claim") {
      if (result.outcome === "denied") {
        setDeniedNotice(result.result.message);
        setPhase("composing");
        return;
      }
      const normalized = result.result as ActionResultByKind["normalize_claim"];
      if (normalized.normalizationStatus === "needs_revision") {
        setRevisionNotice(normalized.explanation);
        setPhase("composing");
        return;
      }
      setDraft({
        claimDraftId: normalized.claimDraftId,
        rawText,
        canonicalText: normalized.canonicalText,
        allegedSourceName: normalized.allegedSource?.displayName,
        expiresAt: normalized.expiresAt,
      });
      setRevisionNotice(undefined);
      setDeniedNotice(undefined);
      setPhase("review");
      return;
    }

    // awaitingKind === "tell"
    if (result.outcome === "denied") {
      setDeniedNotice(result.result.message);
      setRawText(draft?.rawText ?? rawText);
      setDraft(undefined);
      setPhase("composing");
      return;
    }
    onExchangeComplete(result);
    setDraft(undefined);
    setRawText("");
    setRevisionNotice(undefined);
    setDeniedNotice(undefined);
    setPhase("composing");
  }, [action.pending, action.lastResult]);

  const trimmed = rawText.trim();
  const graphemeCount = countGraphemeClusters(trimmed);
  const canInterpret =
    trimmed.length > 0 && graphemeCount >= 1 && graphemeCount <= MAX_GRAPHEMES;

  function submitInterpret(text: string) {
    setDeniedNotice(undefined);
    setRevisionNotice(undefined);
    setPhase("interpreting");
    awaitingKindRef.current = "normalize_claim";
    void action.submit({ kind: "normalize_claim", npcId: npc.id, text });
  }

  function handleInterpretClick() {
    if (!canInterpret) return;
    submitInterpret(trimmed);
  }

  function handleReinterpretClick() {
    if (!draft) return;
    submitInterpret(draft.rawText);
  }

  function handleEditStatement() {
    setDraft(undefined);
    setPhase("composing");
  }

  function handleTell() {
    if (!draft) return;
    setPhase("telling");
    awaitingKindRef.current = "tell";
    void action.submit({ kind: "tell", claimDraftId: draft.claimDraftId });
  }

  const expired = draft ? new Date(draft.expiresAt).getTime() - nowMs <= 0 : false;
  const disabled = action.pending || action.readOnlyPending;

  return (
    <section aria-label={`Tell ${npc.displayName}`} className="tell-panel">
      {phase === "composing" ? (
        <>
          <label htmlFor="tell-composer">What do you want to tell {npc.displayName}?</label>
          <textarea
            id="tell-composer"
            value={rawText}
            disabled={disabled}
            onChange={(event) => setRawText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (canInterpret) submitInterpret(rawText.trim());
              }
            }}
          />
          <p>If someone told you this, name them in the sentence.</p>
          <p aria-live="polite">
            {graphemeCount} / {MAX_GRAPHEMES}
          </p>
          {revisionNotice ? (
            <p role="alert">
              The town could not turn that into one supported claim. {revisionNotice}
            </p>
          ) : null}
          {deniedNotice ? <p role="alert">{deniedNotice}</p> : null}
          <button
            type="button"
            disabled={!canInterpret || disabled}
            onClick={handleInterpretClick}
          >
            Interpret claim
          </button>
          <button type="button" onClick={onCancel} disabled={disabled}>
            Cancel
          </button>
        </>
      ) : null}

      {phase === "interpreting" ? <p role="status">Interpreting your claim…</p> : null}

      {(phase === "review" || phase === "telling") && draft ? (
        <div role="dialog" aria-label="Is this what you mean?">
          <h2>Is this what you mean?</h2>

          <section aria-label="You wrote">
            <h3>You wrote</h3>
            <p>{draft.rawText}</p>
          </section>

          <section aria-label="The town will remember">
            <h3>The town will remember</h3>
            <p>{draft.canonicalText}</p>
            <p>
              {draft.allegedSourceName
                ? `Alleged source: ${draft.allegedSourceName}`
                : "Recorded source: You"}
            </p>
          </section>

          <p>
            Tell {npc.displayName} ·{" "}
            {expired
              ? "Interpretation expired"
              : `Interpretation expires in ${formatCountdown(
                  new Date(draft.expiresAt).getTime() - nowMs,
                )}`}
          </p>
          <p>This may change beliefs and may be repeated by others.</p>

          <button type="button" onClick={handleEditStatement} disabled={phase === "telling"}>
            Edit statement
          </button>
          {expired ? (
            <button type="button" onClick={handleReinterpretClick} disabled={disabled}>
              Interpret again
            </button>
          ) : (
            <button type="button" onClick={handleTell} disabled={disabled}>
              Tell {npc.displayName}
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
