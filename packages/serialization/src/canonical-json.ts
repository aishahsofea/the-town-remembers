/**
 * Canonical JSON serialization shared by request fingerprints, claim keys, and
 * player-view versions.
 *
 * The accepted definition in Decision 005 is: object keys are recursively
 * sorted, each array keeps its caller-established semantic order, output is
 * UTF-8, and no insignificant whitespace is emitted. Anything JSON cannot
 * represent unambiguously is rejected rather than coerced, because a silent
 * coercion would let two different states produce the same hash.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export type CanonicalJsonErrorCode =
  "unsupported_type" | "non_finite_number" | "non_plain_object" | "circular_reference";

/**
 * Thrown instead of emitting a lossy encoding. The message names the offending
 * JSON path and value kind, never the value itself, so a rejected secret or
 * player utterance cannot reach a log through an error string.
 */
export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;
  readonly path: string;

  constructor(code: CanonicalJsonErrorCode, path: string, detail: string) {
    super(`Canonical JSON rejected ${path || "<root>"}: ${detail}`);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path;
  }
}

const OBJECT_PROTOTYPES: ReadonlySet<unknown> = new Set([Object.prototype, null]);

function describeType(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "bigint") return "a bigint";
  return Object.prototype.toString.call(value);
}

function isPlainObject(value: object): boolean {
  return OBJECT_PROTOTYPES.has(Object.getPrototypeOf(value));
}

function childPath(path: string, segment: string): string {
  return path === "" ? segment : `${path}.${segment}`;
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("non_finite_number", path, "numbers must be finite");
    }
    return JSON.stringify(value);
  }

  if (typeof value === "string") return JSON.stringify(value);

  if (typeof value !== "object") {
    throw new CanonicalJsonError(
      "unsupported_type",
      path,
      `${describeType(value)} has no canonical form`,
    );
  }

  const objectValue: object = value;
  if (seen.has(objectValue)) {
    throw new CanonicalJsonError(
      "circular_reference",
      path,
      "a value cannot contain itself",
    );
  }
  seen.add(objectValue);

  try {
    if (Array.isArray(objectValue)) {
      const items = objectValue.map((item, index) =>
        serialize(item, childPath(path, String(index)), seen),
      );
      return `[${items.join(",")}]`;
    }

    if (!isPlainObject(objectValue)) {
      throw new CanonicalJsonError(
        "non_plain_object",
        path,
        `${describeType(objectValue)} has no canonical form; convert it first`,
      );
    }

    const entries = Object.entries(objectValue as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${serialize(entryValue, childPath(path, key), seen)}`,
      );
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(objectValue);
  }
}

/**
 * Serializes a value to its canonical UTF-8 JSON form.
 *
 * An own property whose value is `undefined` is omitted, matching `JSON`
 * semantics. An explicit `undefined`, function, symbol, or bigint anywhere else
 * is rejected.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, "", new Set());
}
