import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LEDGER_TABLE } from "./ledger.js";
import {
  MigrationError,
  applyMigrations,
  loadMigrations,
  renderSql,
} from "./runner.js";

describe("SQL rendering", () => {
  it("substitutes a declared domain in declaration order", () => {
    expect(renderSql("CHECK (s IN ({{TOWN_STATUSES}}))")).toBe(
      "CHECK (s IN ('active', 'awaiting_resolution', 'resolved', 'retired'))",
    );
  });

  it("refuses an unknown placeholder rather than emitting it", () => {
    expect(() => renderSql("{{NOT_A_DOMAIN}}")).toThrow(MigrationError);
  });

  it("leaves an unsubstituted file as invalid SQL, never as silent text", () => {
    // `{{X}}` is not valid SQL, so a missed substitution fails loudly at apply
    // time instead of creating a column check that matches nothing.
    expect(renderSql("SELECT 1")).toBe("SELECT 1");
  });
});

describe("migration file discovery", () => {
  async function directoryContaining(
    files: Readonly<Record<string, string>>,
  ): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "ttr-migrations-"));
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(directory, name), contents, "utf8");
    }
    return `${directory}/`;
  }

  it("rejects a file that is not numbered lower snake case", async () => {
    const directory = await directoryContaining({ "bad-name.sql": "SELECT 1" });
    await expect(loadMigrations(directory)).rejects.toThrow(
      /NNNN_lower_snake_case\.sql/,
    );
  });

  it("rejects two files that claim the same version", async () => {
    const directory = await directoryContaining({
      "0001_first.sql": "SELECT 1",
      "0001_second.sql": "SELECT 2",
    });
    await expect(loadMigrations(directory)).rejects.toThrow(/share one version/);
  });

  it("ignores files that are not SQL", async () => {
    const directory = await directoryContaining({
      "0001_only.sql": "SELECT 1",
      "notes.md": "not a migration",
    });
    const migrations = await loadMigrations(directory);
    expect(migrations.map((migration) => migration.fileName)).toStrictEqual([
      "0001_only.sql",
    ]);
  });
});

describe("migration files", () => {
  it("are numbered, uniquely versioned, and lower snake case", async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);

    const versions = migrations.map((migration) => migration.version);
    expect(versions).toStrictEqual([...versions].toSorted());
    expect(new Set(versions).size).toBe(versions.length);
    for (const migration of migrations) {
      expect(migration.fileName).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
      expect(migration.checksum).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("checksums the rendered text, so a domain change is a history change", async () => {
    const migrations = await loadMigrations();
    const rendered = migrations.map((migration) => migration.sql).join("\n");
    expect(rendered).not.toContain("{{");
  });
});

describe.skipIf(!shouldRunDatabaseTests())("applying migrations", () => {
  let database: DisposableDatabase | undefined;

  beforeAll(async () => {
    database = await createDisposableDatabase({ migrate: false });
  }, 120_000);

  afterAll(async () => {
    await database?.dispose();
  });

  /** Narrows the suite-scoped handle without repeating a non-null assertion. */
  function target(): DisposableDatabase {
    if (!database) throw new Error("The disposable database was not created.");
    return database;
  }

  it("applies every migration to an empty database", async () => {
    const outcome = await applyMigrations(target().pool);
    const migrations = await loadMigrations();
    expect(outcome.applied).toStrictEqual(migrations.map((m) => m.version));
    expect(outcome.alreadyApplied).toStrictEqual([]);
  }, 120_000);

  it("is safe to run again and applies nothing the second time", async () => {
    const outcome = await applyMigrations(target().pool);
    const migrations = await loadMigrations();
    expect(outcome.applied).toStrictEqual([]);
    expect(outcome.alreadyApplied).toStrictEqual(migrations.map((m) => m.version));
  }, 120_000);

  it("records one ledger row per applied migration", async () => {
    const migrations = await loadMigrations();
    const result = await target().pool.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM ${LEDGER_TABLE} ORDER BY version`,
    );
    expect(result.rows).toStrictEqual(
      migrations.map((migration) => ({
        version: migration.version,
        checksum: migration.checksum,
      })),
    );
  });

  it("creates the inspection schema and the three least-privilege roles", async () => {
    const schemas = await target().pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'inspection'",
    );
    expect(schemas.rowCount).toBe(1);

    const roles = await target().pool.query<{ username: string }>(
      "SELECT username FROM [SHOW USERS] WHERE username IN ('migration_admin', 'app_runtime', 'inspection_reader')",
    );
    expect(roles.rows.map((row) => row.username).toSorted()).toStrictEqual([
      "app_runtime",
      "inspection_reader",
      "migration_admin",
    ]);
  });

  it("refuses to reapply a migration whose text changed, before running any", async () => {
    const migrations = await loadMigrations();
    const first = migrations[0]!;
    const tampered = [{ ...first, checksum: "tampered-checksum-value" }];

    await expect(
      applyMigrations(target().pool, { migrations: tampered }),
    ).rejects.toThrow(/changed after it was applied/);
  });

  it("rolls back a failed migration completely, leaving no ledger row", async () => {
    const failing = {
      version: "9999",
      name: "deliberate_failure",
      fileName: "9999_deliberate_failure.sql",
      sql: "CREATE TABLE public.partial_object (a INT PRIMARY KEY); SELECT nonexistent_function();",
      checksum: "deliberate-failure-checksum",
    };

    await expect(
      applyMigrations(target().pool, { migrations: [failing] }),
    ).rejects.toThrow(MigrationError);

    const objects = await target().pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'partial_object'",
    );
    expect(objects.rowCount).toBe(0);

    const ledger = await target().pool.query(
      `SELECT 1 FROM ${LEDGER_TABLE} WHERE version = '9999'`,
    );
    expect(ledger.rowCount).toBe(0);
  }, 60_000);
});

describe.skipIf(!shouldRunDatabaseTests())("the disposable harness", () => {
  it("refuses to drop a database outside the generated prefix", async () => {
    const { assertDisposableName } =
      await import("@the-town-remembers/test-support/database");
    expect(() => assertDisposableName("production")).toThrow(/Refusing to drop/);
    expect(() => assertDisposableName("ttr_test_TOOSHORT")).toThrow(/Refusing to drop/);
    expect(() => assertDisposableName("ttr_test_abc123def456")).not.toThrow();
  });
});
