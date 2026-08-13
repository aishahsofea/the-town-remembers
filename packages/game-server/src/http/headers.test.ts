import { describe, expect, it } from "vitest";

import {
  etagHeader,
  locationHeader,
  noStoreHeaders,
  privateNoCacheHeaders,
  retryAfter,
  securityHeaders,
} from "./headers.js";

describe("header builders", () => {
  it("builds cache headers for a mutation response", () => {
    expect(noStoreHeaders()).toStrictEqual({ "cache-control": "no-store" });
  });

  it("builds cache headers for an authenticated read response", () => {
    expect(privateNoCacheHeaders()).toStrictEqual({
      "cache-control": "private, no-cache",
      vary: "Cookie",
    });
  });

  it("quotes the view version as an ETag", () => {
    expect(etagHeader("abc123")).toStrictEqual({ etag: '"abc123"' });
  });

  it("builds Retry-After from a whole number of seconds", () => {
    expect(retryAfter(2)).toStrictEqual({ "retry-after": "2" });
  });

  it("builds a Location header from an absolute or relative URL", () => {
    expect(locationHeader("/api/v1/towns/town_1/actions/act_1")).toStrictEqual({
      location: "/api/v1/towns/town_1/actions/act_1",
    });
  });

  it("builds the route-invariant security headers", () => {
    expect(securityHeaders("req_abc")).toStrictEqual({
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-request-id": "req_abc",
    });
  });
});
