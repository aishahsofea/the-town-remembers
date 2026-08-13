import { describe, expect, it } from "vitest";

import { buildWebPath, matchWebRoute, type WEB_ROUTES } from "./routes.js";

describe("matchWebRoute", () => {
  it("matches every one of the eight route templates", () => {
    const cases: readonly [string, keyof typeof WEB_ROUTES][] = [
      ["/join/abc123", "joinBootstrap"],
      ["/join", "join"],
      ["/town/t1/map", "map"],
      ["/town/t1/location/loc1", "location"],
      ["/town/t1/encounter/npc1", "encounter"],
      ["/town/t1/board", "board"],
      ["/town/t1/between-visits", "betweenVisits"],
      ["/town/t1/resolution", "resolution"],
    ];
    for (const [path, name] of cases) {
      expect(matchWebRoute(path)?.name).toBe(name);
    }
  });

  it("extracts every named param", () => {
    expect(matchWebRoute("/town/t1/location/loc1")?.params).toStrictEqual({
      townId: "t1",
      locationId: "loc1",
    });
  });

  it("percent-decodes a param value", () => {
    expect(matchWebRoute("/join/a%20b")?.params).toStrictEqual({ inviteToken: "a b" });
  });

  it("resolves a trailing slash identically to the bare path", () => {
    expect(matchWebRoute("/town/t1/map/")).toStrictEqual(matchWebRoute("/town/t1/map"));
  });

  it("treats a doubled slash as unmatched, never a param with an empty value", () => {
    expect(matchWebRoute("/join//")).toBeUndefined();
  });

  it("returns undefined for a genuinely unmatched path", () => {
    expect(matchWebRoute("/does-not-exist")).toBeUndefined();
    expect(matchWebRoute("/")).toBeUndefined();
  });

  it("does not match /join/:inviteToken against the bare /join route or vice versa", () => {
    expect(matchWebRoute("/join")?.name).toBe("join");
    expect(matchWebRoute("/join/xyz")?.name).toBe("joinBootstrap");
  });
});

describe("buildWebPath", () => {
  it("fills every named param and needs no params for a static route", () => {
    expect(buildWebPath("map", { townId: "t1" })).toBe("/town/t1/map");
    expect(buildWebPath("join")).toBe("/join");
  });

  it("round-trips through matchWebRoute", () => {
    const path = buildWebPath("location", { townId: "t1", locationId: "loc1" });
    expect(matchWebRoute(path)).toStrictEqual({
      name: "location",
      params: { townId: "t1", locationId: "loc1" },
    });
  });
});
