/**
 * `viewVersion`/`ETag`: a one-line call to
 * `domainSeparatedDigest("player-view:v1", hashProjection)` (`D2-F`) — the
 * accepted formula in Decision 006 is byte-exact with this existing Phase 0
 * primitive, so nothing new is implemented here.
 */

import { domainSeparatedDigest } from "@the-town-remembers/serialization";

export const PLAYER_VIEW_HASH_DOMAIN = "player-view:v1";

export function computeViewVersion(hashProjection: unknown): string {
  return domainSeparatedDigest(PLAYER_VIEW_HASH_DOMAIN, hashProjection);
}
