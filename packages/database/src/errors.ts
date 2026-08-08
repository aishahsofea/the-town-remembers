/**
 * Stable, value-free database error categories.
 *
 * Phase 0 established that redaction is structural: a secret is safe because
 * there is no field it can travel in, not because someone remembered to strip
 * it. The same rule applies here. A `DatabaseError` carries a category, a
 * SQLSTATE, and a constraint name — all of which are schema vocabulary, not
 * data — and has nowhere to put a connection string, a SQL statement, or a
 * bound parameter.
 */

export const DATABASE_ERROR_CATEGORIES = [
  "serialization_conflict",
  "unique_violation",
  "foreign_key_violation",
  "check_violation",
  "not_null_violation",
  "deadline_exceeded",
  "connection_failed",
  "ambiguous_commit",
  "unknown",
] as const;

export type DatabaseErrorCategory = (typeof DATABASE_ERROR_CATEGORIES)[number];

/** CockroachDB returns this for a transaction that must be retried whole. */
export const SERIALIZATION_FAILURE = "40001";

const CATEGORY_BY_SQLSTATE: Readonly<Record<string, DatabaseErrorCategory>> =
  Object.freeze({
    "40001": "serialization_conflict",
    "23505": "unique_violation",
    "23503": "foreign_key_violation",
    "23514": "check_violation",
    "23502": "not_null_violation",
    "57014": "deadline_exceeded",
    "08000": "connection_failed",
    "08003": "connection_failed",
    "08006": "connection_failed",
    "08001": "connection_failed",
    "08004": "connection_failed",
  });

export function categorize(sqlState: string | undefined): DatabaseErrorCategory {
  if (sqlState === undefined) return "unknown";
  return CATEGORY_BY_SQLSTATE[sqlState] ?? "unknown";
}

export class DatabaseError extends Error {
  readonly category: DatabaseErrorCategory;
  readonly sqlState: string | undefined;
  readonly constraintName: string | undefined;

  constructor(
    category: DatabaseErrorCategory,
    options: {
      readonly sqlState?: string | undefined;
      readonly constraintName?: string | undefined;
    } = {},
  ) {
    // The message is the category and, at most, a constraint name. Both are
    // written in this repository; neither can contain user or secret data.
    const suffix = options.constraintName ? ` (${options.constraintName})` : "";
    super(`Database operation failed: ${category}${suffix}`);
    this.name = "DatabaseError";
    this.category = category;
    this.sqlState = options.sqlState;
    this.constraintName = options.constraintName;
  }
}

/** Wraps a driver error, keeping only the fields that are safe to surface. */
export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const detail = error as { code?: string; constraint?: string };
  return new DatabaseError(categorize(detail.code), {
    sqlState: detail.code,
    constraintName: detail.constraint,
  });
}

export function isSerializationConflict(error: unknown): boolean {
  return (error as { code?: string }).code === SERIALIZATION_FAILURE;
}
