/**
 * `player-view` polling (Decision 011): 5s while the tab is visible, 30s
 * while hidden, an immediate refresh on every visibility change and after
 * any terminal action, and `If-None-Match` on every poll. A `304` never
 * replaces the held `PlayerView` object — the caller's `view` reference
 * stays identical, so nothing downstream re-renders from a poll that
 * changed nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerView } from "@the-town-remembers/http-contracts";
import { PlayerViewSchema, ROUTE_TEMPLATES } from "@the-town-remembers/http-contracts";

import { ApiError, apiRequest, buildPath } from "./client.js";

const VISIBLE_POLL_MS = 5_000;
const HIDDEN_POLL_MS = 30_000;

export type PlayerViewStatus = "loading" | "ready" | "unauthenticated" | "error";

export interface UsePlayerViewResult {
  readonly status: PlayerViewStatus;
  readonly view: PlayerView | undefined;
  /** Fetches immediately, outside the regular poll cadence — call after any terminal action. */
  readonly refresh: () => void;
}

export function usePlayerView(townId: string): UsePlayerViewResult {
  const [status, setStatus] = useState<PlayerViewStatus>("loading");
  const [view, setView] = useState<PlayerView | undefined>(undefined);
  const etagRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const response = await apiRequest(
        buildPath(ROUTE_TEMPLATES.playerView, { townId }),
        {
          headers: etagRef.current ? { "if-none-match": etagRef.current } : {},
        },
      );
      if (!mountedRef.current) return;

      if (response.status === 304) {
        // Nothing changed: the held `view` object keeps its identity.
        setStatus("ready");
        return;
      }

      const parsed = PlayerViewSchema.parse(response.body);
      etagRef.current = response.headers.get("etag") ?? undefined;
      setView(parsed);
      setStatus("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setStatus("unauthenticated");
        return;
      }
      setStatus("error");
    }
  }, [townId]);

  const scheduleNext = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    const delay =
      document.visibilityState === "visible" ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
    timerRef.current = setTimeout(() => {
      void poll().then(scheduleNext);
    }, delay);
  }, [poll]);

  const refresh = useCallback(() => {
    void poll().then(scheduleNext);
  }, [poll, scheduleNext]);

  useEffect(() => {
    mountedRef.current = true;
    void poll().then(scheduleNext);

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
    // Only re-runs when `townId` changes (via `poll`'s own dependency) —
    // `refresh`/`scheduleNext` are stable for a given `poll`.
  }, [poll]);

  return { status, view, refresh };
}
