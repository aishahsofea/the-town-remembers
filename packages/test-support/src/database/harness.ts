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
 * `packages/database-admin/migrations/0009_deferred_keys.sql` adds foreign
 * keys whose two sides are genuinely cyclic in the accepted domain model
 * (its own header comment names the pattern: "visits reference the action
 * that opened them ... [and] most domain rows reference the event that
 * caused them", while the inverse side -- the action's visit, the event's
 * causing row -- is an ordinary inline foreign key the other way). Several
 * of those columns are `NOT NULL` (`player_visits.started_by_action_id`,
 * `case_attempts.event_id`, ...), so no linear `DELETE` order can satisfy
 * both directions at once, and CockroachDB has no `DEFERRABLE INITIALLY
 * DEFERRED` support to defer the check to commit time (confirmed against a
 * live node: `at or near "deferred": syntax error: unimplemented`).
 *
 * The suite-owned database `useSharedTestDatabase()` resets is disposable --
 * `scripts/vitest-database-setup.mjs`'s globalSetup drops it wholesale once
 * the whole project run finishes -- so there is nothing to preserve about
 * these specific constraints for the lifetime of that one database. Dropping
 * them once, right after migrating (`dropDeferredKeyConstraints`), turns the
 * remaining foreign-key graph into a genuine DAG and makes a single linear
 * delete order possible. No shared-migrated test file asserts behavior of
 * these particular constraints (grep confirms it); anything that does exists
 * as an `isolated-schema` file with its own, fully-migrated database.
 */
export const DEFERRED_KEY_CONSTRAINTS = Object.freeze([
  { table: "towns", constraint: "fk_towns__winning_case_attempt" },
  { table: "towns", constraint: "fk_towns__resolution_owner" },
  { table: "join_requests", constraint: "fk_join_requests__initial_visit" },
  { table: "player_visits", constraint: "fk_player_visits__started_by_action" },
  { table: "player_visits", constraint: "fk_player_visits__ended_by_action" },
  { table: "claim_drafts", constraint: "fk_claim_drafts__normalization_action" },
  { table: "claim_drafts", constraint: "fk_claim_drafts__confirmed_by_action" },
  { table: "npc_interactions", constraint: "fk_npc_interactions__player_action" },
  { table: "npc_interactions", constraint: "fk_npc_interactions__event" },
  { table: "episodes", constraint: "fk_episodes__event" },
  { table: "claim_transmissions", constraint: "fk_claim_transmissions__event" },
  { table: "items", constraint: "fk_items__revealed_event" },
  { table: "player_capabilities", constraint: "fk_player_capabilities__granted_event" },
  { table: "player_capabilities", constraint: "fk_player_capabilities__revoked_event" },
  { table: "clue_discoveries", constraint: "fk_clue_discoveries__event" },
  { table: "npc_beliefs", constraint: "fk_npc_beliefs__updated_event" },
  { table: "belief_evidence", constraint: "fk_belief_evidence__event" },
  {
    table: "npc_player_relationships",
    constraint: "fk_npc_player_relationships__updated_event",
  },
  { table: "relationship_changes", constraint: "fk_relationship_changes__event" },
  { table: "relationship_changes", constraint: "fk_relationship_changes__promise" },
  { table: "promises", constraint: "fk_promises__accepted_event" },
  { table: "promises", constraint: "fk_promises__resolved_event" },
  { table: "case_board_entries", constraint: "fk_case_board_entries__source_event" },
  { table: "case_attempts", constraint: "fk_case_attempts__player_action" },
  { table: "case_attempts", constraint: "fk_case_attempts__event" },
  { table: "town_resolutions", constraint: "fk_town_resolutions__event" },
  { table: "world_events", constraint: "fk_world_events__ambient_execution" },
  { table: "agent_runs", constraint: "fk_agent_runs__ambient_execution" },
  {
    table: "model_cost_reservations",
    constraint: "fk_model_cost_reservations__ambient_execution",
  },
]);

/**
 * Drops the cyclic foreign keys named above. Called exactly once per suite
 * run, by globalSetup, right after migrating the one disposable database
 * `useSharedTestDatabase()` shares -- never against a caller-chosen name,
 * for the same reason every other destructive statement in this file is
 * name-validated.
 */
export async function dropDeferredKeyConstraints(pool: Pool): Promise<void> {
  const statements = DEFERRED_KEY_CONSTRAINTS.map(
    ({ table, constraint }) =>
      `ALTER TABLE public.${table} DROP CONSTRAINT ${constraint};`,
  ).join("\n");
  await pool.query(statements);
}

/**
 * Every table a `shared-migrated` test file (`VPR-06`) can write to, in
 * dependency order -- a table appears before every table its own foreign
 * keys reference, so deleting top-to-bottom never hits a live reference. The
 * order is a topological sort of the real foreign-key graph parsed from
 * `packages/database-admin/migrations/*.sql`, **excluding** the cyclic edges
 * `dropDeferredKeyConstraints` removes above -- with those gone the
 * remaining graph is a genuine DAG
 * (`scripts/shared-database-tables.test.mjs` guards the *set* against drift
 * from a future migration; the *order* here was computed once from that same
 * graph and is reviewed, not discovered at runtime -- a `DELETE` built from a
 * name an attacker or a misconfigured caller controls is exactly the
 * "destructive statement against an unvalidated name" `VPR-07` rules out).
 * No role or grant tables are listed: shared-migrated files never create
 * roles (only the isolated `grants.test.ts`, which keeps its own disposable
 * database, does).
 *
 * `TRUNCATE` was the first attempt (see git history) and is measurably
 * faster on an empty table, but CockroachDB implements it as a schema
 * change: each call creates a new table descriptor and asynchronously drops
 * the old one, and a second `TRUNCATE` on the same table before that drop
 * finishes fails with "cannot perform TRUNCATE ... which has indexes being
 * dropped". Across dozens of shared-migrated files run back to back, that
 * race was reproducible in a real `pnpm test` run (not in smaller manual
 * checks) and took down unrelated files with it. Dependency-ordered `DELETE`
 * has no such window -- it is ordinary DML, not a schema change -- and
 * measured about 90x faster than `TRUNCATE` besides.
 */
export const SHARED_DATABASE_MUTABLE_TABLES = Object.freeze([
  "ambient_job_executions",
  "api_rate_limits",
  "belief_evidence",
  "case_board_entries",
  "case_solutions",
  "claim_drafts",
  "claim_relations",
  "clue_claim_effects",
  "clue_discoveries",
  "episode_references",
  "model_cost_reservations",
  "agent_runs",
  "npc_beliefs",
  "npc_contact_edges",
  "npc_player_relationships",
  "outbox",
  "player_capabilities",
  "player_sessions",
  "join_requests",
  "relationship_changes",
  "claim_transmissions",
  "episodes",
  "npc_interactions",
  "town_creation_requests",
  "town_resolutions",
  "case_attempts",
  "world_events",
  "clues",
  "inspectables",
  "player_actions",
  "player_visits",
  "promises",
  "items",
  "npcs",
  "players",
  "actors",
  "world_facts",
  "claims",
  "story_entities",
  "towns",
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
  const statements = SHARED_DATABASE_MUTABLE_TABLES.map(
    (table) => `DELETE FROM public.${table};`,
  ).join("\n");
  await pool.query(statements);
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
