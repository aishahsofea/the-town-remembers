/**
 * Ordered forward-only migration application.
 *
 * Two behaviors here were measured rather than assumed. CockroachDB v25.4
 * defaults `autocommit_before_ddl` to `on`, so `BEGIN; CREATE TABLE …` commits
 * the DDL immediately and a later failure leaves a half-migrated schema with no
 * ledger row. The session therefore turns that setting off before opening the
 * transaction, which makes a file and its ledger row commit or roll back
 * together.
 *
 * Migration files are templates. Closed value domains live in
 * `@the-town-remembers/database` so the SQL check and the TypeScript union
 * cannot drift, and the checksum covers the *rendered* text, so changing a
 * domain is correctly detected as a change to an applied migration rather than
 * silently altering what a past version meant.
 */

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  ACTION_KINDS,
  ACTION_OUTCOMES,
  ACTION_STATUSES,
  ACTOR_TYPES,
  AGENT_RUN_OUTCOMES,
  AGENT_RUN_PURPOSES,
  AMBIENT_EXECUTION_STATUSES,
  BOARD_ENTRY_KINDS,
  BOARD_VERIFICATION_STATUSES,
  BELIEF_LABELS,
  CAPABILITY_STATUSES,
  CASE_ATTEMPT_OUTCOMES,
  CLAIM_DRAFT_STATUSES,
  CLAIM_POLARITIES,
  CLAIM_PREDICATES,
  CLAIM_RELATION_KINDS,
  CLUE_EFFECT_KINDS,
  CLUE_KINDS,
  EMBEDDING_AGENT_RUN_PURPOSES,
  EMBEDDING_STATUSES,
  EPISODE_KINDS,
  EPISODE_REFERENCE_KINDS,
  EVENT_ORIGIN_KINDS,
  EVENT_TYPES,
  EVIDENCE_KINDS,
  INTERACTION_INPUT_KINDS,
  INTERACTION_RESPONSE_MODES,
  JOIN_REPLAY_CLOSED_REASONS,
  OUTBOX_DELIVERY_STATUSES,
  OUTBOX_JOB_TYPES,
  PROMISE_KINDS,
  PROMISE_STATUSES,
  RATE_LIMIT_BUCKET_KINDS,
  RATE_LIMIT_SCOPE_KINDS,
  RELATIONSHIP_REASON_KINDS,
  REQUEST_LEDGER_STATUSES,
  RESERVATION_STATUSES,
  RESOLUTION_CHOICES,
  SESSION_STATUSES,
  STORY_ENTITY_TYPES,
  TOWN_STATUSES,
  TRANSMISSION_SOURCE_KINDS,
  VISIT_END_REASONS,
  VISIT_STATUSES,
  WORLD_FACT_VISIBILITIES,
  sqlClaimEntityMatrix,
  sqlValueList,
} from "@the-town-remembers/database";
import { sha256Base64Url } from "@the-town-remembers/serialization";
import type { Pool, PoolClient } from "pg";

import {
  appendAppliedMigration,
  ensureLedger,
  readAppliedMigrations,
} from "./ledger.js";

export const MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

/** Closed domains, rendered into the `IN (…)` lists migrations embed. */
const DOMAIN_SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  {
    ACTION_KINDS,
    ACTION_OUTCOMES,
    ACTION_STATUSES,
    ACTOR_TYPES,
    AGENT_RUN_OUTCOMES,
    AGENT_RUN_PURPOSES,
    AMBIENT_EXECUTION_STATUSES,
    BELIEF_LABELS,
    BOARD_ENTRY_KINDS,
    BOARD_VERIFICATION_STATUSES,
    CAPABILITY_STATUSES,
    CASE_ATTEMPT_OUTCOMES,
    CLAIM_DRAFT_STATUSES,
    CLAIM_POLARITIES,
    CLAIM_PREDICATES,
    CLAIM_RELATION_KINDS,
    CLUE_EFFECT_KINDS,
    CLUE_KINDS,
    EMBEDDING_AGENT_RUN_PURPOSES,
    EMBEDDING_STATUSES,
    EPISODE_KINDS,
    EPISODE_REFERENCE_KINDS,
    EVENT_ORIGIN_KINDS,
    EVENT_TYPES,
    EVIDENCE_KINDS,
    INTERACTION_INPUT_KINDS,
    INTERACTION_RESPONSE_MODES,
    JOIN_REPLAY_CLOSED_REASONS,
    OUTBOX_DELIVERY_STATUSES,
    OUTBOX_JOB_TYPES,
    PROMISE_KINDS,
    PROMISE_STATUSES,
    RATE_LIMIT_BUCKET_KINDS,
    RATE_LIMIT_SCOPE_KINDS,
    RELATIONSHIP_REASON_KINDS,
    REQUEST_LEDGER_STATUSES,
    RESERVATION_STATUSES,
    RESOLUTION_CHOICES,
    SESSION_STATUSES,
    STORY_ENTITY_TYPES,
    TOWN_STATUSES,
    TRANSMISSION_SOURCE_KINDS,
    VISIT_END_REASONS,
    VISIT_STATUSES,
    WORLD_FACT_VISIBILITIES,
  },
);

