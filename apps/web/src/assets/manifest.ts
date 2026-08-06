/**
 * Versioned illustration manifest.
 *
 * Decision 011 supplies opaque `sceneKey` and `portraitKey` values resolved
 * from the town's frozen content version. They are identifiers, never URLs, so
 * resolution is a table lookup. An unknown key renders a neutral placeholder
 * and records a client error rather than breaking gameplay.
 */

import { PLACEHOLDER_ASSET_LABEL, PLACEHOLDER_ASSET_SOURCE } from "./placeholder.js";

/** The exact `bell-mystery-v1` keys accepted by Decision 011. */
export const BELL_MYSTERY_V1_ASSET_KEYS = [
  "bell-mystery-v1/scenes/festival-square",
  "bell-mystery-v1/scenes/lantern-inn",
  "bell-mystery-v1/scenes/reeds-garden",
  "bell-mystery-v1/scenes/old-chapel",
  "bell-mystery-v1/portraits/mara-venn",
  "bell-mystery-v1/portraits/corin-hale",
  "bell-mystery-v1/portraits/nessa-reed",
] as const;

export type KnownAssetKey = (typeof BELL_MYSTERY_V1_ASSET_KEYS)[number];

export interface ResolvedAsset {
  readonly state: "resolved" | "fallback";
  readonly source: string;
  readonly label: string;
}

/**
 * PHASE 0 SHELL — Phase 6 owns the presentation assets. Every authored key
 * resolves to the neutral placeholder for now; the lookup and fallback paths
 * are real so a later swap changes only this table.
 */
const ASSET_SOURCES: ReadonlyMap<string, string> = new Map(
  BELL_MYSTERY_V1_ASSET_KEYS.map((key) => [key, PLACEHOLDER_ASSET_SOURCE]),
);

export type AssetLookupFailureListener = (assetKey: string) => void;

const failureListeners = new Set<AssetLookupFailureListener>();

/**
 * Registers a client error sink. Nothing here reports the failure to a remote
 * service; a missing illustration is a build problem, not telemetry.
 */
export function onAssetLookupFailure(listener: AssetLookupFailureListener): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

export function resolveAssetKey(assetKey: string): ResolvedAsset {
  const source = ASSET_SOURCES.get(assetKey);
  if (source !== undefined) {
    return { state: "resolved", source, label: "" };
  }

  for (const listener of failureListeners) listener(assetKey);
  return {
    state: "fallback",
    source: PLACEHOLDER_ASSET_SOURCE,
    label: PLACEHOLDER_ASSET_LABEL,
  };
}
