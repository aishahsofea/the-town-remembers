/**
 * Health polling for the foundation diagnostic page.
 *
 * The request path is relative, so the browser never constructs an absolute
 * API URL and the local Vite proxy exercises the same `/api/v1/health` shape
 * the deployed application serves. A body that fails contract validation is
 * treated as unavailable rather than rendered.
 */

import { useCallback, useEffect, useState } from "react";

import type { HealthResponse } from "@the-town-remembers/http-contracts";
import {
  HealthResponseSchema,
  ROUTE_TEMPLATES,
} from "@the-town-remembers/http-contracts";

export type HealthState =
  | { readonly status: "loading" }
  | { readonly status: "healthy"; readonly health: HealthResponse }
  | { readonly status: "unavailable" };

export async function fetchHealth(signal?: AbortSignal): Promise<HealthState> {
  try {
    const response = await fetch(ROUTE_TEMPLATES.health, {
      headers: { accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return { status: "unavailable" };

    const parsed = HealthResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { status: "healthy", health: parsed.data }
      : { status: "unavailable" };
  } catch {
    // The reason is deliberately discarded: a fetch failure message can
    // contain the resolved URL, and the page has nothing safe to do with it.
    return { status: "unavailable" };
  }
}

export interface UseHealthResult {
  readonly state: HealthState;
  readonly retry: () => void;
}

export function useHealth(): UseHealthResult {
  const [state, setState] = useState<HealthState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setState({ status: "loading" });
    void fetchHealth(controller.signal).then((next) => {
      if (active) setState(next);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  return { state, retry };
}
