/**
 * Branded column types.
 *
 * CockroachDB's wire types do not survive contact with JavaScript on their own:
 * a UUID, an authored key, and a display name are all `string`, and nothing
 * stops one being passed where another belongs. Branding the ones whose
 * confusion would be silent — identity, digests, money, time, vectors — turns
 * that class of mistake into a compile error.
 *
 * The brands are structural, not runtime. Nothing here allocates or validates;
 * `asUuid` is an assertion the caller makes, and the database remains the
 * authority that refuses a value it does not like.
 */

declare const brand: unique symbol;

type Branded<T, Name extends string> = T & { readonly [brand]: Name };

/** A generated, opaque identifier. Never meaningful to a player. */
export type Uuid = Branded<string, "Uuid">;

/** SHA-256 output. Raw tokens are never stored, only these. */
export type Sha256Bytes = Branded<Uint8Array, "Sha256Bytes">;

/**
 * A USD amount as an exact decimal string. `pg` returns `DECIMAL` as text and
 * this keeps it that way: a monthly spend ceiling enforced in binary floating
 * point would drift.
 */
export type UsdCost = Branded<string, "UsdCost">;

/** A `TIMESTAMPTZ`, always written and compared in UTC. */
export type Utc = Branded<Date, "Utc">;

/** The first day of a UTC billing month, as `YYYY-MM-DD`. */
export type BillingMonth = Branded<string, "BillingMonth">;

/** A 256-dimension episode embedding. */
export type Vector256 = Branded<readonly number[], "Vector256">;

/** A versioned JSONB payload. Its shape is validated by a Zod contract first. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const asUuid = (value: string): Uuid => value as Uuid;
export const asSha256Bytes = (value: Uint8Array): Sha256Bytes => value as Sha256Bytes;
export const asUsdCost = (value: string): UsdCost => value as UsdCost;
export const asUtc = (value: Date): Utc => value as Utc;
export const asBillingMonth = (value: string): BillingMonth => value as BillingMonth;
export const asVector256 = (value: readonly number[]): Vector256 => value as Vector256;

/**
 * Renders an embedding as the text form CockroachDB accepts. Measured: the
 * driver has no binary vector codec, and `array_fill` does not exist, so the
 * literal is the interface.
 */
export function encodeVector(vector: Vector256): string {
  return `[${vector.join(",")}]`;
}

export function decodeVector(text: string): Vector256 {
  return asVector256(
    text
      .replace(/^\[|\]$/g, "")
      .split(",")
      .filter((part) => part !== "")
      .map(Number),
  );
}
