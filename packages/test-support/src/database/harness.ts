/**
 * Disposable CockroachDB databases for the integration suite.
 *
 * Phase 1 accepts nothing less than real CockroachDB: the schema promises
 * composite foreign keys, partial unique indexes, vector indexes, grants, and
 * serialization retries, none of which a mock can refute.
 *
 * Two lifecycles share this file (`VPR-06`, `VPR-07`):
 *   - `createDisposableDatabase()` -- a fresh database, migrated from empty
 *     and dropped again, for files whose schema/grant/concurrency behavior a
 *     shared, reset fixture cannot safely reproduce around neighboring
 *     files.
 *   - `useSharedTestDatabase()` -- the one database globalSetup already
 *     created and migrated for the whole `database` project run, with its
 *     mutable rows reset before this file's tests, for ordinary
 *     runtime-data files.
 *
 * Both validate the target name before issuing a destructive statement
 * (`DROP DATABASE`, `TRUNCATE`). The generated prefix is the only thing
 * standing between a mistaken configuration and someone's real database, so
 * it is checked rather than trusted.
 */

import { applyMigrations } from "@the-town-remembers/database-admin";
import { loadTestConfig } from "@the-town-remembers/runtime-config/test";
import { Pool } from "pg";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Set once by scripts/vitest-database-setup.mjs's globalSetup (VPR-07). */
    suiteDatabaseName?: string;
    suiteDatabaseAdminUrl?: string;
  }
}

/** Only a name this shape may be dropped. */
export const DISPOSABLE_NAME_PATTERN = /^ttr_test_[a-z0-9]{12}$/;

const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const HARNESS_POOL_SIZE = 4;

export class DisposableDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisposableDatabaseError";
  }
}

export function generateDisposableName(random: () => number = Math.random): string {
  let suffix = "";
  for (let index = 0; index < 12; index += 1) {
    suffix += NAME_ALPHABET[Math.floor(random() * NAME_ALPHABET.length)];
  }
  return `ttr_test_${suffix}`;
}

/** Rewrites the database in a DSN without touching its other components. */
export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Rewrites the user in a DSN, used to prove a role's grants and denials. */
export function withUser(connectionString: string, user: string): string {
  const url = new URL(connectionString);
  url.username = user;
  url.password = "";
  return url.toString();
}

/**
 * `true` unless a developer opted out. `pnpm validate` sets the require flag,
 * so the exit gate cannot pass on a machine that skipped the suite.
 */
export function shouldRunDatabaseTests(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const skip = environment["TTR_SKIP_DB_TESTS"] === "1";
  if (skip && environment["TTR_REQUIRE_DB_TESTS"] === "1") {
    throw new DisposableDatabaseError(
      "TTR_SKIP_DB_TESTS is set while the database suite is required.",
    );
  }
  return !skip;
}

export interface DisposableDatabase {
  readonly name: string;
  /** Administrative DSN pointing at the disposable database. */
  readonly url: string;
  /** Pool for the administrative identity. */
  readonly pool: Pool;
  /** Opens a pool for another role against the same disposable database. */
  poolFor(user: string): Pool;
  dispose(): Promise<void>;
}

export interface DisposableDatabaseOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly migrate?: boolean;
}

export async function createDisposableDatabase(
  options: DisposableDatabaseOptions = {},
): Promise<DisposableDatabase> {
  const config = loadTestConfig(options.environment ?? process.env);
  const name = generateDisposableName();
  const serverPool = new Pool({ connectionString: config.testDatabaseUrl, max: 1 });

  try {
    await serverPool.query(`CREATE DATABASE ${name}`);
  } finally {
    await serverPool.end();
  }

  const url = withDatabase(config.testDatabaseUrl, name);
  const pool = new Pool({ connectionString: url, max: HARNESS_POOL_SIZE });
  const rolePools: Pool[] = [];

  if (options.migrate !== false) {
    await applyMigrations(pool);
  }

  return {
    name,
    url,
    pool,
    poolFor(user: string): Pool {
      const rolePool = new Pool({
        connectionString: withUser(url, user),
        max: 1,
      });
      rolePools.push(rolePool);
      return rolePool;
    },
    async dispose(): Promise<void> {
      assertDisposableName(name);
      await Promise.all(rolePools.map((rolePool) => rolePool.end()));
      await pool.end();

      const cleanupPool = new Pool({
        connectionString: config.testDatabaseUrl,
        max: 1,
      });
      try {
        await cleanupPool.query(`DROP DATABASE IF EXISTS ${name} CASCADE`);
      } finally {
        await cleanupPool.end();
      }
    },
  };
}

