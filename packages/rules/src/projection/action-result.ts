/**
 * Builds each `CompletedActionResponse` variant directly by kind. The real
 * schema is a 26-branch plain `z.union` (two members per action kind), not
 * a discriminated union, because `kind` alone cannot disambiguate
 * `outcome`/`result` pairing — this module must not assume a discriminator
 * exists at the Zod layer when validating its own output.
 */

import type {
  ActionKind,
  ActionResultByKind,
  DeniedActionResult,
  NpcDialogue,
} from "@the-town-remembers/http-contracts";

export interface DeniedCompletedResponse<K extends ActionKind> {
  readonly actionId: string;
  readonly kind: K;
  readonly status: "completed";
  readonly outcome: "denied";
  readonly result: DeniedActionResult;
}

export interface SucceededCompletedResponse<K extends ActionKind> {
  readonly actionId: string;
  readonly kind: K;
  readonly status: "completed";
  readonly outcome: "applied" | "no_change";
  readonly result: ActionResultByKind[K];
}

export type CompletedResponseFor<K extends ActionKind> =
  DeniedCompletedResponse<K> | SucceededCompletedResponse<K>;

export function buildDeniedResponse<K extends ActionKind>(
  actionId: string,
  kind: K,
  reasonCode: string,
  message: string,
  dialogue?: NpcDialogue,
): DeniedCompletedResponse<K> {
  const result: DeniedActionResult =
    dialogue === undefined
      ? { type: "denied", reasonCode, message }
      : { type: "denied", reasonCode, message, dialogue };
  return { actionId, kind, status: "completed", outcome: "denied", result };
}

export function buildSucceededResponse<K extends ActionKind>(
  actionId: string,
  kind: K,
  outcome: "applied" | "no_change",
  result: ActionResultByKind[K],
): SucceededCompletedResponse<K> {
  return { actionId, kind, status: "completed", outcome, result };
}
