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

interface PollResult {
  readonly succeeded: boolean;
  readonly retryAfterMs?: number;
}

export interface UsePlayerViewResult {
  readonly status: PlayerViewStatus;
  readonly view: PlayerView | undefined;
  /** Fetches immediately and resolves true only after a usable 200/304 response. */
  readonly refresh: () => Promise<boolean>;
}

export function usePlayerView(townId: string): UsePlayerViewResult {
  const [status, setStatus] = useState<PlayerViewStatus>("loading");
  const [view, setView] = useState<PlayerView | undefined>(undefined);
  const etagRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);
  const lastSuccessfulGenerationRef = useRef(0);
  const hasViewRef = useRef(false);

  const poll = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    try {
      const response = await apiRequest(
        buildPath(ROUTE_TEMPLATES.playerView, { townId }),
        {
          headers: etagRef.current ? { "if-none-match": etagRef.current } : {},
        },
      );
      if (!mountedRef.current) return { succeeded: false };

      // A newer request owns the screen now. Treat this one as confirmed only
      // if that newer request already succeeded; otherwise the action journal
      // must remain until a projection is actually applied.
      if (generation !== requestGenerationRef.current) {
        return { succeeded: lastSuccessfulGenerationRef.current > generation };
      }

      if (response.status === 304) {
        // Nothing changed: the held `view` object keeps its identity.
        lastSuccessfulGenerationRef.current = generation;
        setStatus("ready");
        return { succeeded: true };
      }

      const parsed = PlayerViewSchema.parse(response.body);
      etagRef.current = response.headers.get("etag") ?? undefined;
      hasViewRef.current = true;
      lastSuccessfulGenerationRef.current = generation;
      setView(parsed);
      setStatus("ready");
      return { succeeded: true };
    } catch (error) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return { succeeded: false };
      }
      if (error instanceof ApiError && error.status === 401) {
        setStatus("unauthenticated");
        return { succeeded: false };
      }
      if (error instanceof ApiError && error.status === 429) {
        const retryAfterSeconds = Number(error.headers.get("retry-after"));
        setStatus(hasViewRef.current ? "ready" : "error");
        return {
          succeeded: false,
          retryAfterMs:
            Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
              ? retryAfterSeconds * 1_000
              : 1_000,
        };
      }
      // A transient refresh failure must not discard an already-confirmed
      // projection; callers keep it readable and retain their action journal.
      setStatus(hasViewRef.current ? "ready" : "error");
      return { succeeded: false };
    }
  }, [townId]);

  const scheduleNext = useCallback(() => {
    if (!mountedRef.current) return;
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    const delay =
      document.visibilityState === "visible" ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
    timerRef.current = setTimeout(() => {
      void poll().then(() => scheduleNext());
    }, delay);
  }, [poll]);

  const refresh = useCallback(async () => {
    let result: PollResult = await poll();
    if (result.retryAfterMs !== undefined && mountedRef.current) {
      await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs));
      result = await poll();
    }
    scheduleNext();
    return result.succeeded;
  }, [poll, scheduleNext]);

  useEffect(() => {
    mountedRef.current = true;
    hasViewRef.current = false;
    etagRef.current = undefined;
    setView(undefined);
    setStatus("loading");
    void poll().then(() => scheduleNext());

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
    // Only re-runs when `townId` changes (via `poll`'s own dependency) —
    // `refresh`/`scheduleNext` are stable for a given `poll`.
  }, [poll, refresh, scheduleNext]);

  return { status, view, refresh };
}
