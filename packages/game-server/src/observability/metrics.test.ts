/**
 * `metrics.ts`'s runtime closed-set enforcement (`P3-18` acceptance 2): a
 * dimension value outside its declared set is rejected before it ever
 * reaches `logEvent`, proven by widening a value past what the compiler
 * would allow (`as` past the literal union) and asserting the call throws
 * rather than silently emitting an out-of-domain dimension.
 */

import { captureStdout } from "@the-town-remembers/test-support";
import { describe, expect, it } from "vitest";

import {
  HTTP_METRIC_METHODS,
  HTTP_METRIC_STATUSES,
  recordActionProcessing,
  recordActionProcessingExhausted,
  recordHttpLatency,
  recordRateLimitDecision,
  type HttpMetricMethod,
} from "./metrics.js";

describe("recordHttpLatency validates its closed dimensions at runtime (P3-18 acceptance 2)", () => {
  it("accepts every declared method and status", () => {
    for (const method of HTTP_METRIC_METHODS) {
      for (const status of HTTP_METRIC_STATUSES) {
        expect(() =>
          recordHttpLatency({
            routeTemplate: "/api/v1/health",
            method,
            status,
            latencyMs: 10,
          }),
        ).not.toThrow();
      }
    }
  });

  it("rejects a method outside the declared set", () => {
    expect(() =>
      recordHttpLatency({
        routeTemplate: "/api/v1/health",
        method: "DELETE" as unknown as HttpMetricMethod,
        status: 200,
        latencyMs: 10,
      }),
    ).toThrow(/not a member of its declared closed set/);
  });

  it("rejects a status outside the declared set", () => {
    expect(() =>
      recordHttpLatency({
        routeTemplate: "/api/v1/health",
        method: "GET",
        status: 599,
        latencyMs: 10,
      }),
    ).toThrow(/not a member of its declared closed set/);
  });

  it("emits a metric_http_latency event with every dimension it was given, once accepted", async () => {
    const captured = await captureStdout(() => {
      recordHttpLatency({
        routeTemplate: "/api/v1/health",
        method: "GET",
        status: 200,
        latencyMs: 42,
      });
    });
    expect(captured.events).toStrictEqual([
      {
        event: "metric_http_latency",
        routeTemplate: "/api/v1/health",
        method: "GET",
        status: 200,
        latencyMs: 42,
      },
    ]);
  });
});

describe("the other three metrics emit their own closed event kind", () => {
  it("recordActionProcessing", async () => {
    const captured = await captureStdout(() => {
      recordActionProcessing({
        actionKind: "travel",
        ageMs: 5,
        retries: 0,
        conflicts: 1,
      });
    });
    expect(captured.events).toStrictEqual([
      {
        event: "metric_action_processing",
        actionKind: "travel",
        ageMs: 5,
        retries: 0,
        conflicts: 1,
      },
    ]);
  });

  it("recordRateLimitDecision", async () => {
    const captured = await captureStdout(() => {
      recordRateLimitDecision({ bucketKind: "player_view", admitted: false });
    });
    expect(captured.events).toStrictEqual([
      {
        event: "metric_rate_limit_decision",
        bucketKind: "player_view",
        admitted: false,
      },
    ]);
  });

  it("recordActionProcessingExhausted", async () => {
    const captured = await captureStdout(() => {
      recordActionProcessingExhausted("inspect");
    });
    expect(captured.events).toStrictEqual([
      { event: "metric_action_processing_exhausted", actionKind: "inspect" },
    ]);
  });
});
