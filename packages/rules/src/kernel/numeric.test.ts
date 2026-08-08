import { describe, expect, it } from "vitest";

import { UnknownContentVersionError } from "@the-town-remembers/content";

import {
  assertCompatibleVersions,
  clampScore,
  ContentVersionMismatchError,
  ruleFloor,
  sumEventContributions,
} from "./numeric.js";

describe("clampScore", () => {
  it.each([-20, 19, 20, 39, 40, 59, 60])(
    "leaves the in-range boundary value %i unchanged",
    (value) => {
      expect(clampScore(value)).toBe(value);
    },
  );

  it("leaves -100 and 100 unchanged", () => {
    expect(clampScore(-100)).toBe(-100);
    expect(clampScore(100)).toBe(100);
  });

  it("clamps below -100 to -100", () => {
    expect(clampScore(-101)).toBe(-100);
    expect(clampScore(-1000)).toBe(-100);
  });

  it("clamps above 100 to 100", () => {
    expect(clampScore(101)).toBe(100);
    expect(clampScore(1000)).toBe(100);
  });
});

describe("ruleFloor", () => {
  it("floors a positive fraction toward zero's lower neighbor", () => {
    expect(ruleFloor(25 / 10)).toBe(2);
  });

  it("floors a negative fraction away from zero (the Math.trunc regression)", () => {
    expect(ruleFloor(-25 / 10)).toBe(-3);
  });
});

describe("sumEventContributions", () => {
  it("sums multiple contributions to the same target from one event, then clamps once", () => {
    const contributions = [
      { target: "npc-a", delta: 70 },
      { target: "npc-a", delta: 70 },
      { target: "npc-b", delta: -30 },
    ];

    const totals = sumEventContributions(
      contributions,
      (contribution) => contribution.target,
      (contribution) => contribution.delta,
    );

    // 70 + 70 = 140, clamped once to 100 rather than clamped per contribution.
    expect(totals.get("npc-a")).toBe(100);
    expect(totals.get("npc-b")).toBe(-30);
    expect(totals.size).toBe(2);
  });

  it("returns an empty map for no contributions", () => {
    expect(
      sumEventContributions(
        [],
        () => "x",
        () => 1,
      ).size,
    ).toBe(0);
  });
});

describe("assertCompatibleVersions", () => {
  it("does not throw when the content version runs the expected rules version", () => {
    expect(() =>
      assertCompatibleVersions("bell-mystery-v1", "mvp-rules-v1"),
    ).not.toThrow();
  });

  it("throws a reason-coded error when the rules version does not match", () => {
    expect(() =>
      assertCompatibleVersions("bell-mystery-v1", "some-other-rules-v1"),
    ).toThrow(ContentVersionMismatchError);
    try {
      assertCompatibleVersions("bell-mystery-v1", "some-other-rules-v1");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContentVersionMismatchError);
      expect((error as ContentVersionMismatchError).reasonCode).toBe(
        "CONTENT_VERSION_MISMATCH",
      );
    }
  });

  it("propagates an unknown content version rather than silently defaulting", () => {
    expect(() => assertCompatibleVersions("no-such-version", "mvp-rules-v1")).toThrow(
      UnknownContentVersionError,
    );
  });
});
