/**
 * `/town/:townId/encounter/:npcId` — the focused NPC exchange (Decision 011
 * §"5. NPC encounter"; `P4-18`/`P4-19`). No scrolling transcript: the panel
 * shows only the latest completed exchange, kept through refresh for the
 * current visit via a display-only `sessionStorage` copy (Decision 011
 * §"Local action journal": "A display-only copy of the latest encounter
 * response may remain in `sessionStorage` until the visit ends.").
 * `selected`/`repaired`/`fallback` responses render through the same
 * `ResultCard` path with no distinguishing class, icon, or text.
 */

import { useEffect, useRef, useState } from "react";

import type {
  CompletedActionResponse,
  PlayerView,
} from "@the-town-remembers/http-contracts";
import { countGraphemeClusters } from "@the-town-remembers/http-contracts";

import type { UseActionSubmissionResult } from "../api/actionSubmission.js";
import { ResultCard } from "../components/ResultCard.js";
import { TellPanel } from "../components/TellPanel.js";
import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";

const MAX_GRAPHEMES = 500;

export interface EncounterProps {
  readonly view: PlayerView;
  readonly action: UseActionSubmissionResult;
  readonly npcId: string;
}

function exchangeStorageKey(view: PlayerView, npcId: string): string | undefined {
  const visit = view.player.visit;
  if (visit.status === "away") return undefined;
  return `ttr:encounter-exchange:${view.town.id}:${view.player.id}:${visit.visitId}:${npcId}`;
}

function readStoredExchange(key: string | undefined): CompletedActionResponse | undefined {
  if (!key) return undefined;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as CompletedActionResponse;
  } catch {
    return undefined;
  }
}

export function Encounter({ view, action, npcId }: EncounterProps) {
  const encounter = view.encounters.find((candidate) => candidate.npc.id === npcId);
  const storageKey = exchangeStorageKey(view, npcId);

  const [composerMode, setComposerMode] = useState<"none" | "ask" | "tell">("none");
  const [askText, setAskText] = useState("");
  const [latestExchange, setLatestExchange] = useState<
    CompletedActionResponse | undefined
  >(() => readStoredExchange(storageKey));
  const [tellReviewActive, setTellReviewActive] = useState(false);
  const awaitingAskRef = useRef(false);

  useEffect(() => {
    setLatestExchange(readStoredExchange(storageKey));
    setComposerMode("none");
    setTellReviewActive(false);
    // Only re-reads storage when the identity of the exchange (npc/visit) changes.
  }, [storageKey]);

  useEffect(() => {
    if (!awaitingAskRef.current || action.pending) return;
    const result = action.lastResult;
    if (!result || result.kind !== "ask") return;
    awaitingAskRef.current = false;
    setLatestExchange(result);
    if (storageKey) window.sessionStorage.setItem(storageKey, JSON.stringify(result));
    setAskText("");
    setComposerMode("none");
  }, [action.pending, action.lastResult]);

  function recordExchange(result: CompletedActionResponse) {
    setLatestExchange(result);
    if (storageKey) window.sessionStorage.setItem(storageKey, JSON.stringify(result));
    setComposerMode("none");
  }

  function navigateBack(path: string) {
    if (tellReviewActive && !window.confirm("Discard this interpretation?")) return;
    navigate(path);
  }

  if (!encounter) {
    // The router guard already redirects away from a stale co-location; this
    // is only a defensive fallback for a render that races that redirect.
    return null;
  }

  const disabled = action.pending || action.readOnlyPending;
  const trimmedAsk = askText.trim();
  const askGraphemes = countGraphemeClusters(trimmedAsk);
  const canAsk = trimmedAsk.length > 0 && askGraphemes <= MAX_GRAPHEMES;

  function submitAsk() {
    if (!canAsk || !encounter) return;
    awaitingAskRef.current = true;
    void action.submit({ kind: "ask", npcId: encounter.npc.id, question: trimmedAsk });
  }

  const canAskKind = encounter.availableActionKinds.includes("ask");
  const canTellKind =
    encounter.availableActionKinds.includes("normalize_claim") &&
    encounter.availableActionKinds.includes("tell");

  return (
    <main className="encounter-screen">
      <button
        type="button"
        onClick={() =>
          navigateBack(
            view.currentLocation
              ? buildWebPath("location", {
                  townId: view.town.id,
                  locationId: view.currentLocation.id,
                })
              : buildWebPath("map", { townId: view.town.id }),
          )
        }
      >
        Back
      </button>

      <h1>{encounter.npc.displayName}</h1>
      <p>{encounter.roleLabel}</p>
      <p>{encounter.stance}</p>
      <p>{encounter.openingLine}</p>

      <section aria-label="Latest response">
        {latestExchange ? <ResultCard result={latestExchange} /> : null}
      </section>

      {composerMode === "none" ? (
        <nav aria-label={`Actions with ${encounter.npc.displayName}`}>
          {canAskKind ? (
            <button type="button" disabled={disabled} onClick={() => setComposerMode("ask")}>
              Ask {encounter.npc.displayName}
            </button>
          ) : null}
          {canTellKind ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setComposerMode("tell")}
            >
              Tell {encounter.npc.displayName}
            </button>
          ) : null}
        </nav>
      ) : null}

      {composerMode === "ask" ? (
        <section aria-label="Ask composer">
          <label htmlFor="ask-composer">Ask {encounter.npc.displayName}</label>
          <textarea
            id="ask-composer"
            value={askText}
            disabled={disabled}
            onChange={(event) => setAskText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submitAsk();
              }
            }}
          />
          <p aria-live="polite">
            {askGraphemes} / {MAX_GRAPHEMES}
          </p>
          <button type="button" disabled={!canAsk || disabled} onClick={submitAsk}>
            Ask {encounter.npc.displayName}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setComposerMode("none")}
          >
            Cancel
          </button>
        </section>
      ) : null}

      {composerMode === "tell" ? (
        <TellPanel
          npc={encounter.npc}
          action={action}
          onExchangeComplete={recordExchange}
          onReviewActiveChange={setTellReviewActive}
          onCancel={() => setComposerMode("none")}
        />
      ) : null}
    </main>
  );
}
