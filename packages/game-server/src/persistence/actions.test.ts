import { describe, expect, it } from "vitest";

import { retryAfterSecondsFrom } from "./actions.js";

describe("retryAfterSecondsFrom", () => {
  it("is null when there is no retry_after_at to measure against", () => {
    expect(
      retryAfterSecondsFrom(null, new Date("2026-01-01T00:00:00.000Z")),
    ).toBeNull();
  });

  it("rounds up to whole seconds remaining", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const retryAfterAt = new Date(now.getTime() + 1_500);
    expect(retryAfterSecondsFrom(retryAfterAt, now)).toBe(2);
  });

  it("floors at 1 second even if the target has already passed", () => {
    const now = new Date("2026-01-01T00:00:01.000Z");
    const retryAfterAt = new Date("2026-01-01T00:00:00.000Z");
    expect(retryAfterSecondsFrom(retryAfterAt, now)).toBe(1);
  });
});
