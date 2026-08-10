/**
 * Content negotiation and JSON body parsing.
 *
 * Every failure here throws an {@link AppError}, so a route handler reads as
 * a straight-line sequence of requirements rather than a tree of manual
 * status codes.
 */

import type { z } from "zod";

import { AppError } from "./errors.js";

/**
 * Bodies larger than this are rejected before `JSON.parse` ever runs. No
 * Phase 3 request body — an action payload, a display name, a judge code —
 * approaches this size; a body this large is either a mistake or an attempt
 * to spend CPU on a request the server never intended to accept.
 */
export const MAX_JSON_BODY_BYTES = 262_144;

function jsonPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1"))
    .map((segment) => `/${segment}`)
    .join("");
}

export function requireJsonContentType(headers: ReadonlyMap<string, string>): void {
  const [mediaType] = (headers.get("content-type") ?? "").split(";");
  if (mediaType?.trim().toLowerCase() === "application/json") return;

  throw new AppError({
    status: 400,
    code: "INVALID_CONTENT_TYPE",
    title: "Invalid content type",
    detail: "The request must set Content-Type: application/json.",
  });
}

export function requireExactOrigin(
  headers: ReadonlyMap<string, string>,
  expectedOrigin: string,
): void {
  if (headers.get("origin") === expectedOrigin) return;

  throw new AppError({
    status: 403,
    code: "ORIGIN_REJECTED",
    title: "Origin rejected",
    detail: "The request's Origin header does not match the application origin.",
  });
}

/**
 * Parses and validates a JSON request body, or throws a `400` `AppError`
 * whose `fieldErrors` name the offending JSON Pointer path. The submitted
 * value never appears in the thrown error: every message is a fixed string,
 * never derived from the parsed content.
 */
export function parseJsonBody<T>(schema: z.ZodType<T>, raw: string | undefined): T {
  const body = raw ?? "";

  if (Buffer.byteLength(body, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new AppError({
      status: 400,
      code: "REQUEST_TOO_LARGE",
      title: "Request too large",
      detail: "The request body exceeds the accepted size.",
      fieldErrors: [
        {
          path: "",
          code: "REQUEST_TOO_LARGE",
          message: "The request body exceeds the accepted size.",
        },
      ],
    });
  }

  let candidate: unknown;
  try {
    candidate = body === "" ? undefined : JSON.parse(body);
  } catch {
    throw new AppError({
      status: 400,
      code: "MALFORMED_JSON",
      title: "Malformed JSON",
      detail: "The request body is not valid JSON.",
      fieldErrors: [
        {
          path: "",
          code: "MALFORMED_JSON",
          message: "The request body is not valid JSON.",
        },
      ],
    });
  }

  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  throw new AppError({
    status: 400,
    code: "MALFORMED_JSON",
    title: "Malformed request",
    detail: "The request body does not satisfy the required shape.",
    fieldErrors: parsed.error.issues.map((issue) => ({
      path: jsonPointer(issue.path),
      code: "INVALID_FIELD",
      message: "The submitted value does not satisfy the required shape.",
    })),
  });
}
