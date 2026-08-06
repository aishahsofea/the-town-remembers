/**
 * Shared value domains for the public HTTP surface accepted by Decision 006.
 *
 * Every transport schema is built from these primitives so a bound defined
 * once cannot drift between two routes. Text bounds count Unicode grapheme
 * clusters, not UTF-16 code units, because that is what the accepted contract
 * specifies.
 */

import { z } from "zod";

/**
 * Opaque identifier. Clients must not infer database type or game meaning from
 * the format, so the schema constrains only what makes an identifier safe to
 * place in a URL path, a JSON body, or a log field.
 */
export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "must be an opaque URL-safe identifier");

/** RFC 3339 UTC with exactly three fractional digits. */
export const IsoTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "must be UTC RFC 3339")
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }, "must be a real instant");

/** UUID carried by the `Idempotency-Key` header on every state-changing POST. */
export const IdempotencyKeySchema = z.uuid();

/** 256-bit base64url value held only in the joining tab's session storage. */
export const JoinAttemptSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "must be 256 bits of base64url");

/** base64url SHA-256 output used for the opaque player-view version. */
export const ViewVersionSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "must be a base64url SHA-256 digest");

/** Frozen authored content version, for example `bell-mystery-v1`. */
export const ContentVersionSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be a lowercase content version");

/**
 * Opaque lookup into the town content version's bundled illustration manifest.
 * It is never an arbitrary URL, so scheme, authority, dot, and traversal
 * characters are all rejected.
 */
export const AssetKeySchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)+$/,
    "must be a slash-separated lowercase asset key",
  );

/** Build identity reported by the health route. */
export const BuildIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "must be a safe build identifier");

const GRAPHEME_SEGMENTER = new Intl.Segmenter("und", { granularity: "grapheme" });

/** Counts Unicode grapheme clusters, the unit every accepted text bound uses. */
export function countGraphemeClusters(text: string): number {
  return [...GRAPHEME_SEGMENTER.segment(text)].length;
}

/** Control characters and the markup delimiters rejected by Decision 006. */
const FORBIDDEN_TEXT_PATTERN = /[\p{Cc}\p{Cn}\p{Co}\p{Cs}<>]/u;

/**
 * Plain text with grapheme-cluster bounds. The value must already be trimmed:
 * accepting untrimmed input here would let two different submissions produce
 * the same stored text and therefore the same fingerprint.
 */
export function plainText(minimum: number, maximum: number): z.ZodType<string> {
  return z
    .string()
    .refine(
      (value) => value === value.trim(),
      "must not have leading or trailing space",
    )
    .refine(
      (value) => !FORBIDDEN_TEXT_PATTERN.test(value),
      "must not contain control characters or markup",
    )
    .refine((value) => {
      const length = countGraphemeClusters(value);
      return length >= minimum && length <= maximum;
    }, `must contain ${minimum} to ${maximum} grapheme clusters`);
}

/** Player-visible display copy resolved from the town's frozen content. */
export const DisplayTextSchema = plainText(1, 200);

/** Longer authored prose such as a location description or an epilogue. */
export const ProseTextSchema = plainText(1, 2000);

/** `ask` question and raw claim text: 1 through 500 grapheme clusters. */
export const AskQuestionSchema = plainText(1, 500);

/** Raw claim text submitted for normalization. */
export const ClaimTextSchema = plainText(1, 500);

/** Case-board note: 1 through 280 grapheme clusters. */
export const NoteTextSchema = plainText(1, 280);

const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} '-]+$/u;

/**
 * Fixed player display name. Normalization uses NFKC with collapsed
 * whitespace; case folding for uniqueness happens in the database layer, so
 * this schema validates the displayed form the player accepted.
 */
export const DisplayNameSchema = z
  .string()
  .refine((value) => value.normalize("NFKC") === value, "must be NFKC normalized")
  .refine((value) => !/\s{2,}/.test(value), "must not contain repeated whitespace")
  .refine((value) => value === value.trim(), "must not have leading or trailing space")
  .refine(
    (value) => DISPLAY_NAME_PATTERN.test(value),
    "may contain only letters, numbers, spaces, apostrophes, and hyphens",
  )
  .refine((value) => {
    const length = countGraphemeClusters(value);
    return length >= 2 && length <= 24;
  }, "must contain 2 to 24 grapheme clusters");

export type Id = z.infer<typeof IdSchema>;
export type IsoTime = z.infer<typeof IsoTimeSchema>;
