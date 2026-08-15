import { describe, expect, it } from "vitest";

import { classifyBedrockError } from "./error-classification.js";

function errorNamed(name: string, httpStatusCode?: number): Error {
  const error = new Error(`synthetic ${name}`);
  error.name = name;
  if (httpStatusCode !== undefined) {
    (error as Error & { $metadata: { httpStatusCode: number } }).$metadata = {
      httpStatusCode,
    };
  }
  return error;
}

describe("classifyBedrockError", () => {
  it.each([
    "ThrottlingException",
    "InternalServerException",
    "ServiceUnavailableException",
    "ModelNotReadyException",
  ])("treats %s as retryable", (name) => {
    expect(classifyBedrockError(errorNamed(name)).retryable).toBe(true);
  });

  it.each([
    "AccessDeniedException",
    "ValidationException",
    "ResourceNotFoundException",
    "ModelErrorException",
  ])("treats %s as terminal", (name) => {
    expect(classifyBedrockError(errorNamed(name)).retryable).toBe(false);
  });

  it("treats any 5xx status code as retryable even under an unrecognized name", () => {
    expect(classifyBedrockError(errorNamed("SomeFutureException", 503)).retryable).toBe(
      true,
    );
  });

  it("treats a 4xx status code as terminal", () => {
    expect(classifyBedrockError(errorNamed("SomeFutureException", 429)).retryable).toBe(
      false,
    );
  });

  it("fails closed (terminal) for a value with no name or status code", () => {
    expect(classifyBedrockError("not an error object").retryable).toBe(false);
    expect(classifyBedrockError(null).retryable).toBe(false);
    expect(classifyBedrockError(undefined).retryable).toBe(false);
  });

  it("always names the error", () => {
    expect(classifyBedrockError(errorNamed("ThrottlingException")).errorName).toBe(
      "ThrottlingException",
    );
    expect(classifyBedrockError("nope").errorName).toBe("UnknownError");
  });
});
