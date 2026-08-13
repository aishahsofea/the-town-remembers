import { describe, expect, it } from "vitest";

import {
  HEADER_ALLOWLIST,
  filterAllowlistedHeaders,
  parseCookies,
  readHeader,
} from "./request.js";

describe("HEADER_ALLOWLIST", () => {
  it("names exactly the eight transport headers a route may read", () => {
    expect([...HEADER_ALLOWLIST].toSorted()).toStrictEqual(
      [
        "accept",
        "authorization",
        "content-type",
        "cookie",
        "idempotency-key",
        "if-none-match",
        "join-attempt-secret",
        "origin",
      ].toSorted(),
    );
  });
});

describe("filterAllowlistedHeaders", () => {
  it("keeps only allowlisted names and lowercases them", () => {
    const headers = filterAllowlistedHeaders([
      ["Content-Type", "application/json"],
      ["X-Forwarded-For", "203.0.113.5"],
      ["Authorization", "Bearer token"],
    ]);

    expect(readHeader(headers, "content-type")).toBe("application/json");
    expect(readHeader(headers, "authorization")).toBe("Bearer token");
    expect(headers.has("x-forwarded-for")).toBe(false);
    expect(headers.size).toBe(2);
  });

  it("drops an undefined value and keeps the first of a duplicated name", () => {
    const headers = filterAllowlistedHeaders([
      ["accept", undefined],
      ["origin", "https://town.example"],
      ["Origin", "https://attacker.example"],
    ]);

    expect(headers.has("accept")).toBe(false);
    expect(readHeader(headers, "origin")).toBe("https://town.example");
  });
});

describe("parseCookies", () => {
  it("returns an empty map for zero cookies", () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies("").size).toBe(0);
  });

  it("keeps a quoted value exactly as sent", () => {
    const cookies = parseCookies('greeting="hello world"');
    expect(cookies.get("greeting")).toBe('"hello world"');
  });

  it("keeps the first occurrence of a duplicated name", () => {
    const cookies = parseCookies("ttr_town_1=first; ttr_town_1=second");
    expect(cookies.get("ttr_town_1")).toBe("first");
  });

  it("keeps a value containing an equals sign intact", () => {
    const cookies = parseCookies("session=abc=def==");
    expect(cookies.get("session")).toBe("abc=def==");
  });

  it("skips a pair with an empty name", () => {
    const cookies = parseCookies("=orphan; a=1");
    expect(cookies.has("")).toBe(false);
    expect([...cookies.entries()]).toStrictEqual([["a", "1"]]);
  });

  it("parses several ordinary pairs", () => {
    const cookies = parseCookies("a=1; b=2;  c=3");
    expect([...cookies.entries()]).toStrictEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });
});
