/**
 * The `application/problem+json` error contract accepted by Decision 006.
 *
 * Stack traces, SQL detail, hidden identifiers, dependency credentials, and
 * raw model output never appear in a problem body. `detail` is authored copy
 * chosen by the server, never a dependency's own message.
 */

import { z } from "zod";

import { IdSchema, ProseTextSchema } from "./primitives.js";

export const PROBLEM_TYPE_BASE = "https://the-town-remembers/errors/" as const;

/** Status meanings fixed by the accepted core status policy. */
export const PROBLEM_STATUS_POLICY = {
  400: "Malformed JSON, header, or required field structure",
  401: "Missing or invalid player session",
  403: "Authenticated identity lacks route-level permission",
  404: "Missing, hidden, inaccessible, or cross-town resource",
  409: "Saved idempotency misuse, retryable action conflict, or another live action",
  410: "Join bootstrap closed, replay expired or exhausted, or town retired",
  422: "Well-formed request with unsupported semantic value",
  429: "Rate limit, with Retry-After",
  500: "Unexpected internal failure",
  503: "Safe temporary dependency or capacity failure",
} as const;

export type ProblemStatus = keyof typeof PROBLEM_STATUS_POLICY;

export const PROBLEM_STATUSES = Object.keys(PROBLEM_STATUS_POLICY).map(
  Number,
) as ProblemStatus[];

/**
 * Stable public codes. `RESOURCE_NOT_FOUND` is the single code every missing,
 * hidden, inaccessible, cross-town, and not-yet-implemented route returns, so
 * probing cannot distinguish those cases.
 */
export const PROBLEM_CODES = {
  resourceNotFound: "RESOURCE_NOT_FOUND",
  idempotencyKeyReused: "IDEMPOTENCY_KEY_REUSED",
  actionConflict: "ACTION_CONFLICT",
  actionInProgress: "ACTION_IN_PROGRESS",
  actionSuperseded: "ACTION_SUPERSEDED",
  actionProcessingExhausted: "ACTION_PROCESSING_EXHAUSTED",
  modelUnavailableRetryAction: "MODEL_UNAVAILABLE_RETRY_ACTION",
  joinReplayClosed: "JOIN_REPLAY_CLOSED",
  joinReplayExpired: "JOIN_REPLAY_EXPIRED",
  joinReplayExhausted: "JOIN_REPLAY_EXHAUSTED",
} as const;

export type ProblemCode = (typeof PROBLEM_CODES)[keyof typeof PROBLEM_CODES];

export const ProblemCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be a stable upper-case code");

/** JSON Pointer into the request body, or empty for a request-wide error. */
export const FieldErrorPathSchema = z
  .string()
  .regex(/^(\/[^/~]*(~[01][^/~]*)*)*$/, "must be a JSON Pointer");

export const FieldErrorSchema = z.strictObject({
  path: FieldErrorPathSchema,
  code: ProblemCodeSchema,
  message: ProseTextSchema,
});

export const ProblemResponseSchema = z.strictObject({
  type: z.url(),
  status: z.union(
    PROBLEM_STATUSES.map((status) => z.literal(status)) as [
      z.ZodLiteral<ProblemStatus>,
      ...z.ZodLiteral<ProblemStatus>[],
    ],
  ),
  code: ProblemCodeSchema,
  title: ProseTextSchema,
  detail: ProseTextSchema,
  requestId: IdSchema,
  actionId: IdSchema.optional(),
  fieldErrors: z.array(FieldErrorSchema),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;
export type ProblemResponse = z.infer<typeof ProblemResponseSchema>;

/** Derives the accepted problem type URL from a stable code. */
export function problemTypeUrl(code: string): string {
  return `${PROBLEM_TYPE_BASE}${code.toLowerCase().replaceAll("_", "-")}`;
}
