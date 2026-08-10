/**
 * Request fingerprints for the three idempotency ledgers (`D3-H`).
 *
 * Each preimage is domain separated in the same style as every other digest
 * in the repository, and each excludes the judge code, the idempotency key,
 * a cookie, and a join secret by construction — they simply are not fields of
 * the hashed object. The API version is a parameter rather than a hardcoded
 * constant so a test can prove the mismatch path without needing a body that
 * can actually vary; `town_creation_requests`'s body is always `{}`.
 */

import { createHash } from "node:crypto";

import { API_VERSION } from "@the-town-remembers/http-contracts";
import { domainSeparatedPreimage } from "@the-town-remembers/serialization";

function preimageDigest(domain: string, payload: unknown): Buffer {
  return createHash("sha256")
    .update(domainSeparatedPreimage(domain, payload), "utf8")
    .digest();
}

/**
 * The MVP request body is always `{}` because the server selects the sole
 * authored mystery, so every real request produces the same digest; only a
 * synthetic `apiVersion` mismatch can exercise `IDEMPOTENCY_KEY_REUSED` for
 * this ledger.
 */
export function townCreationRequestHash(apiVersion: string = API_VERSION): Buffer {
  return preimageDigest("town-creation-request:v1", { apiVersion, payload: {} });
}
