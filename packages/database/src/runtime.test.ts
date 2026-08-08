import { describe, expect, it, vi } from "vitest";

import { createRuntimePool } from "./client.js";
import { sqlClaimEntityMatrix } from "./domains.js";
import { DatabaseError, isSerializationConflict, toDatabaseError } from "./errors.js";
import { runSerializable } from "./transaction.js";

/**
 * A pool that answers with scripted results.
 *
 * The retry, deadline, and ambiguous-commit branches are timing and failure
 * behavior, not SQL behavior, so they are driven here with injected clocks and
 * scripted errors. The real-engine proof that a genuine 40001 is retried lives
 * beside the migrations, where a disposable database is available.
 */
function scriptedPool(script: (sql: string, attempt: number) => unknown) {
  let attempt = -1;
  const released: number[] = [];
  const pool = {
    connect: () =>
      Promise.resolve({
        query: (sql: string) => {
          if (sql === "BEGIN") attempt += 1;
          const outcome = script(sql, attempt);
          return outcome instanceof Error
            ? Promise.reject(outcome)
            : Promise.resolve({ rows: [] });
        },
        release: () => released.push(attempt),
      }),
  };
  return { pool: pool as never, released };
}

function failWith(code: string): Error & { code: string } {
  return Object.assign(new Error("scripted"), { code });
}

describe("the runtime pool", () => {
  it("binds every accepted limit", async () => {
    const pool = createRuntimePool(
      {},
      {
        connectionString:
          "postgresql://app_runtime@127.0.0.1:26257/town?sslmode=disable",
      },
    );
    try {
      expect(pool.options.max).toBe(2);
      expect(pool.options.connectionTimeoutMillis).toBe(3000);
      expect(pool.options.statement_timeout).toBe(3000);
      expect(pool.options.idle_in_transaction_session_timeout).toBe(5000);
      expect(pool.options.application_name).toBe("ttr-runtime");
    } finally {
      await pool.end();
    }
  });

  it("shrinks the statement timeout to the remaining request budget", async () => {
    const pool = createRuntimePool(
      {},
      {
        connectionString:
          "postgresql://app_runtime@127.0.0.1:26257/town?sslmode=disable",
        remainingBudgetMs: 900,
      },
    );
    try {
      expect(pool.options.statement_timeout).toBe(900);
    } finally {
      await pool.end();
    }
  });

  it("reads the runtime category when no credential is supplied directly", async () => {
    const pool = createRuntimePool({
      TTR_ENV: "local",
      TTR_DATABASE_URL: "postgresql://root@127.0.0.1:26257/town?sslmode=disable",
    });
    try {
      expect(pool.options.connectionString).toContain("127.0.0.1:26257");
    } finally {
      await pool.end();
    }
  });

  it("fails closed rather than connecting to a default target", () => {
    expect(() => createRuntimePool({ TTR_ENV: "production" })).toThrow(
      /TTR_DATABASE_URL/,
    );
  });
});

describe("driver error translation", () => {
  it("keeps the constraint name and drops everything else", () => {
    const translated = toDatabaseError(
      Object.assign(new Error("insert violates ... on table towns"), {
        code: "23505",
        constraint: "uq_towns__invite_token_hash",
        detail: "Key (invite_token_hash)=(\\x0102) already exists.",
      }),
    );
    expect(translated).toBeInstanceOf(DatabaseError);
    expect(translated.category).toBe("unique_violation");
    expect(translated.constraintName).toBe("uq_towns__invite_token_hash");
    // The driver's detail carries the offending value; ours cannot.
    expect(JSON.stringify(translated)).not.toContain("0102");
  });

  it("passes an already-translated error through unchanged", () => {
    const original = new DatabaseError("deadline_exceeded");
    expect(toDatabaseError(original)).toBe(original);
  });

  it("categorizes an unrecognized failure rather than guessing", () => {
    expect(toDatabaseError(new Error("socket hang up")).category).toBe("unknown");
  });

  it("recognizes the serialization SQLSTATE and nothing else", () => {
    expect(isSerializationConflict(failWith("40001"))).toBe(true);
    expect(isSerializationConflict(failWith("23505"))).toBe(false);
    expect(isSerializationConflict(new Error("no code"))).toBe(false);
  });
});