/**
 * Every substitution a migration template may reference, as finished SQL. An
 * unknown placeholder is an error, so a renamed domain cannot leave stale SQL
 * behind, and `{{…}}` is invalid SQL, so a missed one fails at apply time
 * rather than creating a check that matches nothing.
 */
export const SQL_SUBSTITUTIONS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(DOMAIN_SUBSTITUTIONS).map(([name, values]) => [
      name,
      sqlValueList(values),
    ]),
  ),
  CLAIM_ENTITY_MATRIX: sqlClaimEntityMatrix(),
});

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;
const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {
  readonly version: string | undefined;

  constructor(message: string, version?: string) {
    super(message);
    this.name = "MigrationError";
    this.version = version;
  }
}

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly fileName: string;
  readonly sql: string;
  readonly checksum: string;
}

/** Replaces `{{NAME}}` with its rendered SQL fragment. */
export function renderSql(
  template: string,
  substitutions: Readonly<Record<string, string>> = SQL_SUBSTITUTIONS,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const fragment = substitutions[name];
    if (fragment === undefined) {
      throw new MigrationError(`Unknown SQL substitution {{${name}}}.`);
    }
    return fragment;
  });
}

export async function loadMigrations(
  directory: string = MIGRATIONS_DIRECTORY,
): Promise<readonly Migration[]> {
  const fileNames = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
  const migrations: Migration[] = [];

  for (const fileName of fileNames.toSorted()) {
    const parsed = FILE_NAME.exec(fileName);
    if (!parsed) {
      throw new MigrationError(
        `Migration file "${fileName}" must be named NNNN_lower_snake_case.sql.`,
      );
    }
    const [, version = "", name = ""] = parsed;
    const template = await readFile(`${directory}${fileName}`, "utf8");
    const sql = renderSql(template);
    migrations.push({
      version,
      name,
      fileName,
      sql,
      checksum: sha256Base64Url(sql),
    });
  }

  const versions = migrations.map((migration) => migration.version);
  if (new Set(versions).size !== versions.length) {
    throw new MigrationError("Two migration files share one version number.");
  }
  return migrations;
}

export interface MigrationOutcome {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

async function applyOne(client: PoolClient, migration: Migration): Promise<void> {
  // Measured: v25.4 auto-commits DDL inside an explicit transaction unless this
  // is off, which would leave objects behind with no ledger row.
  await client.query("SET autocommit_before_ddl = false");
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await appendAppliedMigration(client, migration);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new MigrationError(
      `Migration ${migration.fileName} failed and was rolled back: ${
        error instanceof Error ? error.message : String(error)
      }`,
      migration.version,
    );
  } finally {
    await client.query("SET autocommit_before_ddl = true");
  }
}

export async function applyMigrations(
  pool: Pool,
  options: {
    readonly migrations?: readonly Migration[];
    readonly log?: (message: string) => void;
  } = {},
): Promise<MigrationOutcome> {
  const migrations = options.migrations ?? (await loadMigrations());
  const log = options.log ?? (() => undefined);
  const client = await pool.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  try {
    await ensureLedger(client);
    const ledger = new Map(
      (await readAppliedMigrations(client)).map((row) => [row.version, row]),
    );

    // History is validated before anything runs. A run that discovered the
    // mismatch mid-loop would have already applied earlier files, so the
    // operator's next attempt would start from a different state than the one
    // they were told about.
    for (const migration of migrations) {
      const recorded = ledger.get(migration.version);
      if (recorded !== undefined && recorded.checksum !== migration.checksum) {
        throw new MigrationError(
          `Migration ${migration.fileName} changed after it was applied. ` +
            "Forward-fix with a new migration instead of editing this one.",
          migration.version,
        );
      }
    }

    for (const migration of migrations) {
      if (ledger.has(migration.version)) {
        alreadyApplied.push(migration.version);
        continue;
      }

      await applyOne(client, migration);
      applied.push(migration.version);
      log(`Applied ${migration.fileName}`);
    }
  } finally {
    client.release();
  }

  return { applied, alreadyApplied };
}
