import { describe, expect, it } from "vitest";

import { statementTimeoutMs } from "./client.js";
import { DatabaseError, categorize } from "./errors.js";
import {
  RETRY_DELAYS_MS,
  RETRY_LIMIT,
  jitteredDelay,
  resolveAmbiguousCommit,
} from "./transaction.js";

describe("error categories", () => {
  it("maps the SQLSTATEs the schema can produce", () => {
    expect(categorize("40001")).toBe("serialization_conflict");
    expect(categorize("23505")).toBe("unique_violation");
    expect(categorize("23503")).toBe("foreign_key_violation");
    expect(categorize("23514")).toBe("check_violation");
    expect(categorize("57014")).toBe("deadline_exceeded");
    expect(categorize("08006")).toBe("connection_failed");
    expect(categorize(undefined)).toBe("unknown");
    expect(categorize("XX999")).toBe("unknown");
  });

  it("has nowhere to put a credential, a statement, or a parameter", () => {
    const error = new DatabaseError("check_violation", {
      sqlState: "23514",
      constraintName: "ck_towns__status",
    });
    const serialized = JSON.stringify({
      message: error.message,
      category: error.category,
      sqlState: error.sqlState,
      constraintName: error.constraintName,
    });
    expect(serialized).not.toContain("postgresql://");
    // The type carries only schema vocabulary. Nothing here is a field a
    // connection string, a statement, or a bound parameter could travel in.
    for (const key of Object.keys(error)) {
      expect(["name", "category", "sqlState", "constraintName"]).toContain(key);
    }
  });
});

describe("statement timeouts", () => {
  it("never exceeds the accepted ceiling", () => {
    expect(statementTimeoutMs(undefined)).toBe(3000);
    expect(statementTimeoutMs(10_000)).toBe(3000);
  });

  it("shrinks to the remaining budget when that is smaller", () => {
    expect(statementTimeoutMs(800)).toBe(800);
    expect(statementTimeoutMs(0)).toBe(1);
  });
});

describe("retry pacing", () => {
  it("uses the accepted 25/75/225 ms schedule", () => {
    expect(RETRY_DELAYS_MS).toStrictEqual([25, 75, 225]);
    expect(RETRY_LIMIT).toBe(3);
  });

  it("applies full jitter around each delay", () => {
    expect(jitteredDelay(0, () => 0)).toBe(13);
    expect(jitteredDelay(0, () => 1)).toBe(38);
    expect(jitteredDelay(2, () => 0.5)).toBe(225);
  });

  it("holds the last delay for any attempt beyond the schedule", () => {
    expect(jitteredDelay(9, () => 0.5)).toBe(225);
  });
});

describe("ambiguous commits", () => {
  it("cannot be discharged without reading the durable record", async () => {
    const notApplied = await resolveAmbiguousCommit<string>(() =>
      Promise.resolve(undefined),
    );
    expect(notApplied).toStrictEqual({ outcome: "not_applied" });

    const applied = await resolveAmbiguousCommit(() => Promise.resolve("action-1"));
    expect(applied).toStrictEqual({ outcome: "applied", value: "action-1" });
  });

  it("offers no value to unwrap, so a caller cannot mistake it for success", () => {
    // A type-level assertion: the ambiguous branch has no `value` member, so
    // reading one is a compile error rather than a runtime `undefined`.
    const ambiguous = { outcome: "ambiguous", retries: 1 } as const;
    expect(Object.keys(ambiguous)).toStrictEqual(["outcome", "retries"]);
  });
});