describe("serializable retry behavior", () => {
  const sleep = vi.fn(() => Promise.resolve());

  it("uses the accepted delays in order, jittered by the injected source", async () => {
    sleep.mockClear();
    const delays: number[] = [];
    const { pool } = scriptedPool((sql, attempt) =>
      sql === "COMMIT" && attempt < 3 ? failWith("40001") : undefined,
    );

    const result = await runSerializable(
      pool,
      {
        deadlineAt: Date.now() + 60_000,
        random: () => 0.5,
        sleep: (ms) => {
          delays.push(ms);
          return sleep();
        },
      },
      (tx) => tx.query("SELECT 1"),
    );

    expect(result.outcome).toBe("committed");
    expect(result.outcome === "committed" && result.retries).toBe(3);
    expect(delays).toStrictEqual([25, 75, 225]);
  });

  it("gives up after three retries rather than looping", async () => {
    const { pool } = scriptedPool((sql) =>
      sql === "COMMIT" ? failWith("40001") : undefined,
    );
    await expect(
      runSerializable(
        pool,
        { deadlineAt: Date.now() + 60_000, random: () => 0.5, sleep: () => sleep() },
        (tx) => tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "serialization_conflict" });
  });

  it("stops when the next delay would cross the deadline", async () => {
    const { pool } = scriptedPool((sql) =>
      sql === "COMMIT" ? failWith("40001") : undefined,
    );
    const start = Date.now();
    await expect(
      runSerializable(
        pool,
        {
          // Room for one attempt, but not for the 25 ms pause after it.
          deadlineAt: start + 10,
          now: () => start,
          random: () => 0.5,
          sleep: () => sleep(),
        },
        (tx) => tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "deadline_exceeded" });
  });

  it("does not retry a failure that is not a serialization conflict", async () => {
    let attempts = 0;
    const { pool } = scriptedPool((sql) => {
      if (sql === "BEGIN") attempts += 1;
      return sql === "COMMIT" ? failWith("23514") : undefined;
    });

    await expect(
      runSerializable(pool, { deadlineAt: Date.now() + 60_000 }, (tx) =>
        tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "check_violation" });
    expect(attempts).toBe(1);
  });

  it("reports an ambiguous commit instead of retrying it", async () => {
    // A connection failure raised by COMMIT itself leaves the outcome unknown:
    // the server may have committed before the socket died.
    const { pool } = scriptedPool((sql) =>
      sql === "COMMIT" ? failWith("08006") : undefined,
    );
    const result = await runSerializable(
      pool,
      { deadlineAt: Date.now() + 60_000 },
      (tx) => tx.query("SELECT 1"),
    );
    expect(result).toStrictEqual({ outcome: "ambiguous", retries: 0 });
  });

  it("treats a failure before COMMIT as a definite rollback, not ambiguity", async () => {
    const { pool } = scriptedPool((sql) =>
      sql.startsWith("SELECT") ? failWith("08006") : undefined,
    );
    await expect(
      runSerializable(pool, { deadlineAt: Date.now() + 60_000 }, (tx) =>
        tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "connection_failed" });
  });

  it("releases its connection on every path", async () => {
    const { pool, released } = scriptedPool((sql) =>
      sql === "COMMIT" ? failWith("23514") : undefined,
    );
    await expect(
      runSerializable(pool, { deadlineAt: Date.now() + 60_000 }, (tx) =>
        tx.query("SELECT 1"),
      ),
    ).rejects.toThrow();
    expect(released).toHaveLength(1);
  });

  it("survives a rollback that itself fails on a dead connection", async () => {
    const { pool } = scriptedPool((sql) =>
      sql === "COMMIT" || sql === "ROLLBACK" ? failWith("23514") : undefined,
    );
    await expect(
      runSerializable(pool, { deadlineAt: Date.now() + 60_000 }, (tx) =>
        tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "check_violation" });
  });

  it("refuses to start once the deadline has already passed", async () => {
    const { pool } = scriptedPool(() => undefined);
    await expect(
      runSerializable(pool, { deadlineAt: Date.now() - 1 }, (tx) =>
        tx.query("SELECT 1"),
      ),
    ).rejects.toMatchObject({ category: "deadline_exceeded" });
  });
});

describe("rendered SQL fragments", () => {
  it("names the default claim columns", () => {
    const rendered = sqlClaimEntityMatrix();
    expect(rendered).toContain(
      "(predicate = 'was_at' AND subject_entity_type = 'character'",
    );
    expect(rendered.split("OR")).toHaveLength(5);
  });

  it("can be rendered for a table that names its columns differently", () => {
    expect(sqlClaimEntityMatrix("s_type", "p", "o_type")).toContain(
      "(p = 'is_at' AND s_type = 'item' AND o_type = 'location')",
    );
  });
});
