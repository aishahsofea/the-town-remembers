/**
 * The versioned dispatch table over the 13 `ACTION_KINDS`, opening with the
 * `D2-D` equality check between `database/domains#ACTION_KINDS` and
 * `http-contracts#ACTION_KINDS`.
 *
 * Every planner follows Decision 008's five-step order, but only the first
 * three steps are this package's job: (1) validate authority/location/
 * custody/pre-action snapshot; (2) calculate deterministic evidence/
 * relationship deltas; (3) derive post-action gates. Step 4 (handing the
 * model-calling phase the approved bundle) and step 5 (the caller validating
 * the rendered response and committing atomically) belong to the
 * orchestration layer Phase 3 builds on top of this package — this module
 * never calls a model and never persists anything itself.
 *
 * Seven of the thirteen kinds need no NPC dialogue at all
 * (`start_visit`/`travel`/`inspect`/`add_note`/`leave`/`accuse`/`resolve`)
 * and resolve to a complete `DecisionResult` in one call. The other six are
 * exactly `http-contracts#MODEL_BACKED_ACTION_KINDS`
 * (`ask`/`normalize_claim`/`tell`/`show`/`give`/`accept_promise`): their
 * planners can only return "external selection required" with the bounded
 * `trusted_context` `P2-07`/`P2-13` already build, and resume only once the
 * caller supplies a validated result or an authored fallback.
 */

import { ACTION_KINDS as DATABASE_ACTION_KINDS } from "@the-town-remembers/database/domains";
import {
  ACTION_KINDS as HTTP_ACTION_KINDS,
  type ActionKind,
} from "@the-town-remembers/http-contracts";

import type { ApprovedDisclosureBundle } from "../disclosure/bundle.js";
import type { DecisionResult } from "../kernel/decision.js";
import type { EffectPlanEntry } from "../kernel/effects.js";
import { ruleTrace, type RuleTrace } from "../kernel/trace.js";
import { RULES_REGISTRY } from "../kernel/version.js";

// --- D2-D: ACTION_KINDS cross-package equality -------------------------------------

export function actionKindsAgree(): boolean {
  const database: readonly string[] = DATABASE_ACTION_KINDS;
  const http: readonly string[] = HTTP_ACTION_KINDS;
  if (database.length !== http.length) return false;
  return database.every((kind, index) => kind === http[index]);
}

export class ActionKindsDriftError extends Error {
  constructor() {
    super(
      "database/domains#ACTION_KINDS and http-contracts#ACTION_KINDS have drifted apart.",
    );
    this.name = "ActionKindsDriftError";
  }
}

export function assertActionKindsAgree(): void {
  if (!actionKindsAgree()) throw new ActionKindsDriftError();
}

// --- Dispatch table -----------------------------------------------------------------

export const MODEL_BACKED_ACTION_KINDS = [
  "ask",
  "normalize_claim",
  "tell",
  "show",
  "give",
  "accept_promise",
] as const satisfies readonly ActionKind[];

export const DETERMINISTIC_ACTION_KINDS = [
  "start_visit",
  "travel",
  "inspect",
  "add_note",
  "leave",
  "accuse",
  "resolve",
] as const satisfies readonly ActionKind[];

export function isModelBackedActionKind(
  kind: ActionKind,
): kind is (typeof MODEL_BACKED_ACTION_KINDS)[number] {
  return (MODEL_BACKED_ACTION_KINDS as readonly ActionKind[]).includes(kind);
}

function makeTrace(
  ruleName: string,
  matchedStableKeys: readonly string[] = [],
): RuleTrace {
  return ruleTrace({
    rulesVersion: RULES_REGISTRY.rulesVersion,
    ruleName,
    matchedStableKeys,
    matchedReasonCode: "OK",
  });
}

export { makeTrace as dispatcherTrace };

// --- The external-selection seam (six model-backed kinds) --------------------------

/**
 * A planner for a model-backed action kind returns this instead of a
 * terminal `DecisionResult` whenever it needs NPC dialogue: `effects`
 * carries whatever was already determined deterministically (for example a
 * `give`'s custody transfer), and `trustedContext` is the bounded bundle
 * `disclosure/bundle.ts` built. Nothing here calls a model; the caller does
 * that and resumes with `resumeWithDialogue`.
 */
export interface ExternalSelectionRequired {
  readonly kind: "external_selection_required";
  readonly effects: readonly EffectPlanEntry[];
  readonly trustedContext: ApprovedDisclosureBundle;
  readonly trace: RuleTrace;
}

export interface ValidatedDialogueResume {
  readonly npcId: string;
  readonly text: string;
  readonly responseMode: "selected" | "repaired" | "fallback" | "authored";
}

export type ActionPlanResult =
  DecisionResult<EffectPlanEntry> | ExternalSelectionRequired;

export function isExternalSelectionRequired(
  result: ActionPlanResult,
): result is ExternalSelectionRequired {
  return "kind" in result;
}

/**
 * Resumes a pending external-selection planner once the caller has a
 * validated dialogue result (accepted, repaired, or an authored fallback —
 * never a raw, unvalidated model response). The dialogue text itself is
 * presentation only; it contributes no additional effect beyond what the
 * planner already determined deterministically.
 */
export function resumeWithDialogue(
  pending: ExternalSelectionRequired,
  _dialogue: ValidatedDialogueResume,
): DecisionResult<EffectPlanEntry> {
  return {
    outcome: "applied",
    reasonCode: "OK",
    effects: pending.effects,
    preconditions: {},
    trace: pending.trace,
  };
}
