/**
 * Disposable CockroachDB databases for the integration suite.
 *
 * Phase 1 accepts nothing less than real CockroachDB: the schema promises
 * composite foreign keys, partial unique indexes, vector indexes, grants, and
 * serialization retries, none of which a mock can refute. Each test file
 * therefore gets its own database, migrated from empty, and drops it again.
 *
 * Teardown validates the target name before issuing `DROP DATABASE`. The
 * generated prefix is the only thing standing between a mistaken configuration
 * and someone's real database, so it is checked rather than trusted.
 */

import { applyMigrations } from "@the-town-remembers/database-admin";
import { loadTestConfig } from "@the-town-remembers/runtime-config/test";
import { Pool } from "pg";

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
