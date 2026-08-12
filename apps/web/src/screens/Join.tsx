/**
 * `/join` — invite preview, existing-session resume, and first-time join
 * (Decision 011 §"1. Invite and join").
 *
 * Reads the invite token from page memory only (`routing/inviteToken.ts`),
 * never from the URL — by the time this renders, `JoinBootstrap` has already
 * replaced the address bar with the tokenless `/join`. A direct load or
 * refresh of `/join` therefore always finds no captured token, which is
 * exactly the "reopen the invite" state (`P3-13` acceptance 3).
 */

import { useEffect, useReducer, useRef } from "react";

import type {
  InvitePreviewResponse,
  JoinMode,
} from "@the-town-remembers/http-contracts";
import { DisplayNameSchema } from "@the-town-remembers/http-contracts";

import { ApiError, NetworkError } from "../api/client.js";
import { fetchInvitePreview, joinTown, probeExistingSession } from "../api/invite.js";
import { clearJoinSession, loadOrCreateJoinSession } from "../api/joinSession.js";
import { getCapturedInviteToken } from "../routing/inviteToken.js";
import { navigate } from "../routing/navigation.js";
import { buildWebPath } from "../routing/routes.js";

type JoinState =
  | { readonly phase: "no_token" }
  | { readonly phase: "loading_preview" }
  | { readonly phase: "preview_error" }
  | { readonly phase: "checking_session"; readonly preview: InvitePreviewResponse }
  | {
      readonly phase: "returning";
      readonly preview: InvitePreviewResponse;
      readonly displayName: string;
    }
  | { readonly phase: "form"; readonly preview: InvitePreviewResponse }
  | {
      readonly phase: "submitting";
      readonly preview: InvitePreviewResponse;
      readonly displayName: string;
    }
  | {
      readonly phase: "conflict";
      readonly preview: InvitePreviewResponse;
      readonly displayName: string;
    }
  | {
      readonly phase: "submit_error";
      readonly preview: InvitePreviewResponse;
      readonly displayName: string;
      readonly message: string;
    };

type JoinAction =
  | { readonly type: "preview_failed" }
  | { readonly type: "preview_ready"; readonly preview: InvitePreviewResponse }
  | { readonly type: "session_found"; readonly displayName: string }
  | { readonly type: "session_absent" }
  | { readonly type: "submit_started"; readonly displayName: string }
  | { readonly type: "submit_conflict" }
  | { readonly type: "submit_failed"; readonly message: string }
  | { readonly type: "edit" };

function reduce(state: JoinState, action: JoinAction): JoinState {
  switch (action.type) {
    case "preview_failed":
      return { phase: "preview_error" };
    case "preview_ready":
      return { phase: "checking_session", preview: action.preview };
    case "session_found":
      return "preview" in state
        ? {
            phase: "returning",
            preview: state.preview,
            displayName: action.displayName,
          }
        : state;
    case "session_absent":
      return "preview" in state ? { phase: "form", preview: state.preview } : state;
    case "submit_started":
      return "preview" in state
        ? {
            phase: "submitting",
            preview: state.preview,
            displayName: action.displayName,
          }
        : state;
    case "submit_conflict":
      return "preview" in state && "displayName" in state
        ? { phase: "conflict", preview: state.preview, displayName: state.displayName }
        : state;
    case "submit_failed":
      return "preview" in state && "displayName" in state
        ? {
            phase: "submit_error",
            preview: state.preview,
            displayName: state.displayName,
            message: action.message,
          }
        : state;
    case "edit":
      return "preview" in state ? { phase: "form", preview: state.preview } : state;
  }
}

const TOWN_STATUS_LABEL: Record<InvitePreviewResponse["townStatus"], string> = {
  active: "Open for visits",
  awaiting_resolution: "Awaiting its final choice",
  resolved: "Story complete",
};

function statusLabel(preview: InvitePreviewResponse): string {
  return preview.joinMode === "closed"
    ? "Closed"
    : TOWN_STATUS_LABEL[preview.townStatus];
}

function submitLabel(joinMode: JoinMode): string {
  return joinMode === "read_only" ? "Read what the town remembers" : "Enter the town";
}

function validateDisplayName(value: string): string | undefined {
  const parsed = DisplayNameSchema.safeParse(value);
  if (parsed.success) return undefined;
  return parsed.error.issues[0]?.message ?? "That name isn't allowed.";
}

