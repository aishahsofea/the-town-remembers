import { describe, expect, it, vi } from "vitest";

import {
  BELL_MYSTERY_V1_ASSET_KEYS,
  onAssetLookupFailure,
  resolveAssetKey,
} from "./manifest.js";
import { PLACEHOLDER_ASSET_SOURCE } from "./placeholder.js";

describe("asset manifest", () => {
  it.each(BELL_MYSTERY_V1_ASSET_KEYS)("resolves the authored key %s", (assetKey) => {
    expect(resolveAssetKey(assetKey).state).toBe("resolved");
  });

  it("registers the exact seven keys accepted by Decision 011", () => {
    expect(BELL_MYSTERY_V1_ASSET_KEYS).toHaveLength(7);
    expect(BELL_MYSTERY_V1_ASSET_KEYS).toContain("bell-mystery-v1/scenes/old-chapel");
    expect(BELL_MYSTERY_V1_ASSET_KEYS).toContain(
      "bell-mystery-v1/portraits/nessa-reed",
    );
  });

  it("falls back neutrally for an unknown key", () => {
    const resolved = resolveAssetKey("bell-mystery-v2/scenes/unknown");
    expect(resolved.state).toBe("fallback");
    expect(resolved.source).toBe(PLACEHOLDER_ASSET_SOURCE);
    expect(resolved.label).toBe("Illustration not yet available");
  });

  it("records exactly one client error per unknown lookup", () => {
    const listener = vi.fn();
    const unsubscribe = onAssetLookupFailure(listener);

    resolveAssetKey("bell-mystery-v1/scenes/festival-square");
    expect(listener).not.toHaveBeenCalled();

    resolveAssetKey("unknown/key");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("unknown/key");

    unsubscribe();
    resolveAssetKey("another/unknown");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("never resolves a key to an off-origin URL", () => {
    for (const assetKey of BELL_MYSTERY_V1_ASSET_KEYS) {
      const { source } = resolveAssetKey(assetKey);
      expect(source.startsWith("http://")).toBe(false);
      expect(source.startsWith("https://")).toBe(false);
      expect(source.startsWith("//")).toBe(false);
    }
  });

  it("treats a URL-shaped key as unknown rather than fetching it", () => {
    expect(resolveAssetKey("https://example.test/scene.png").state).toBe("fallback");
  });
});
