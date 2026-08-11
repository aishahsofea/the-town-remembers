/**
 * The scene-level action submission hook: tracks pending/result/error state
 * around {@link submitAction} and always defers to the caller's own
 * `onSettled` (a `player-view` refresh) rather than updating any local copy
 * of game state itself — no optimistic UI (`P3-14` acceptance 3).
 */

import { useCallback, useState } from "react";

import type { ActionRequest, CompletedActionResponse } from "@the-town-remembers/http-contracts";

import { ApiError } from "./client.js";
import { submitAction } from "./actions.js";

export interface UseActionSubmissionResult {
  readonly pending: boolean;
  readonly lastResult: CompletedActionResponse | undefined;
  readonly error: string | undefined;
  readonly submit: (request: ActionRequest) => Promise<void>;
}

export function useActionSubmission(
  townId: string,
  onSettled: () => void,
): UseActionSubmissionResult {
  const [pending, setPending] = useState(false);
  const [lastResult, setLastResult] = useState<CompletedActionResponse | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = useCallback(
    async (request: ActionRequest) => {
      setPending(true);
      setError(undefined);
      try {
        const result = await submitAction(townId, crypto.randomUUID(), request);
        setLastResult(result);
        onSettled();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.problem.detail
            : "Something went wrong. Try again.",
        );
      } finally {
        setPending(false);
      }
    },
    [townId, onSettled],
  );

  return { pending, lastResult, error, submit };
}
