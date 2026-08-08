/**
 * The two ambient sources every rule function receives as explicit
 * parameters instead of reading directly.
 *
 * `packages/rules` must be reproducible from its inputs alone (`D2-G`): no
 * rule may read the system clock, generate a random identifier, or read a
 * process environment variable directly. A source scan in
 * `determinism.test.ts` enforces that no non-test file in this package
 * contains such a call.
 */

import type { Uuid, Utc } from "@the-town-remembers/database/brands";

export interface Clock {
  now(): Utc;
}

export interface IdentitySource {
  nextEventId(): Uuid;
}
