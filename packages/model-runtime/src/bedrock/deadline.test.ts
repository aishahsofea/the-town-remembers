import { describe, expect, it } from "vitest";

import { fitsBeforeReserve } from "./deadline.js";

const DEADLINE = new Date("2026-08-13T12:00:24.000Z");

describe("fitsBeforeReserve", () => {
  it("fits when now + worstCase lands exactly at the reserved boundary", () => {
    expect(
      fitsBeforeReserve({
        now: new Date("2026-08-13T12:00:12.000Z"),
        applicationDeadlineAt: DEADLINE,
        worstCaseMs: 8000,
        reserveMs: 4000,
      }),
    ).toBe(true);
  });

  it("does not fit when it would land one millisecond past the reserved boundary", () => {
    expect(
      fitsBeforeReserve({
        now: new Date("2026-08-13T12:00:12.001Z"),
        applicationDeadlineAt: DEADLINE,
        worstCaseMs: 8000,
        reserveMs: 4000,
      }),
    ).toBe(false);
  });

  it("never fits once now is already past the deadline minus reserve", () => {
    expect(
      fitsBeforeReserve({
        now: new Date("2026-08-13T12:00:21.000Z"),
        applicationDeadlineAt: DEADLINE,
        worstCaseMs: 0,
        reserveMs: 4000,
      }),
    ).toBe(false);
  });
});
