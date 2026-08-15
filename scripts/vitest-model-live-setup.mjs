/**
 * Global setup for the opt-in `model-live` vitest project (`D4-U`).
 *
 * Applies the same local `.env`/`.env.defaults` merge every operator script
 * uses, so `TTR_MODEL_LIVE_TESTS=1 vitest run --project model-live` reads
 * real configuration the same way `pnpm model:prewarm` does, without a
 * developer having to source `.env` into their shell by hand first.
 */

import { applyLocalDefaults } from "./local-env.mjs";

export default async function setup() {
  applyLocalDefaults();
}
