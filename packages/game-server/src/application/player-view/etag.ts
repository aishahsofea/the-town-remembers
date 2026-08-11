/**
 * `viewVersion` / `ETag` for the built projection (`P3-06`).
 *
 * `rules#computeViewVersion` already is the byte-exact Decision 006 formula;
 * this module's only job is hashing the projection with `viewVersion` itself
 * excluded (a self-referential field cannot be part of its own hash input)
 * and comparing the result against a client's `If-None-Match`.
 *
 * `build.ts#buildPlayerView` returns a draft whose `viewVersion` is `""` — a
 * placeholder never sent to a client. The caller always routes that draft
 * through {@link computePlayerViewVersion} and {@link finalizePlayerView}
 * before it reaches `PlayerViewSchema.parse` or a response body.
 */

import type { PlayerView } from "@the-town-remembers/http-contracts";
import { computeViewVersion } from "@the-town-remembers/rules";

/** Hashes a draft projection with its own placeholder `viewVersion` excluded. */
export function computePlayerViewVersion(draft: PlayerView): string {
  const { viewVersion: _placeholder, ...hashable } = draft;
  return computeViewVersion(hashable);
}

export function finalizePlayerView(draft: PlayerView, viewVersion: string): PlayerView {
  return { ...draft, viewVersion };
}

/** `If-None-Match` carries the quoted `viewVersion`, matching `headers.ts#etagHeader`. */
export function ifNoneMatchSatisfies(
  ifNoneMatch: string | undefined,
  viewVersion: string,
): boolean {
  return ifNoneMatch === `"${viewVersion}"`;
}
