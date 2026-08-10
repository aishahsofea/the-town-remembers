/**
 * Judge-code authentication for town creation.
 *
 * Missing or wrong-shaped credentials are `401` — no usable Bearer token was
 * ever presented, the same status `PROBLEM_STATUS_POLICY` assigns "missing or
 * invalid ... session". A correctly shaped but wrong code is `403`: a
 * credential was presented, it simply is not the one that grants this route.
 * The comparison runs over equal-length SHA-256 digests through
 * `crypto.timingSafeEqual`, so a length mismatch in the raw code is not itself
 * a timing signal.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { AppError } from "../http/errors.js";

const BEARER_PATTERN = /^Bearer (.+)$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function missingCredential(): never {
  throw new AppError({
    status: 401,
    code: "JUDGE_CODE_REQUIRED",
    title: "Judge code required",
    detail: "This route requires a Bearer judge code.",
  });
}

export function verifyJudgeCode(
  authorizationHeader: string | undefined,
  expectedCode: string,
): void {
  if (authorizationHeader === undefined) missingCredential();

  const match = BEARER_PATTERN.exec(authorizationHeader);
  if (!match) missingCredential();

  const provided = digest(match[1]!);
  const expected = digest(expectedCode);
  if (!timingSafeEqual(provided, expected)) {
    throw new AppError({
      status: 403,
      code: "JUDGE_CODE_REJECTED",
      title: "Judge code rejected",
      detail: "The presented judge code is not accepted.",
    });
  }
}
