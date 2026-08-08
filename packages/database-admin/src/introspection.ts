/**
 * Reads the migrated schema back out of the catalog.
 *
 * The audit compares this against a committed snapshot, so the reading must be
 * deterministic and free of anything that varies between databases. Two things
 * are normalized for that reason: index definitions embed the database name,
 * which differs for every disposable target, and CockroachDB materializes a
 * numbered `_not_null` check for every NOT NULL column, which duplicates
 * information the column list already carries and whose names contain internal
 * table IDs.
 *
 * Constraint definitions come from `pg_get_constraintdef` rather than
 * `information_schema`, because it renders the full foreign key — its columns,
 * its target's columns, and its delete rule — in one stable string. Assembling
 * the same thing from `key_column_usage` would depend on row ordering the
 * catalog does not promise.
 */

import type { Pool } from "pg";

export interface ColumnSnapshot {
  readonly type: string;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly generated: string | null;
}

export interface TableSnapshot {
  readonly columns: Readonly<Record<string, ColumnSnapshot>>;
  readonly constraints: Readonly<Record<string, string>>;
  readonly indexes: Readonly<Record<string, string>>;
}

export interface SchemaSnapshot {
  readonly tables: Readonly<Record<string, TableSnapshot>>;
  readonly views: readonly string[];
  /** View columns, so the read-only types can be generated from the catalog. */
  readonly viewColumns: Readonly<
    Record<string, Readonly<Record<string, ColumnSnapshot>>>
  >;
}

/** CockroachDB names these after internal table IDs, so they are never stable. */
const GENERATED_NOT_NULL = /^\d+_\d+_\d+_not_null$/;

function sortedEntries<T>(
  entries: readonly (readonly [string, T])[],
): Record<string, T> {
  return Object.fromEntries(
    [...entries].toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

/** Strips the database qualifier so a snapshot is comparable across targets. */
export function normalizeIndexDefinition(definition: string, database: string): string {
  return definition.replaceAll(`${database}.public.`, "public.");
}

export async function readSchemaSnapshot(pool: Pool): Promise<SchemaSnapshot> {
  const databaseResult = await pool.query<{ current_database: string }>(
    "SELECT current_database()",
  );
  const database = databaseResult.rows[0]?.current_database ?? "";

  const columns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
    generation_expression: string | null;
  }>(`
    SELECT table_name, column_name, data_type, is_nullable, column_default,
           generation_expression
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, column_name
  `);

  const constraints = await pool.query<{
    table_name: string;
    constraint_name: string;
    definition: string;
  }>(`
    SELECT t.relname AS table_name,
           c.conname AS constraint_name,
           pg_get_constraintdef(c.oid) AS definition
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY t.relname, c.conname
  `);

  const indexes = await pool.query<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>(`
    SELECT tablename, indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname
  `);

  const views = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.views
     WHERE table_schema = 'inspection'
     ORDER BY table_name
  `);

  const viewColumnRows = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(`
    SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'inspection'
     ORDER BY table_name, column_name
  `);

  const tableNames = new Set(columns.rows.map((row) => row.table_name));
  const tables = sortedEntries(
    [...tableNames].map((tableName): [string, TableSnapshot] => [
      tableName,
      {
        columns: sortedEntries(
          columns.rows
            .filter((row) => row.table_name === tableName)
            .map((row): [string, ColumnSnapshot] => [
              row.column_name,
              {
                type: row.data_type,
                nullable: row.is_nullable === "YES",
                default: row.column_default,
                generated: row.generation_expression,
              },
            ]),
        ),
        constraints: sortedEntries(
          constraints.rows
            .filter(
              (row) =>
                row.table_name === tableName &&
                !GENERATED_NOT_NULL.test(row.constraint_name),
            )
            .map((row): [string, string] => [row.constraint_name, row.definition]),
        ),
        indexes: sortedEntries(
          indexes.rows
            .filter((row) => row.tablename === tableName)
            .map((row): [string, string] => [
              row.indexname,
              normalizeIndexDefinition(row.indexdef, database),
            ]),
        ),
      },
    ]),
  );

  const viewColumns = sortedEntries(
    views.rows.map((view): [string, Record<string, ColumnSnapshot>] => [
      view.table_name,
      sortedEntries(
        viewColumnRows.rows
          .filter((row) => row.table_name === view.table_name)
          .map((row): [string, ColumnSnapshot] => [
            row.column_name,
            {
              type: row.data_type,
              nullable: row.is_nullable === "YES",
              default: null,
              generated: null,
            },
          ]),
      ),
    ]),
  );

  return {
    tables,
    views: views.rows.map((row) => row.table_name),
    viewColumns,
  };
}

/**
 * Foreign keys between town-owned rows must carry `town_id` on both sides.
 * Returns the offending constraints so a failure names them.
 */
export function findForeignKeysMissingTownScope(
  snapshot: SchemaSnapshot,
  globalTables: readonly string[],
): readonly string[] {
  const offenders: string[] = [];
  for (const [tableName, table] of Object.entries(snapshot.tables)) {
    for (const [name, definition] of Object.entries(table.constraints)) {
      if (!definition.startsWith("FOREIGN KEY")) continue;

      const parsed = /^FOREIGN KEY \(([^)]+)\) REFERENCES ([a-z_]+)\(([^)]+)\)/.exec(
        definition,
      );
      if (!parsed) {
        offenders.push(`${tableName}.${name} (unparsed: ${definition})`);
        continue;
      }
      const [, ownColumns = "", targetTable = "", targetColumns = ""] = parsed;
      if (globalTables.includes(tableName) || globalTables.includes(targetTable)) {
        continue;
      }

      const own = ownColumns.split(", ")[0];
      const target = targetColumns.split(", ")[0];
      // `towns` is keyed by `id`, so a reference to it is town-scoped when the
      // referring side leads with `town_id` or is the town's own `id`.
      const ownScoped = own === "town_id" || (tableName === "towns" && own === "id");
      const targetScoped = target === "town_id" || targetTable === "towns";
      if (!ownScoped || !targetScoped) offenders.push(`${tableName}.${name}`);
    }
  }
  return offenders;
}
