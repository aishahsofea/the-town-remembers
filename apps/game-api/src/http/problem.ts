/**
 * `application/problem+json` construction.
 *
 * Every problem body is validated against the shared contract before it is
 * serialized, so a handler cannot invent a field, a status outside the
 * accepted policy, or a diagnostic detail.
 */

import type {
  ProblemResponse,
  ProblemStatus,
} from "@the-town-remembers/http-contracts";
import {
  ProblemResponseSchema,
  problemTypeUrl,
} from "@the-town-remembers/http-contracts";

import type { HttpResponse } from "./types.js";

export const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

export interface ProblemInput {
  readonly status: ProblemStatus;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly requestId: string;
}

export function buildProblem(input: ProblemInput): ProblemResponse {
  return ProblemResponseSchema.parse({
    type: problemTypeUrl(input.code),
    status: input.status,
    code: input.code,
    title: input.title,
    detail: input.detail,
    requestId: input.requestId,
    fieldErrors: [],
  });
}

export function problemResponse(
  input: ProblemInput,
  headers: Readonly<Record<string, string>>,
): HttpResponse {
  return {
    status: input.status,
    headers: { ...headers, "content-type": PROBLEM_CONTENT_TYPE },
    body: JSON.stringify(buildProblem(input)),
  };
}
