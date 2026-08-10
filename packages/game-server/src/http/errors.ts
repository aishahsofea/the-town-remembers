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
  ProblemResponseSchema,
  problemTypeUrl,
} from "@the-town-remembers/http-contracts";

export interface AppErrorInput {
  readonly status: ProblemStatus;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors?: readonly FieldError[];
}

export class AppError extends Error {
  readonly status: ProblemStatus;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors: readonly FieldError[];

  constructor(input: AppErrorInput) {
    super(input.detail);
    this.name = "AppError";
    this.status = input.status;
    this.code = input.code;
    this.title = input.title;
    this.detail = input.detail;
    this.fieldErrors = input.fieldErrors ?? [];
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

export function toProblemResponse(
  error: AppError,
  requestId: string,
  actionId?: string,
): ProblemResponse {
  return ProblemResponseSchema.parse({
    type: problemTypeUrl(error.code),
    status: error.status,
    code: error.code,
    title: error.title,
    detail: error.detail,
    requestId,
    ...(actionId !== undefined ? { actionId } : {}),
    fieldErrors: error.fieldErrors,
  });
}