export function Join() {
  const [state, dispatch] = useReducer(reduce, { phase: "no_token" } as JoinState);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const townIdRef = useRef<string | undefined>(undefined);

  const inviteToken = getCapturedInviteToken();

  useEffect(() => {
    if (inviteToken === undefined) return;
    let active = true;

    fetchInvitePreview(inviteToken)
      .then((preview) => {
        if (active) dispatch({ type: "preview_ready", preview });
      })
      .catch(() => {
        if (active) dispatch({ type: "preview_failed" });
      });

    return () => {
      active = false;
    };
  }, [inviteToken]);

  useEffect(() => {
    if (state.phase !== "checking_session") return;
    townIdRef.current = state.preview.townId;
    let active = true;

    probeExistingSession(state.preview.townId)
      .then((view) => {
        if (!active) return;
        if (view)
          dispatch({ type: "session_found", displayName: view.player.displayName });
        else dispatch({ type: "session_absent" });
      })
      .catch(() => {
        if (active) dispatch({ type: "session_absent" });
      });

    return () => {
      active = false;
    };
  }, [state]);

  useEffect(() => {
    if (state.phase === "conflict") {
      nameInputRef.current?.select();
    }
  }, [state.phase]);

  if (inviteToken === undefined) {
    return (
      <main className="join-screen">
        <h1>The Town Remembers</h1>
        <p role="status">Reopen the invite link to continue.</p>
      </main>
    );
  }

  if (state.phase === "no_token" || state.phase === "loading_preview") {
    return (
      <main className="join-screen">
        <h1>The Town Remembers</h1>
        <p role="status" aria-live="polite">
          Loading the invitation…
        </p>
      </main>
    );
  }

  if (state.phase === "preview_error") {
    return (
      <main className="join-screen">
        <h1>The Town Remembers</h1>
        <p role="status">This invite link no longer works.</p>
      </main>
    );
  }

  const { preview } = state;

  function handleReturn() {
    navigate(buildWebPath("map", { townId: preview.townId }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawDisplayName = formData.get("displayName");
    const displayName = (
      typeof rawDisplayName === "string" ? rawDisplayName : ""
    ).trim();
    if (validateDisplayName(displayName) !== undefined) return;
    if (inviteToken === undefined) return;

    dispatch({ type: "submit_started", displayName });
    const session = loadOrCreateJoinSession(inviteToken);

    try {
      await joinTown({
        inviteToken,
        displayName,
        idempotencyKey: session.idempotencyKey,
        joinAttemptSecret: session.joinAttemptSecret,
      });
      clearJoinSession();
      navigate(buildWebPath("map", { townId: preview.townId }), { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.problem.code === "DISPLAY_NAME_TAKEN") {
        // The server conclusively rejected this body, so the next edited name
        // is a new operation rather than a retry of the old fingerprint.
        clearJoinSession();
        dispatch({ type: "submit_conflict" });
        return;
      }
      if (error instanceof NetworkError) {
        dispatch({
          type: "submit_failed",
          message: "Connection lost. Your join attempt is still safe to retry.",
        });
        return;
      }
      dispatch({
        type: "submit_failed",
        message:
          error instanceof ApiError
            ? error.problem.detail
            : "Something went wrong. Try again.",
      });
    }
  }

  return (
    <main className="join-screen">
      <h1>{preview.mysteryTitle}</h1>
      <p className="join-screen__tagline">{preview.tagline}</p>
      <p className="join-screen__description">{preview.description}</p>
      <p className="join-screen__status">{statusLabel(preview)}</p>

      {preview.joinMode === "closed" ? (
        <p role="status">This town is no longer taking visitors.</p>
      ) : state.phase === "checking_session" ? (
        <p role="status" aria-live="polite">
          Checking for your visit…
        </p>
      ) : state.phase === "returning" ? (
        <button type="button" onClick={handleReturn}>
          Return as {state.displayName}
        </button>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="join-display-name">Your name</label>
          <input
            id="join-display-name"
            name="displayName"
            ref={nameInputRef}
            defaultValue={"displayName" in state ? state.displayName : ""}
            minLength={2}
            maxLength={24}
            required
            autoComplete="off"
            disabled={state.phase === "submitting"}
          />
          {state.phase === "conflict" ? (
            <p role="alert">That name is already in use in this town.</p>
          ) : null}
          {state.phase === "submit_error" ? <p role="alert">{state.message}</p> : null}
          <button type="submit" disabled={state.phase === "submitting"}>
            {submitLabel(preview.joinMode)}
          </button>
        </form>
      )}
    </main>
  );
}
