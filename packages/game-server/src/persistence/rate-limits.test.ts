import { describe, expect, it } from "vitest";

import { NO_TOWN_SCOPE, RATE_LIMIT_BUCKETS, rateScopeKey } from "./rate-limits.js";

describe("rateScopeKey", () => {
  it("is always exactly 32 bytes", () => {
    expect(rateScopeKey("player", "town_1", "player_1")).toHaveLength(32);
    expect(rateScopeKey("ip_hash", NO_TOWN_SCOPE, "some-ip-hash")).toHaveLength(32);
  });

  it("is deterministic for identical inputs", () => {
    const first = rateScopeKey("player", "town_1", "player_1");
    const second = rateScopeKey("player", "town_1", "player_1");
    expect(first).toStrictEqual(second);
  });

  it("folds the town: the same subject in two towns yields two scope keys", () => {
    const inTownA = rateScopeKey("player", "town_a", "player_1");
    const inTownB = rateScopeKey("player", "town_b", "player_1");
    expect(inTownA).not.toStrictEqual(inTownB);
  });

  it("distinguishes two different subjects in the same town", () => {
    const playerA = rateScopeKey("player", "town_1", "player_a");
    const playerB = rateScopeKey("player", "town_1", "player_b");
    expect(playerA).not.toStrictEqual(playerB);
  });

  it("never renders a dotted or colonned address into the digest input", () => {
    // The preimage is domain-separated text; a real caller only ever passes an
    // already-hashed IP string (base64url), never a raw dotted-quad or colonned
    // IPv6 literal, but the function itself places no such value in scope_key
    // regardless — it hashes whatever string it is given.
    const key = rateScopeKey("ip_hash", NO_TOWN_SCOPE, "192.0.2.1");
    expect(key.toString("utf8")).not.toContain("192.0.2.1");
  });
});

describe("RATE_LIMIT_BUCKETS", () => {
  it("matches Decision 006's rates, bursts, and scopes exactly", () => {
    expect(RATE_LIMIT_BUCKETS.playerView).toStrictEqual({
      bucketKind: "player_view",
      scopeKind: "player",
      ratePerWindow: 30,
      windowMs: 60_000,
      burst: 10,
    });
    expect(RATE_LIMIT_BUCKETS.townCreation).toStrictEqual({
      bucketKind: "town_creation",
      scopeKind: "ip_hash",
      ratePerWindow: 5,
      windowMs: 900_000,
      burst: 5,
    });
    expect(RATE_LIMIT_BUCKETS.join).toStrictEqual({
      bucketKind: "join",
      scopeKind: "ip_hash",
      ratePerWindow: 10,
      windowMs: 900_000,
      burst: 10,
    });
  });

  it("matches D4-S's model_action rates, bursts, and scopes exactly", () => {
    expect(RATE_LIMIT_BUCKETS.modelActionPlayer).toStrictEqual({
      bucketKind: "model_action",
      scopeKind: "player",
      ratePerWindow: 6,
      windowMs: 60_000,
      burst: 3,
    });
    expect(RATE_LIMIT_BUCKETS.modelActionTown).toStrictEqual({
      bucketKind: "model_action",
      scopeKind: "town",
      ratePerWindow: 30,
      windowMs: 60_000,
      burst: 10,
    });
  });
});
