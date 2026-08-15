import { describe, expect, it } from "vitest";

import { billingMonthFor } from "./model-cost.js";

describe("billingMonthFor", () => {
  it("is the first day of the UTC month, as YYYY-MM-DD", () => {
    expect(billingMonthFor(new Date("2026-08-13T23:59:59.000Z"))).toBe("2026-08-01");
    expect(billingMonthFor(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
    expect(billingMonthFor(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12-01");
  });

  it("pads a single-digit month", () => {
    expect(billingMonthFor(new Date("2026-02-15T12:00:00.000Z"))).toBe("2026-02-01");
  });

  it("uses the UTC month, not a local one, near a month boundary", () => {
    // 2026-03-01T00:30 UTC is still 2026-02-28 in any zone west of UTC — this
    // must read the UTC calendar, never `Date#getMonth`'s local-zone answer.
    expect(billingMonthFor(new Date("2026-03-01T00:30:00.000Z"))).toBe("2026-03-01");
  });

  it("is deterministic for the same instant", () => {
    const instant = new Date("2026-08-13T10:00:00.000Z");
    expect(billingMonthFor(instant)).toBe(billingMonthFor(new Date(instant.getTime())));
  });
});
