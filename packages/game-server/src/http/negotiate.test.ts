import { z } from "zod";
import { describe, expect, it } from "vitest";

import { AppError } from "./errors.js";
import {
  MAX_JSON_BODY_BYTES,
  parseJsonBody,
  requireExactOrigin,
  requireJsonContentType,
} from "./negotiate.js";

function expectAppError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected the call to throw an AppError");
}

describe("requireJsonContentType", () => {
  it("accepts application/json with or without a charset parameter", () => {
    expect(() =>
      requireJsonContentType(new Map([["content-type", "application/json"]])),
    ).not.toThrow();
    expect(() =>
      requireJsonContentType(
        new Map([["content-type", "application/json; charset=utf-8"]]),
      ),
    ).not.toThrow();
  });

  it("rejects a missing or mismatched content type", () => {
    expect(expectAppError(() => requireJsonContentType(new Map())).status).toBe(400);
    expect(
      expectAppError(() =>
        requireJsonContentType(new Map([["content-type", "text/plain"]])),
      ).status,
    ).toBe(400);
  });
});

describe("requireExactOrigin", () => {
  const expected = "https://town.example";

  it("accepts an exact match", () => {
    expect(() =>
      requireExactOrigin(new Map([["origin", expected]]), expected),
    ).not.toThrow();
  });

  it.each([
    ["missing Origin", new Map<string, string>()],
    ["a subdomain", new Map([["origin", "https://api.town.example"]])],
    ["a scheme mismatch", new Map([["origin", "http://town.example"]])],
    ["a port mismatch", new Map([["origin", "https://town.example:8443"]])],
    ["a trailing slash", new Map([["origin", "https://town.example/"]])],
  ])("rejects %s", (_label, headers) => {
    const error = expectAppError(() => requireExactOrigin(headers, expected));
    expect(error.status).toBe(403);
    expect(error.code).toBe("ORIGIN_REJECTED");
  });
});

const PayloadSchema = z.strictObject({ name: z.string() });

describe("parseJsonBody", () => {
  it("parses a well-formed body", () => {
    expect(
      parseJsonBody(PayloadSchema, JSON.stringify({ name: "Mara" })),
    ).toStrictEqual({
      name: "Mara",
    });
  });

  it("rejects an unknown property with a JSON Pointer path", () => {
    const error = expectAppError(() =>
      parseJsonBody(PayloadSchema, JSON.stringify({ name: "Mara", extra: true })),
    );
    expect(error.status).toBe(400);
    expect(error.fieldErrors[0]?.path).toBe("");
  });

  it("rejects a wrong-typed field with the field's own JSON Pointer path", () => {
    const error = expectAppError(() =>
      parseJsonBody(PayloadSchema, JSON.stringify({ name: 5 })),
    );
    expect(error.fieldErrors[0]?.path).toBe("/name");
  });

  it("rejects a trailing comma as malformed JSON", () => {
    const error = expectAppError(() =>
      parseJsonBody(PayloadSchema, '{"name": "Mara",}'),
    );
    expect(error.code).toBe("MALFORMED_JSON");
    expect(error.fieldErrors).toStrictEqual([
      { path: "", code: "MALFORMED_JSON", message: expect.any(String) as string },
    ]);
  });

  it("rejects a null body", () => {
    const error = expectAppError(() => parseJsonBody(PayloadSchema, "null"));
    expect(error.status).toBe(400);
  });

  it("rejects an array body", () => {
    const error = expectAppError(() => parseJsonBody(PayloadSchema, "[]"));
    expect(error.status).toBe(400);
  });

  it("rejects a body at or over the accepted size", () => {
    const oversized = JSON.stringify({ name: "a".repeat(1024 * 1024) });
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(MAX_JSON_BODY_BYTES);

    const error = expectAppError(() => parseJsonBody(PayloadSchema, oversized));
    expect(error.code).toBe("REQUEST_TOO_LARGE");
  });

  it("never echoes the submitted value in any failure", () => {
    const leaked = "hunter2-leaked-value";
    for (const body of [
      JSON.stringify({ name: leaked, extra: leaked }),
      `{"name": "${leaked}",}`,
      JSON.stringify(leaked.repeat(400_000)),
    ]) {
      const error = expectAppError(() => parseJsonBody(PayloadSchema, body));
      expect(error.detail).not.toContain(leaked);
      expect(JSON.stringify(error.fieldErrors)).not.toContain(leaked);
    }
  });
});
