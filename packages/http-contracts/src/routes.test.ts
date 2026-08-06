import { describe, expect, it } from "vitest";

import {
  API_BASE_PATH,
  API_VERSION,
  ROUTE_TEMPLATES,
  UNMATCHED_ROUTE_TEMPLATE,
} from "./routes.js";

describe("route identity", () => {
  it("exposes the accepted API version", () => {
    expect(API_VERSION).toBe("v1");
    expect(API_BASE_PATH).toBe("/api/v1");
  });

  it("keeps every route template under the versioned base path", () => {
    for (const template of Object.values(ROUTE_TEMPLATES)) {
      expect(template.startsWith(`${API_BASE_PATH}/`)).toBe(true);
    }
  });

  it("covers exactly the accepted route surface", () => {
    expect(Object.keys(ROUTE_TEMPLATES).toSorted()).toStrictEqual([
      "actionStatus",
      "actions",
      "health",
      "invitePreview",
      "inviteJoin",
      "playerView",
      "towns",
    ]);
  });

  it("uses a placeholder that can never collide with a real template", () => {
    expect(UNMATCHED_ROUTE_TEMPLATE.startsWith("/")).toBe(false);
    expect(Object.values(ROUTE_TEMPLATES)).not.toContain(UNMATCHED_ROUTE_TEMPLATE);
  });
});
