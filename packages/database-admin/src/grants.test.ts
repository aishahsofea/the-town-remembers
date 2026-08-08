import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCEPTED_VIEWS } from "./expected-schema.js";

/**
 * Runs a statement and reports whether it was permitted, distinguishing an
 * authorization failure from any other error. A test that only checked
 * "did it throw" would pass for a typo.
 */
async function attempt(
  pool: Pool,
  sql: string,
): Promise<{ permitted: boolean; code: string | undefined }> {
  try {
    await pool.query(sql);
    return { permitted: true, code: undefined };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { permitted: false, code };
  }
}

const INSUFFICIENT_PRIVILEGE = "42501";

describe.skipIf(!shouldRunDatabaseTests())("least-privilege grants", () => {
  let handle: DisposableDatabase | undefined;
  let runtime: Pool;
  let inspector: Pool;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    runtime = handle.poolFor("app_runtime");
    inspector = handle.poolFor("inspection_reader");
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  describe("app_runtime", () => {
    it("may read and write game state", async () => {
      expect(
        (await attempt(runtime, "SELECT count(*) FROM public.towns")).permitted,
      ).toBe(true);
      expect(
        (
          await attempt(
            runtime,
            `INSERT INTO public.towns
               (id, invite_token_hash, content_version, status, created_at, updated_at)
             VALUES (gen_random_uuid(), repeat('a', 32)::BYTES, 'bell-mystery-v1',
                     'active', now(), now())`,
          )
        ).permitted,
      ).toBe(true);
    });

    it("may prune only the rate-limit table", async () => {
      expect(
        (await attempt(runtime, "DELETE FROM public.api_rate_limits WHERE false"))
          .permitted,
      ).toBe(true);

      // Causal history cannot be erased by the identity that writes it.
      for (const table of [
        "world_events",
        "belief_evidence",
        "claim_transmissions",
        "towns",
      ]) {
        const result = await attempt(
          runtime,
          `DELETE FROM public.${table} WHERE false`,
        );
        expect(result.permitted, table).toBe(false);
        expect(result.code, table).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it("may not change the schema", async () => {
      for (const sql of [
        "CREATE TABLE public.smuggled_by_runtime (a INT PRIMARY KEY)",
        "DROP TABLE public.world_events",
        "ALTER TABLE public.towns ADD COLUMN smuggled STRING",
      ]) {
        const result = await attempt(runtime, sql);
        expect(result.permitted, sql).toBe(false);
        expect(result.code, sql).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it("may not administer roles", async () => {
      const result = await attempt(runtime, "CREATE USER smuggled_identity");
      expect(result.permitted).toBe(false);
    });

    it("may not rewrite recorded migration history", async () => {
      expect(
        (await attempt(runtime, "SELECT count(*) FROM public.schema_migrations"))
          .permitted,
      ).toBe(true);
      const result = await attempt(
        runtime,
        "DELETE FROM public.schema_migrations WHERE false",
      );
      expect(result.permitted).toBe(false);
    });

    it("cannot read the judge inspection surface", async () => {
      for (const view of ACCEPTED_VIEWS) {
        const result = await attempt(runtime, `SELECT 1 FROM inspection.${view}`);
        expect(result.permitted, view).toBe(false);
      }
    });
  });

  describe("inspection_reader", () => {
    it("may read every accepted view", async () => {
      for (const view of ACCEPTED_VIEWS) {
        const result = await attempt(inspector, `SELECT 1 FROM inspection.${view}`);
        expect(result.permitted, view).toBe(true);
      }
    });

    it("may not read a base table, so no hash can be reached directly", async () => {
      for (const table of [
        "towns",
        "player_sessions",
        "join_requests",
        "world_events",
      ]) {
        const result = await attempt(inspector, `SELECT 1 FROM public.${table}`);
        expect(result.permitted, table).toBe(false);
        expect(result.code, table).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it("is read-only", async () => {
      const writes = [
        "INSERT INTO inspection.npc_beliefs (town_id) VALUES (gen_random_uuid())",
        "CREATE TABLE public.smuggled_by_inspector (a INT PRIMARY KEY)",
        `INSERT INTO public.api_rate_limits
           (scope_kind, scope_key, bucket_kind, tokens_milli, last_refill_at,
            created_at, updated_at)
         VALUES ('player', repeat('a', 32)::BYTES, 'model_action', 1, now(), now(), now())`,
      ];
      for (const sql of writes) {
        expect((await attempt(inspector, sql)).permitted, sql).toBe(false);
      }
    });
  });
});
