#!/usr/bin/env node

/**
 * Capability probe for the target CockroachDB.
 *
 * The accepted schema depends on features that are not universal across
 * versions or forks: 256-dimension vectors, a vector index restricted to ready
 * embeddings, composite foreign keys carrying a checked discriminator, partial
 * unique indexes, and DDL that actually rolls back. Discovering any of these
 * missing halfway through a migration would leave a half-built schema, so they
 * are proved first, against a scratch database that is dropped afterwards.
 *
 * A failure names the capability. It never prints the connection string.
 */

import process from "node:process";

import pg from "pg";

import { COCKROACH_VERSION } from "./cockroach.mjs";
import { applyLocalDefaults } from "./local-env.mjs";

const SCRATCH_PREFIX = "ttr_doctor_";
const VECTOR_LITERAL = `'[${Array.from({ length: 256 }, () => "0.5").join(",")}]'::VECTOR(256)`;

/** Each probe returns nothing on success and throws with its own name on failure. */
export const CAPABILITY_PROBES = Object.freeze([
  {
    name: "vector-column",
    detail: "VECTOR(256) episode embeddings",
    async run(client) {
      await client.query(`
        CREATE TABLE probe_episodes (
          town_id UUID NOT NULL,
          npc_id UUID NOT NULL,
          id UUID NOT NULL DEFAULT gen_random_uuid(),
          embedding VECTOR(256) NULL,
          embedding_status STRING NOT NULL,
          PRIMARY KEY (town_id, id)
        )`);
      await client.query(
        `INSERT INTO probe_episodes (town_id, npc_id, embedding, embedding_status)
         VALUES (gen_random_uuid(), gen_random_uuid(), ${VECTOR_LITERAL}, 'ready')`,
      );
    },
  },
  {
    name: "predicated-vector-index",
    detail: "vector index prefixed by town and NPC, limited to ready embeddings",
    async run(client) {
      await client.query(`
        CREATE VECTOR INDEX probe_episodes_embedding
        ON probe_episodes (town_id, npc_id, embedding)
        WHERE embedding_status = 'ready'`);
      await client.query(
        `SELECT id FROM probe_episodes
         WHERE town_id = gen_random_uuid() AND npc_id = gen_random_uuid()
           AND embedding_status = 'ready'
         ORDER BY embedding <-> ${VECTOR_LITERAL} LIMIT 30`,
      );
    },
  },
  {
    name: "discriminated-foreign-key",
    detail: "composite foreign key carrying a checked entity-type constant",
    async run(client) {
      await client.query(`
        CREATE TABLE probe_entities (
          town_id UUID NOT NULL,
          id UUID NOT NULL,
          entity_type STRING NOT NULL,
          PRIMARY KEY (town_id, id),
          UNIQUE (town_id, id, entity_type)
        )`);
      await client.query(`
        CREATE TABLE probe_solutions (
          town_id UUID PRIMARY KEY,
          culprit_entity_id UUID NOT NULL,
          culprit_entity_type STRING NOT NULL DEFAULT 'character'
            CHECK (culprit_entity_type = 'character'),
          FOREIGN KEY (town_id, culprit_entity_id, culprit_entity_type)
            REFERENCES probe_entities (town_id, id, entity_type) ON DELETE RESTRICT
        )`);
    },
  },
  {
    name: "partial-unique-index",
    detail: "at-most-one-active-row uniqueness",
    async run(client) {
      await client.query(`
        CREATE TABLE probe_visits (
          town_id UUID NOT NULL,
          id UUID NOT NULL,
          player_id UUID NOT NULL,
          status STRING NOT NULL,
          PRIMARY KEY (town_id, id)
        )`);
      await client.query(
        `CREATE UNIQUE INDEX probe_visits_active ON probe_visits (town_id, player_id)
         WHERE status = 'active'`,
      );
    },
  },
  {
    name: "transactional-ddl",
    detail: "DDL that rolls back with its transaction",
    async run(client) {
      await client.query("SET autocommit_before_ddl = false");
      await client.query("BEGIN");
      await client.query("CREATE TABLE probe_rollback (a INT PRIMARY KEY)");
      await client.query("ROLLBACK");
      await client.query("SET autocommit_before_ddl = true");

      const result = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'probe_rollback'",
      );
      if (result.rowCount !== 0) {
        throw new Error("a rolled-back CREATE TABLE survived the transaction");
      }
    },
  },
]);

export function scratchDatabaseName(random = Math.random) {
  return `${SCRATCH_PREFIX}${Math.floor(random() * 1e12).toString(36)}`;
}

export async function runProbes(client, probes = CAPABILITY_PROBES) {
  const results = [];
  for (const probe of probes) {
    try {
      await probe.run(client);
      results.push({ name: probe.name, detail: probe.detail, supported: true });
    } catch (error) {
      results.push({
        name: probe.name,
        detail: probe.detail,
        supported: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

async function main() {
  applyLocalDefaults();
  const { loadTestConfig } = await import("@the-town-remembers/runtime-config/test");
  const adminUrl = loadTestConfig(process.env).testDatabaseUrl;

  const serverPool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  const scratch = scratchDatabaseName();
  let results;
  let buildTag;

  try {
    const version = await serverPool.query("SELECT version() AS version");
    buildTag = /CockroachDB \S+ (v\d+\.\d+\.\d+)/.exec(version.rows[0].version)?.[1];
    await serverPool.query(`CREATE DATABASE ${scratch}`);

    const scratchUrl = new URL(adminUrl);
    scratchUrl.pathname = `/${scratch}`;
    const scratchPool = new pg.Pool({
      connectionString: scratchUrl.toString(),
      max: 1,
    });
    const client = await scratchPool.connect();
    try {
      results = await runProbes(client);
    } finally {
      client.release();
      await scratchPool.end();
    }
  } finally {
    await serverPool.query(`DROP DATABASE IF EXISTS ${scratch} CASCADE`);
    await serverPool.end();
  }

  console.log(
    `CockroachDB build: ${buildTag ?? "unknown"} (pinned ${COCKROACH_VERSION})`,
  );
  for (const result of results) {
    console.log(
      `${result.supported ? "ok  " : "FAIL"} ${result.name} — ${result.detail}`,
    );
    if (!result.supported) console.log(`     ${result.reason}`);
  }

  const failures = results.filter((result) => !result.supported);
  if (buildTag !== COCKROACH_VERSION) {
    console.error(
      `Target reports ${buildTag ?? "an unknown build"}; this repository is pinned to ${COCKROACH_VERSION}.`,
    );
    process.exitCode = 1;
  }
  if (failures.length > 0) {
    console.error(
      `Missing required capability: ${failures.map((f) => f.name).join(", ")}.`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("db-doctor.mjs")) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
