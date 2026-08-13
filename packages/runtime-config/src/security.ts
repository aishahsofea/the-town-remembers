/**
 * Security-secret configuration for the game API's authenticated boundary.
 *
 * The judge code, invite-derivation keys, session-token pepper, and IP-hash
 * secret are the only category whose values must never reach a request path
 * beyond the two units that need them. `check-workspace-boundaries.mjs`
 * restricts `./security` to `packages/game-server` and `apps/game-api`, so an
 * ambient worker or the browser bundle has no import path to it even by
 * accident. Every variable name here already matches `SECRET_VARIABLE_PATTERN`,
 * so a `VITE_`-prefixed variant is rejected from browser-public configuration
 * by construction.
 */

import { z } from "zod";

import { parseEnvironment, required, type EnvironmentRecord } from "./shared.js";

export {
  ConfigurationError,
  type ConfigurationCategory,
  type ConfigurationIssue,
} from "./shared.js";

/** Unpadded base64url encoding of exactly 32 raw bytes (256 bits). */
const BASE64URL_32_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITE_SIGNING_KEY_VERSION_PATTERN = /^v[1-9][0-9]*$/;

export interface InviteSigningKey {
  readonly version: string;
  /** Raw 32-byte key material; never logged. */
  readonly key: Uint8Array;
}

/**
 * Parses `TTR_INVITE_SIGNING_KEYS`'s `<version>:<base64url-32-bytes>[,...]`
 * shape. The first entry is the active version; every entry stays parseable
 * so a creation record from an older version can still be replayed.
 */
function parseInviteSigningKeys(value: string): InviteSigningKey[] | undefined {
  const entries = value.split(",");
  const keys: InviteSigningKey[] = [];
  const seenVersions = new Set<string>();

  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator === -1) return undefined;

    const version = entry.slice(0, separator);
    const encoded = entry.slice(separator + 1);
    if (!INVITE_SIGNING_KEY_VERSION_PATTERN.test(version)) return undefined;
    if (!BASE64URL_32_BYTES_PATTERN.test(encoded)) return undefined;
    if (seenVersions.has(version)) return undefined;

    seenVersions.add(version);
    keys.push({ version, key: Buffer.from(encoded, "base64url") });
  }

  return keys.length > 0 ? keys : undefined;
}

const SecurityConfigSchema = z.strictObject({
  TTR_JUDGE_CODE: z.string().min(16),
  TTR_INVITE_SIGNING_KEYS: z
    .string()
    .refine(
      (value) => parseInviteSigningKeys(value) !== undefined,
      "must be a comma-separated <version>:<base64url-32-bytes> list with unique versions",
    ),
  TTR_SESSION_TOKEN_PEPPER: z
    .string()
    .regex(BASE64URL_32_BYTES_PATTERN, "must be 256 bits of base64url"),
  TTR_IP_HASH_SECRET: z
    .string()
    .regex(BASE64URL_32_BYTES_PATTERN, "must be 256 bits of base64url"),
});

export interface SecurityConfig {
  /** Compared with `crypto.timingSafeEqual`; never logged. */
  readonly judgeCode: string;
  /** Ordered exactly as configured; index 0 is the active signing key. */
  readonly inviteSigningKeys: readonly InviteSigningKey[];
  /** Held only by the session-token hasher; never logged. */
  readonly sessionTokenPepper: string;
  /** Held only by the IP-hash rotation; never logged. */
  readonly ipHashSecret: string;
}

export function loadSecurityConfig(source: EnvironmentRecord): SecurityConfig {
  const parsed = parseEnvironment(
    "security-runtime",
    SecurityConfigSchema,
    {
      TTR_JUDGE_CODE: required(source, "TTR_JUDGE_CODE"),
      TTR_INVITE_SIGNING_KEYS: required(source, "TTR_INVITE_SIGNING_KEYS"),
      TTR_SESSION_TOKEN_PEPPER: required(source, "TTR_SESSION_TOKEN_PEPPER"),
      TTR_IP_HASH_SECRET: required(source, "TTR_IP_HASH_SECRET"),
    },
    source,
  );

  return {
    judgeCode: parsed.TTR_JUDGE_CODE,
    inviteSigningKeys: parseInviteSigningKeys(parsed.TTR_INVITE_SIGNING_KEYS)!,
    sessionTokenPepper: parsed.TTR_SESSION_TOKEN_PEPPER,
    ipHashSecret: parsed.TTR_IP_HASH_SECRET,
  };
}
