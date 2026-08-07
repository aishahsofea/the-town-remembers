import { describe, expect, it } from "vitest";

import { createOperatorPool } from "./operator-client.js";

const CREDENTIAL = "postgresql://migration_admin:x@127.0.0.1:26257/defaultdb";

describe("the operator pool", () => {
  it("stays tiny, because one command runs one migration", async () => {
    const pool = createOperatorPool({}, { connectionString: CREDENTIAL });
    try {
      expect(pool.options.max).toBe(1);
      expect(pool.options.application_name).toBe("ttr-migrate");
    } finally {
      await pool.end();
    }
  });

  it("reads the operator category when no credential is supplied directly", async () => {
    const pool = createOperatorPool({ TTR_MIGRATION_DATABASE_URL: CREDENTIAL });
    try {
      expect(pool.options.connectionString).toBe(CREDENTIAL);
    } finally {
      await pool.end();
    }
  });

  it("fails closed rather than connecting to a default target", () => {
    expect(() => createOperatorPool({})).toThrow(
      /TTR_MIGRATION_DATABASE_URL \(missing\)/,
    );
  });

  it("labels a harness connection so a stray session is identifiable", async () => {
    const pool = createOperatorPool(
      {},
      { connectionString: CREDENTIAL, applicationName: "ttr-harness" },
    );
    try {
      expect(pool.options.application_name).toBe("ttr-harness");
    } finally {
      await pool.end();
    }
  });
});
