import { describe, expect, it } from "vitest";

import { domainSeparatedDigest } from "@the-town-remembers/serialization";

import { computeViewVersion, PLAYER_VIEW_HASH_DOMAIN } from "./view-version.js";

describe("computeViewVersion (D2-F)", () => {
  it('is byte-exact with domainSeparatedDigest("player-view:v1", hashProjection)', () => {
    const projection = { town: { id: "t1" }, map: [] };
    expect(computeViewVersion(projection)).toBe(
      domainSeparatedDigest(PLAYER_VIEW_HASH_DOMAIN, projection),
    );
  });

  it("is deterministic for identical input", () => {
    const projection = { a: 1, b: [1, 2, 3] };
    expect(computeViewVersion(projection)).toBe(
      computeViewVersion({ a: 1, b: [1, 2, 3] }),
    );
  });

  it("changes when the projection changes", () => {
    expect(computeViewVersion({ a: 1 })).not.toBe(computeViewVersion({ a: 2 }));
  });
});
