/**
 * The security secrets the browser journey's API server runs with.
 *
 * `loadSecurityConfig` fails closed, so the API adapter refuses to start
 * without all four of these. A developer's ignored `.env` supplies them
 * locally, but CI has no `.env` and `.env.defaults` may hold no credential —
 * which left the journey's `webServer` unable to boot there at all. Defining
 * them here instead makes the journey hermetic: it boots the same way on a
 * fresh clone, on CI, and on a machine whose `.env` holds real values.
 *
 * These are throwaway fixtures, public by construction, and they authenticate
 * nothing beyond the disposable database `playwright.config.ts` creates for a
 * single run. Never reuse one anywhere else; a real value belongs only in an
 * ignored `.env` or a deployed secret store.
 *
 * `playwright.config.ts` passes these to the API server it spawns, and the
 * specs read the judge code from the same constant, so the two cannot drift
 * apart the way a `process.env` lookup on each side would.
 */

/**
 * Bearer code the journey presents to create a town. Kept just over the
 * schema's 16-character floor and under the 20 that
 * `check-artifact-safety.mjs` treats as a leaked bearer token, so a failing
 * run's uploaded report cannot be rejected for carrying this fixture.
 */
export const E2E_JUDGE_CODE = "e2e-judge-fixture";

/**
 * Frozen so a spec cannot mutate what the already-running server was started
 * with. Shaped as the environment record `webServer.env` expects.
 */
export const E2E_SECURITY_ENV: Readonly<Record<string, string>> = Object.freeze({
  TTR_JUDGE_CODE: E2E_JUDGE_CODE,
  TTR_INVITE_SIGNING_KEYS: "v1:mb4snOcYI6p3IrUO7L1ZmQnBiyzscFrUc_pH7xkrGig",
  TTR_SESSION_TOKEN_PEPPER: "zoF6AveMnHZ2Op3-0TU_vL_1yBfbl4MRd-Gf2Sx8ms0",
  TTR_IP_HASH_SECRET: "n6F3G_rh5K1lsCi-MVWBSyyIJICfnOOloYI5OUgyMhI",
});
