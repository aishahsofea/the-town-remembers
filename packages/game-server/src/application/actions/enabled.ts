/**
 * `D3-P`: the allow-list gating which `ACTION_KINDS` this phase accepts.
 *
 * Checked after schema parsing and before any `player_actions` row is
 * created, so an out-of-phase kind (`accuse`, `resolve`, ...) is a
 * stable `422` with no ledger row and no idempotency-key consumption —
 * distinct from `404` (missing resource) and `409` (idempotency conflict).
 * Phase 4 and Phase 6 grow this list by one line each rather than editing a
 * scattered set of `switch` defaults.
 *
 * `D4-R`: the six model-backed kinds (`http-contracts#MODEL_BACKED_ACTION_KINDS`)
 * are additionally gated behind `enableNpcMutations` — with it `false` (the
 * default), they get the identical `422 UNSUPPORTED_ACTION_KIND` an
 * out-of-phase kind gets, not a different error, so a caller cannot
 * distinguish "not built yet" from "built but disabled" from the response
 * alone.
 */

import {
  MODEL_BACKED_ACTION_KINDS,
  type ActionKind,
} from "@the-town-remembers/http-contracts";

import { AppError } from "../../http/errors.js";

export const ENABLED_ACTION_KINDS = [
  "start_visit",
  "travel",
  "inspect",
  "leave",
] as const satisfies readonly ActionKind[];

const MODEL_BACKED_ACTION_KIND_SET: ReadonlySet<string> = new Set(
  MODEL_BACKED_ACTION_KINDS,
);

export function isEnabledActionKind(
  kind: ActionKind,
  enableNpcMutations: boolean,
): boolean {
  if ((ENABLED_ACTION_KINDS as readonly ActionKind[]).includes(kind)) return true;
  return enableNpcMutations && MODEL_BACKED_ACTION_KIND_SET.has(kind);
}

/** Throws the stable `422` for any well-formed kind this phase does not run — including a model-backed kind while `TTR_ENABLE_NPC_MUTATIONS` is unset. */
export function requireEnabledActionKind(
  kind: ActionKind,
  enableNpcMutations: boolean,
): void {
  if (isEnabledActionKind(kind, enableNpcMutations)) return;

  throw new AppError({
    status: 422,
    code: "UNSUPPORTED_ACTION_KIND",
    title: "Unsupported action kind",
    detail: "This town does not support that action yet.",
  });
}
