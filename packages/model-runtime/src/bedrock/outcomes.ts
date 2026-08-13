/**
 * The closed `DependencyOutcome` union every Bedrock-backed call eventually
 * resolves to. `bedrock/converse.ts` alone can only ever produce
 * `transport_failure`/`timeout`/`content_stop`/`parse_failure`/
 * `schema_failure`/`accepted` — it has no `trusted_context` and cannot judge
 * semantics. `semantic_rejection`/`repaired`/`fallback` are added by the
 * orchestration layer above it (`P4-09`/`P4-10`) once `validation/*.ts` has
 * run. The union is declared once, here, so every layer agrees on one
 * vocabulary from the start rather than each inventing its own.
 *
 * Every failure variant below carries only a kind, a stable reason, and
 * small safe metadata (a count, a stop reason, a retryability flag) — never
 * the rejected raw text. `accepted`/`repaired` carry `result`, but only
 * after it already passed Zod validation against the accepted output
 * schema, so it is typed, bounded data, not arbitrary model prose. The raw
 * text a repair call needs is handed to the caller through
 * `ConverseParams.onRejectedRawText`, a callback argument, not a field on
 * any of these types — there is nowhere on `DependencyOutcome` a raw string
 * of arbitrary model output could be smuggled into a log or a persisted row.
 */

export const DEPENDENCY_OUTCOME_KINDS = [
  "transport_failure",
  "timeout",
  "content_stop",
  "parse_failure",
  "schema_failure",
  "semantic_rejection",
  "accepted",
  "repaired",
  "fallback",
] as const;

export type DependencyOutcomeKind = (typeof DEPENDENCY_OUTCOME_KINDS)[number];

export interface TokenUsageSummary {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TransportFailureOutcome {
  readonly kind: "transport_failure";
  readonly retryable: boolean;
  readonly errorName: string;
}

export interface TimeoutOutcome {
  readonly kind: "timeout";
  /** False when the call's worst case never fit before the reserve — no AWS call was constructed at all. */
  readonly attempted: boolean;
}

export interface ContentStopOutcome {
  readonly kind: "content_stop";
  readonly stopReason: string;
}

export interface ParseFailureOutcome {
  readonly kind: "parse_failure";
}

export interface SchemaFailureOutcome {
  readonly kind: "schema_failure";
  readonly issueCount: number;
}

export interface SemanticRejectionOutcome {
  readonly kind: "semantic_rejection";
  readonly errorCodes: readonly string[];
}

export interface AcceptedOutcome<TOutput> {
  readonly kind: "accepted";
  readonly result: TOutput;
  readonly usage: TokenUsageSummary;
}

export interface RepairedOutcome<TOutput> {
  readonly kind: "repaired";
  readonly result: TOutput;
  readonly usage: TokenUsageSummary;
}

export interface FallbackOutcome {
  readonly kind: "fallback";
}

export type DependencyOutcome<TOutput> =
  | TransportFailureOutcome
  | TimeoutOutcome
  | ContentStopOutcome
  | ParseFailureOutcome
  | SchemaFailureOutcome
  | SemanticRejectionOutcome
  | AcceptedOutcome<TOutput>
  | RepairedOutcome<TOutput>
  | FallbackOutcome;
