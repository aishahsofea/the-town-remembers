import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalJson } from "./canonical-json.js";

function expectRejection(value: unknown, code: string): void {
  try {
    canonicalJson(value);
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalJsonError);
    expect((error as CanonicalJsonError).code).toBe(code);
    return;
  }
  throw new Error("Expected canonicalJson to reject the value");
}

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it("produces one output for differently ordered but equal objects", () => {
    const first = canonicalJson({ zeta: true, alpha: [1, 2], mid: { y: 1, x: 2 } });
    const second = canonicalJson({ mid: { x: 2, y: 1 }, alpha: [1, 2], zeta: true });
    expect(first).toBe(second);
  });

  it("treats array order as meaningful", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalJson({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it("keeps nested empty containers stable", () => {
    expect(canonicalJson({ a: {}, b: [], c: [{}] })).toBe('{"a":{},"b":[],"c":[{}]}');
  });

  it("preserves Unicode content through JSON escaping", () => {
    const value = { text: "Mära 🔔 ́ ünïcode  " };
    const encoded = canonicalJson(value);
    expect(JSON.parse(encoded)).toStrictEqual(value);
    expect(Buffer.from(encoded, "utf8").toString("utf8")).toBe(encoded);
  });

  it("keeps distinct Unicode normalizations distinct", () => {
    const composed = canonicalJson({ name: "é" });
    const decomposed = canonicalJson({ name: "é" });
    expect(composed).not.toBe(decomposed);
  });

  it("sorts keys by code unit rather than locale", () => {
    expect(canonicalJson({ a: 1, B: 2, A: 3 })).toBe('{"A":3,"B":2,"a":1}');
  });

  it("omits own properties whose value is undefined", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects explicit undefined, functions, symbols, and bigints", () => {
    expectRejection(undefined, "unsupported_type");
    expectRejection([undefined], "unsupported_type");
    expectRejection({ a: () => 1 }, "unsupported_type");
    expectRejection({ a: Symbol("x") }, "unsupported_type");
    expectRejection({ a: 1n }, "unsupported_type");
  });

  it("rejects non-finite numbers", () => {
    expectRejection(Number.NaN, "non_finite_number");
    expectRejection({ a: Number.POSITIVE_INFINITY }, "non_finite_number");
  });

  it("rejects values that only look like JSON objects", () => {
    expectRejection(new Date(0), "non_plain_object");
    expectRejection(new Map(), "non_plain_object");
    expectRejection(new Set(), "non_plain_object");
    expectRejection(new (class Town {})(), "non_plain_object");
  });

  it("rejects cycles instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expectRejection(cyclic, "circular_reference");
  });

  it("accepts a value repeated in two places", () => {
    const shared = { a: 1 };
    expect(canonicalJson({ left: shared, right: shared })).toBe(
      '{"left":{"a":1},"right":{"a":1}}',
    );
  });

  it("names the rejected path without echoing the rejected value", () => {
    try {
      canonicalJson({ outer: { inner: Number.NaN } });
    } catch (error) {
      const failure = error as CanonicalJsonError;
      expect(failure.path).toBe("outer.inner");
      expect(failure.message).not.toContain("NaN");
      return;
    }
    throw new Error("Expected canonicalJson to reject the value");
  });
});
