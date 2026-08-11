/**
 * The single mapper from a thrown application failure to the wire contract.
 *
 * Every validation, authorization, and domain-rule failure in this package
 * throws an {@link AppError}. Exactly one place converts it to a
 * `ProblemResponse` — `toProblemResponse` — so a handler cannot invent its own
 * problem body shape, and a stack trace or dependency message never has a path
 * into a response.
 */

import type {
  FieldError,
  ProblemResponse,
  ProblemStatus,
} from "@the-town-remembers/http-contracts";
import {
  PROBLEM_CODES,
  ProblemResponseSchema,
  problemTypeUrl,
} from "@the-town-remembers/http-contracts";

import { retryAfter } from "./headers.js";

export interface AppErrorInput {
  readonly status: ProblemStatus;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors?: readonly FieldError[];
  /** Response headers beyond the problem body, e.g. `Retry-After` on a `429`. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Present only when a `player_actions` record exists for this failure. */
  readonly actionId?: string;
}

export class AppError extends Error {
  readonly status: ProblemStatus;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors: readonly FieldError[];
  readonly headers: Readonly<Record<string, string>>;
  readonly actionId: string | undefined;

  constructor(input: AppErrorInput) {
    super(input.detail);
    this.name = "AppError";
    this.status = input.status;
    this.code = input.code;
    this.title = input.title;
    this.detail = input.detail;
    this.fieldErrors = input.fieldErrors ?? [];
    this.headers = input.headers ?? {};
    this.actionId = input.actionId;
  }
}

/** An opaque, detail-free failure for anything that is not an `AppError`. */
export function internalError(detail = "An unexpected error occurred."): AppError {
  return new AppError({
    status: 500,
    code: "INTERNAL_ERROR",
    title: "Internal error",
    detail,
  });
}

/** A `429` never consumes an idempotency key and always carries `Retry-After`. */
export function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError({
    status: 429,
    code: PROBLEM_CODES.rateLimited,
    title: "Rate limit exceeded",
    detail: "Too many requests. Try again later.",
    headers: retryAfter(retryAfterSeconds),
  });
}

/** `actionId` defaults to the one the error itself carries, if any. */
export function toProblemResponse(
  error: AppError,
  requestId: string,
  actionId?: string,
): ProblemResponse {
  const resolvedActionId = actionId ?? error.actionId;
  return ProblemResponseSchema.parse({
    type: problemTypeUrl(error.code),
    status: error.status,
    code: error.code,
    title: error.title,
    detail: error.detail,
    requestId,
    ...(resolvedActionId !== undefined ? { actionId: resolvedActionId } : {}),
    fieldErrors: error.fieldErrors,
  });
}
