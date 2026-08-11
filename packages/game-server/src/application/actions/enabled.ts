/**
 * `D3-P`: the allow-list gating which `ACTION_KINDS` this phase accepts.
 *
 * Checked after schema parsing and before any `player_actions` row is
 * created, so an out-of-phase kind (`ask`, `accuse`, `resolve`, ...) is a
 * stable `422` with no ledger row and no idempotency-key consumption —
 * distinct from `404` (missing resource) and `409` (idempotency conflict).
 * Phase 4 and Phase 6 grow this list by one line each rather than editing a
 * scattered set of `switch` defaults.
 */

import type { ActionKind } from "@the-town-remembers/http-contracts";

import { AppError } from "../../http/errors.js";

export const ENABLED_ACTION_KINDS = [
  "start_visit",
  "travel",
  "inspect",
  "leave",
] as const satisfies readonly ActionKind[];

export function isEnabledActionKind(
  kind: ActionKind,
): kind is (typeof ENABLED_ACTION_KINDS)[number] {
  return (ENABLED_ACTION_KINDS as readonly ActionKind[]).includes(kind);
}

/** Throws the stable `422` for any well-formed kind this phase does not run yet. */
export function requireEnabledActionKind(kind: ActionKind): void {
  if (isEnabledActionKind(kind)) return;

  throw new AppError({
    status: 422,
    code: "UNSUPPORTED_ACTION_KIND",
    title: "Unsupported action kind",
    detail: "This town does not support that action yet.",
  });
}
