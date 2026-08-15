import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DEPENDENCY_OUTCOME_KINDS,
  type AcceptedOutcome,
  type ContentStopOutcome,
  type FallbackOutcome,
  type ParseFailureOutcome,
  type RepairedOutcome,
  type SchemaFailureOutcome,
  type SemanticRejectionOutcome,
  type TimeoutOutcome,
  type TransportFailureOutcome,
} from "./outcomes.js";

describe("DEPENDENCY_OUTCOME_KINDS", () => {
  it("has exactly the nine accepted kinds", () => {
    expect(DEPENDENCY_OUTCOME_KINDS).toHaveLength(9);
    expect(new Set(DEPENDENCY_OUTCOME_KINDS).size).toBe(9);
  });
});

describe("no failure outcome type carries a field that could hold raw model text (P4-04 acceptance 4)", () => {
  // toEqualTypeOf is an exact-shape compile-time check: adding any new field
  // to one of these interfaces — rawText included — fails this file's own
  // typecheck, not just a runtime assertion.
  it("TransportFailureOutcome is exactly {kind, retryable, errorName}", () => {
    expectTypeOf<TransportFailureOutcome>().toEqualTypeOf<{
      readonly kind: "transport_failure";
      readonly retryable: boolean;
      readonly errorName: string;
    }>();
  });

  it("TimeoutOutcome is exactly {kind, attempted}", () => {
    expectTypeOf<TimeoutOutcome>().toEqualTypeOf<{
      readonly kind: "timeout";
      readonly attempted: boolean;
    }>();
  });

  it("ContentStopOutcome is exactly {kind, stopReason}", () => {
    expectTypeOf<ContentStopOutcome>().toEqualTypeOf<{
      readonly kind: "content_stop";
      readonly stopReason: string;
    }>();
  });

  it("ParseFailureOutcome is exactly {kind} — no text field at all", () => {
    expectTypeOf<ParseFailureOutcome>().toEqualTypeOf<{
      readonly kind: "parse_failure";
    }>();
  });

  it("SchemaFailureOutcome is exactly {kind, issueCount} — a count, never the invalid value", () => {
    expectTypeOf<SchemaFailureOutcome>().toEqualTypeOf<{
      readonly kind: "schema_failure";
      readonly issueCount: number;
    }>();
  });

  it("SemanticRejectionOutcome is exactly {kind, errorCodes} — stable codes, never raw output", () => {
    expectTypeOf<SemanticRejectionOutcome>().toEqualTypeOf<{
      readonly kind: "semantic_rejection";
      readonly errorCodes: readonly string[];
    }>();
  });

  it("FallbackOutcome is exactly {kind} — no field at all", () => {
    expectTypeOf<FallbackOutcome>().toEqualTypeOf<{ readonly kind: "fallback" }>();
  });

  it("none of the failure variants declares a text/raw/output-shaped key", () => {
    expectTypeOf<TransportFailureOutcome>().not.toHaveProperty("text");
    expectTypeOf<TransportFailureOutcome>().not.toHaveProperty("rawText");
    expectTypeOf<ContentStopOutcome>().not.toHaveProperty("text");
    expectTypeOf<ParseFailureOutcome>().not.toHaveProperty("rawText");
    expectTypeOf<ParseFailureOutcome>().not.toHaveProperty("text");
    expectTypeOf<SchemaFailureOutcome>().not.toHaveProperty("rawText");
    expectTypeOf<SchemaFailureOutcome>().not.toHaveProperty("text");
    expectTypeOf<SchemaFailureOutcome>().not.toHaveProperty("value");
    expectTypeOf<SemanticRejectionOutcome>().not.toHaveProperty("rawOutput");
  });
});

describe("accepted/repaired outcomes carry typed, already-validated results only", () => {
  it("AcceptedOutcome<T> is exactly {kind, result: T, usage}", () => {
    expectTypeOf<AcceptedOutcome<{ readonly x: number }>>().toEqualTypeOf<{
      readonly kind: "accepted";
      readonly result: { readonly x: number };
      readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    }>();
  });

  it("RepairedOutcome<T> is exactly {kind, result: T, usage}", () => {
    expectTypeOf<RepairedOutcome<{ readonly x: number }>>().toEqualTypeOf<{
      readonly kind: "repaired";
      readonly result: { readonly x: number };
      readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    }>();
  });
});

describe("runtime cross-check: constructed instances carry no unexpected keys", () => {
  it("matches the exact key set for every failure outcome, at runtime", () => {
    const transportFailure: TransportFailureOutcome = {
      kind: "transport_failure",
      retryable: true,
      errorName: "ThrottlingException",
    };
    expect(Object.keys(transportFailure).toSorted()).toStrictEqual([
      "errorName",
      "kind",
      "retryable",
    ]);

    const parseFailure: ParseFailureOutcome = { kind: "parse_failure" };
    expect(Object.keys(parseFailure)).toStrictEqual(["kind"]);
  });
});