/** Guards a caller-supplied name before it can reach a DROP statement. */
export function assertDisposableName(name: string): void {
  if (!DISPOSABLE_NAME_PATTERN.test(name)) {
    throw new DisposableDatabaseError(
      `Refusing to drop "${name}": it is not a generated disposable database.`,
    );
  }
}

/**
 * Every table a `shared-migrated` test file (`VPR-06`) can write to,
 * reviewed against `packages/database-admin/migrations/*.sql` rather than
 * discovered at runtime -- a `TRUNCATE` built from a name an attacker or a
 * misconfigured caller controls is exactly the "destructive statement
 * against an unvalidated name" `VPR-07` rules out. No role or grant tables
 * are listed: shared-migrated files never create roles (only the isolated
 * `grants.test.ts`, which keeps its own disposable database, does).
 */
export const SHARED_DATABASE_MUTABLE_TABLES = Object.freeze([
  "actors",
  "agent_runs",
  "ambient_job_executions",
  "api_rate_limits",
  "belief_evidence",
  "case_attempts",
  "case_board_entries",
  "case_solutions",
  "claim_drafts",
  "claim_relations",
  "claim_transmissions",
  "claims",
  "clue_claim_effects",
  "clue_discoveries",
  "clues",
  "episode_references",
  "episodes",
  "inspectables",
  "items",
  "join_requests",
  "model_cost_reservations",
  "npc_beliefs",
  "npc_contact_edges",
  "npc_interactions",
  "npc_player_relationships",
  "npcs",
  "outbox",
  "player_actions",
  "player_capabilities",
  "player_sessions",
  "player_visits",
  "players",
  "promises",
  "relationship_changes",
  "story_entities",
  "town_creation_requests",
  "town_resolutions",
  "towns",
  "world_events",
  "world_facts",
]);

/**
 * Clears every mutable row from the shared suite database so a
 * `shared-migrated` file cannot observe rows a previous file left behind
 * (`VPR-07`). Refuses to run against anything but a generated disposable
 * database -- the same guard `dispose()` applies before a `DROP DATABASE`.
 */
export async function resetSharedDatabase(
  pool: Pool,
  databaseName: string,
): Promise<void> {
  assertDisposableName(databaseName);
  const tableList = SHARED_DATABASE_MUTABLE_TABLES.map(
    (table) => `public.${table}`,
  ).join(", ");
  await pool.query(`TRUNCATE TABLE ${tableList} CASCADE`);
}

/**
 * The `shared-migrated` counterpart to `createDisposableDatabase()`
 * (`VPR-07`): reads the one database `scripts/vitest-database-setup.mjs`'s
 * globalSetup already created and migrated for the whole `database` project
 * run, resets its mutable rows, and returns the same `DisposableDatabase`
 * shape every existing test file already expects -- so a file moves onto
 * the shared fixture by changing only its `createDisposableDatabase()`
 * call site, not its `afterAll`.
 *
 * `dispose()` here only closes this file's own pools. It deliberately never
 * drops the database: that would pull the shared fixture out from under
 * every other file still waiting to run against it. The one `DROP DATABASE`
 * happens once, in globalSetup's own teardown, after the whole project run
 * finishes.
 */
export async function useSharedTestDatabase(): Promise<DisposableDatabase> {
  const name = inject("suiteDatabaseName");
  const url = inject("suiteDatabaseAdminUrl");
  if (!name || !url) {
    throw new DisposableDatabaseError(
      "No suite-owned database was provided. useSharedTestDatabase() must run " +
        "inside the `database` vitest project, whose globalSetup creates one.",
    );
  }

  const pool = new Pool({ connectionString: url, max: HARNESS_POOL_SIZE });
  const rolePools: Pool[] = [];
  await resetSharedDatabase(pool, name);

  return {
    name,
    url,
    pool,
    poolFor(user: string): Pool {
      const rolePool = new Pool({ connectionString: withUser(url, user), max: 1 });
      rolePools.push(rolePool);
      return rolePool;
    },
    async dispose(): Promise<void> {
      await Promise.all(rolePools.map((rolePool) => rolePool.end()));
      await pool.end();
    },
  };
}
