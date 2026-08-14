/**
 * Renders the last completed action response directly (Decision 011
 * §"4. Location scene": "The result is rendered only from the completed
 * action response."). Never invents copy the server didn't already send,
 * except the two fixed lines Decision 011 assigns to `inspect`'s
 * `new_to_player`/`already_discovered_by_player` discovery states.
 *
 * `CompletedActionResponseSchema` is a plain union of per-kind envelopes
 * (its own doc comment: "a discriminated union cannot express" two members
 * sharing one `kind`), so TypeScript cannot narrow `result.result` from
 * `result.kind` alone the way a real discriminated union would. The casts
 * below are the deliberate, narrow workaround: each is guarded by the same
 * `kind` check a real discriminant would use, and the shape is exactly what
 * `ActionResultByKind` already declares for that kind — this never trusts
 * anything the schema itself didn't already validate server-side.
 */

import type {
  ActionResultByKind,
  CompletedActionResponse,
} from "@the-town-remembers/http-contracts";

export interface ResultCardProps {
  readonly result: CompletedActionResponse;
}

function InspectResult({ result }: { readonly result: ActionResultByKind["inspect"] }) {
  const { discovery, clue, revealedItem } = result;
  return (
    <div>
      {discovery === "new_to_player" ? (
        <p>
          The town already knew this evidence; your examination was added to its
          history.
        </p>
      ) : null}
      {discovery === "already_discovered_by_player" ? (
        <p>You have already recorded what matters here.</p>
      ) : null}
      {clue ? (
        <article aria-label="Verified evidence">
          <h3>{clue.title}</h3>
          <p>{clue.description}</p>
        </article>
      ) : null}
      {revealedItem && revealedItem.custody.kind === "player_inventory" ? (
        <article aria-label="Item found">
          <h3>{revealedItem.displayName}</h3>
          <p>{revealedItem.description}</p>
          <p>Added to your satchel.</p>
        </article>
      ) : null}
      {revealedItem && revealedItem.custody.kind === "location" ? (
        <article aria-label="Item found">
          <h3>{revealedItem.displayName}</h3>
          <p>{revealedItem.description}</p>
          <p>It stays here for now.</p>
        </article>
      ) : null}
      {discovery === "none" && !revealedItem ? (
        <p>Nothing more to record here.</p>
      ) : null}
    </div>
  );
}

export function ResultCard({ result }: ResultCardProps) {
  if (result.outcome === "denied") {
    return (
      <div className="result-card result-card--denied">
        <p role="alert">{result.result.message}</p>
      </div>
    );
  }

  if (result.kind === "inspect") {
    return (
      <div className="result-card">
        <InspectResult result={result.result as ActionResultByKind["inspect"]} />
      </div>
    );
  }

  if (result.kind === "travel") {
    const travel = result.result as ActionResultByKind["travel"];
    return (
      <div className="result-card">
        <p>
          {travel.disposition === "arrived" ? "You arrive." : "You are already there."}
        </p>
      </div>
    );
  }

  if (result.kind === "start_visit") {
    const startVisit = result.result as ActionResultByKind["start_visit"];
    return (
      <div className="result-card">
        <p>
          {startVisit.disposition === "started"
            ? "Your visit begins."
            : "Your visit is already underway."}
        </p>
      </div>
    );
  }

  if (result.kind === "leave") {
    return (
      <div className="result-card">
        <p>Your visit is complete.</p>
      </div>
    );
  }

  if (result.kind === "ask") {
    const ask = result.result as ActionResultByKind["ask"];
    return (
      <div className="result-card">
        <NpcDialogueResult dialogue={ask.dialogue} />
      </div>
    );
  }

  if (result.kind === "tell") {
    const tell = result.result as ActionResultByKind["tell"];
    return (
      <div className="result-card">
        <NpcDialogueResult dialogue={tell.dialogue} />
      </div>
    );
  }

  if (result.kind === "show") {
    const show = result.result as ActionResultByKind["show"];
    return (
      <div className="result-card">
        <p>
          {show.structuredEffect === "applied"
            ? "The town takes note of what you showed."
            : "Nothing changed."}
        </p>
        <NpcDialogueResult dialogue={show.dialogue} />
      </div>
    );
  }

  if (result.kind === "give") {
    const give = result.result as ActionResultByKind["give"];
    return (
      <div className="result-card">
        <p>{give.custody === "transferred" ? "It changes hands." : "It stays with you."}</p>
        <NpcDialogueResult dialogue={give.dialogue} />
      </div>
    );
  }

  if (result.kind === "accept_promise") {
    const accepted = result.result as ActionResultByKind["accept_promise"];
    return (
      <div className="result-card">
        <article aria-label="Promise accepted">
          <p>{accepted.promise.summary}</p>
        </article>
        {accepted.dialogue ? <NpcDialogueResult dialogue={accepted.dialogue} /> : null}
      </div>
    );
  }

  return null;
}

/**
 * `selected`, `repaired`, and `fallback` render byte-for-byte identically —
 * `responseMode` is diagnostic metadata only, never a visual signal
 * (Decision 011 §"5. NPC encounter").
 */
function NpcDialogueResult({
  dialogue,
}: {
  readonly dialogue: ActionResultByKind["ask"]["dialogue"];
}) {
  return (
    <article aria-label={`${dialogue.npcId}'s reply`}>
      <p>{dialogue.text}</p>
    </article>
  );
}
