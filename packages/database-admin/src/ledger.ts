/**
 * The applied-migration ledger.
 *
 * Migrations are forward-only. Recovery from a bad migration is another
 * migration, never a destructive reset, so the ledger's job is to make the
 * question "what has already run here?" answerable without inspecting the
 * catalog. It also records a checksum: a change to an already-applied file
 * means the database and the repository disagree about history, which must
 * stop the run rather than be silently reapplied or skipped.
 */

import type { PoolClient } from "pg";

export const LEDGER_TABLE = "public.schema_migrations";

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  version STRING NOT NULL PRIMARY KEY,
  name STRING NOT NULL,
  checksum STRING NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(CREATE_LEDGER);
}

export async function readAppliedMigrations(
  client: PoolClient,
): Promise<readonly AppliedMigration[]> {
  const result = await client.query<AppliedMigration>(
    `SELECT version, name, checksum FROM ${LEDGER_TABLE} ORDER BY version`,
  );
  return result.rows;
}

export async function appendAppliedMigration(
  client: PoolClient,
  migration: AppliedMigration,
): Promise<void> {
  await client.query(
    `INSERT INTO ${LEDGER_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`,
    [migration.version, migration.name, migration.checksum],
  );
}
