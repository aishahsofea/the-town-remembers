import { describe, expect, it } from "vitest";

import {
  clampToReservation,
  decimalStringToMicroUsd,
  microUsdToDecimalString,
  settledMicroUsd,
  worstCaseMicroUsd,
} from "./estimate.js";

describe("worstCaseMicroUsd", () => {
  it("is deterministic and positive for every accepted purpose/model pair", () => {
    for (const purpose of [
      "claim_normalization",
      "dialogue_selection",
      "ambient_choice",
      "structured_repair",
      "episode_embedding",
      "query_embedding",
    ]) {
      const model =
        purpose === "episode_embedding" || purpose === "query_embedding"
          ? "titan"
          : "haiku";
      const first = worstCaseMicroUsd(purpose, model);
      const second = worstCaseMicroUsd(purpose, model);
      expect(first).toBe(second);
      expect(first).toBeGreaterThan(0);
    }
  });

  it("costs more for dialogue on Sonnet than on Haiku, same purpose", () => {
    const sonnetCost = worstCaseMicroUsd("dialogue_selection", "sonnet");
    const haikuCost = worstCaseMicroUsd("dialogue_selection", "haiku");
    expect(sonnetCost).toBeGreaterThan(haikuCost);
  });

  it("fails closed for an unknown purpose or model", () => {
    expect(() => worstCaseMicroUsd("unknown", "haiku")).toThrow();
    expect(() => worstCaseMicroUsd("claim_normalization", "unknown")).toThrow();
  });
});

describe("settledMicroUsd", () => {
  it("is zero for zero usage", () => {
    expect(
      settledMicroUsd("haiku", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });

  it("scales linearly with token count", () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const doubled = { ...usage, inputTokens: 2000 };
    expect(settledMicroUsd("haiku", doubled)).toBe(2 * settledMicroUsd("haiku", usage));
  });

  it("never returns a fractional value for Titan's small per-token rate", () => {
    const cost = settledMicroUsd("titan", {
      inputTokens: 50,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(Number.isInteger(cost)).toBe(true);
  });
});

describe("clampToReservation", () => {
  it("passes an amount within the reservation through unchanged", () => {
    expect(clampToReservation(500, 1000)).toStrictEqual({
      amountMicroUsd: 500,
      clamped: false,
    });
  });

  it("clamps and flags an amount exceeding the reservation", () => {
    expect(clampToReservation(1500, 1000)).toStrictEqual({
      amountMicroUsd: 1000,
      clamped: true,
    });
  });

  it("passes an amount exactly at the reservation through unchanged", () => {
    expect(clampToReservation(1000, 1000)).toStrictEqual({
      amountMicroUsd: 1000,
      clamped: false,
    });
  });
});

describe("microUsdToDecimalString", () => {
  it.each([
    [0, "0.000000"],
    [1, "0.000001"],
    [1_000_000, "1.000000"],
    [1_234_567, "1.234567"],
    [10_350_000, "10.350000"],
  ])("formats %i micro-USD as %s", (microUsd, expected) => {
    expect(microUsdToDecimalString(microUsd)).toBe(expected);
  });

  it("formats a negative amount with a leading sign", () => {
    expect(microUsdToDecimalString(-1_500_000)).toBe("-1.500000");
  });
});

describe("decimalStringToMicroUsd", () => {
  it.each([
    ["0.000000", 0],
    ["0.000001", 1],
    ["1.000000", 1_000_000],
    ["1.234567", 1_234_567],
    ["10.350000", 10_350_000],
    ["-1.500000", -1_500_000],
  ])("parses %s as %i micro-USD", (decimal, expected) => {
    expect(decimalStringToMicroUsd(decimal)).toBe(expected);
  });

  it("round-trips every value microUsdToDecimalString can produce", () => {
    for (const microUsd of [0, 1, 999_999, 1_000_000, 10_350_000, 123_456_789]) {
      expect(decimalStringToMicroUsd(microUsdToDecimalString(microUsd))).toBe(microUsd);
    }
  });

  it("pads a short fractional part, matching CockroachDB's own trimmed-zero text output", () => {
    expect(decimalStringToMicroUsd("1.5")).toBe(1_500_000);
    expect(decimalStringToMicroUsd("0.2")).toBe(200_000);
  });

  it("throws on a non-decimal string, including more than six fractional digits", () => {
    expect(() => decimalStringToMicroUsd("not-a-decimal")).toThrow();
    expect(() => decimalStringToMicroUsd("1.2345678")).toThrow();
    expect(() => decimalStringToMicroUsd("")).toThrow();
  });
});
