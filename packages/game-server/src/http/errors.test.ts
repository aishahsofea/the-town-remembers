import { describe, expect, it } from "vitest";

import { AppError, internalError, rateLimited, toProblemResponse } from "./errors.js";

describe("toProblemResponse", () => {
  it("maps every AppError field onto the wire contract", () => {
    const error = new AppError({
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      title: "Not found",
      detail: "No resource is available at this address.",
    });

    const problem = toProblemResponse(error, "req_abc123");
    expect(problem).toStrictEqual({
      type: "https://the-town-remembers/errors/resource-not-found",
      status: 404,
      code: "RESOURCE_NOT_FOUND",
      title: "Not found",
      detail: "No resource is available at this address.",
      requestId: "req_abc123",
      fieldErrors: [],
    });
  });

  it("attaches the action id only when the caller supplies one", () => {
    const error = new AppError({
      status: 409,
      code: "ACTION_CONFLICT",
      title: "Action conflict",
      detail: "The action must be retried.",
    });

    expect(toProblemResponse(error, "req_1")).not.toHaveProperty("actionId");
    expect(toProblemResponse(error, "req_1", "act_1").actionId).toBe("act_1");
  });

  it("falls back to the actionId the error itself carries", () => {
    const error = new AppError({
      status: 503,
      code: "ACTION_PROCESSING_EXHAUSTED",
      title: "Action processing exhausted",
      detail: "The town could not finish that action. Nothing changed.",
      actionId: "act_from_error",
    });

    expect(toProblemResponse(error, "req_1").actionId).toBe("act_from_error");
    // An explicit call-site actionId still wins over the error's own.
    expect(toProblemResponse(error, "req_1", "act_override").actionId).toBe(
      "act_override",
    );
  });

  it("carries field errors through unchanged", () => {
    const error = new AppError({
      status: 400,
      code: "MALFORMED_JSON",
      title: "Malformed request",
      detail: "The request body does not satisfy the required shape.",
      fieldErrors: [
        { path: "/name", code: "INVALID_FIELD", message: "must be a string" },
      ],
    });

    expect(toProblemResponse(error, "req_1").fieldErrors).toStrictEqual([
      { path: "/name", code: "INVALID_FIELD", message: "must be a string" },
    ]);
  });
});

describe("internalError", () => {
  it("produces an opaque 500 that never carries the underlying cause", () => {
    const error = internalError();
    expect(error.status).toBe(500);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.detail).not.toMatch(/select|stack|at /i);
  });
});

describe("rateLimited", () => {
  it("produces a 429 carrying exactly the stated Retry-After", () => {
    const error = rateLimited(2);
    expect(error.status).toBe(429);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.headers).toStrictEqual({ "retry-after": "2" });
  });

  it("never surfaces the Retry-After header inside the problem body itself", () => {
    const error = rateLimited(5);
    expect(toProblemResponse(error, "req_1")).not.toHaveProperty("retry-after");
    expect(toProblemResponse(error, "req_1")).not.toHaveProperty("headers");
  });
});
