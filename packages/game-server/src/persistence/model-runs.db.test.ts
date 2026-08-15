import { randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertPlayer,
  insertTown,
  shouldRunDatabaseTests,
  SHA256_PLACEHOLDER,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendRun,
  markActionRunsSuperseded,
  type AppendRunParams,
} from "./model-runs.js";
import { reserveModelCost } from "./model-cost.js";

describe.skipIf(!shouldRunDatabaseTests())("agent_runs telemetry", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  async function fixtureTownAndPlayerAction(
    pool: Pool,
  ): Promise<{ readonly townId: string; readonly playerActionId: string }> {
    const townId = await insertTown(pool);
    const playerId = await insertPlayer(pool, townId);
    const playerActionId = randomUUID();
    await pool.query(
      `INSERT INTO public.player_actions
         (town_id, id, player_id, idempotency_key, action_kind, request_hash,
          request_payload, target_actor_id, target_entity_id, status, outcome,
          response_status, response_payload, attempt_count, created_at, updated_at,
          completed_at)
       VALUES ($1, $2, $3, $4, 'add_note', $5, '{}', NULL, NULL, 'completed', 'applied',
               200, '{}', 1, now(), now(), now())`,
      [townId, playerActionId, playerId, randomUUID(), SHA256_PLACEHOLDER],
    );
    return { townId, playerActionId };
  }

  const VALID_USAGE = {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const VALID_SHA256 = new Uint8Array(32).fill(9);
  const NOW = new Date("2026-08-13T12:00:00.000Z");

  async function readRun(runId: string): Promise<Record<string, unknown> | undefined> {
    const result = await db().pool.query<Record<string, unknown>>(
      `SELECT * FROM public.agent_runs WHERE id = $1`,
      [runId],
    );
    return result.rows[0];
  }

  it("writes all four contract-version columns for a structured, non-repair purpose", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const runId = randomUUID();
    await appendRun(db().pool, Date.now() + 20_000, {
      runId,
      townId,
      playerActionId,
      model: "haiku",
      inferenceProfile: "arn:aws:bedrock:us-east-1:111:inference-profile/haiku",
      promptVersion: "v1",
      purpose: "claim_normalization",
      promptSha256: VALID_SHA256,
      taskInputVersion: "task-v1",
      outputSchemaVersion: "schema-v1",
      validationPolicyVersion: "policy-v1",
      usage: VALID_USAGE,
      latencyMs: 250,
      estimatedCostMicroUsd: 1_234,
      outcome: "accepted",
      now: NOW,
    });

    const row = await readRun(runId);
    expect(row).toMatchObject({
      purpose: "claim_normalization",
      task_input_version: "task-v1",
      output_schema_version: "schema-v1",
      validation_policy_version: "policy-v1",
      target_prompt_version: null,
      outcome: "accepted",
      estimated_cost: "0.001234",
    });
    expect(Buffer.from(row!["prompt_sha256"] as Buffer)).toStrictEqual(
      Buffer.from(VALID_SHA256),
    );
  });

  it("rolls back the run when its cost finalization cannot commit", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const runId = randomUUID();
    const append = appendRun(
      db().pool,
      Date.now() + 20_000,
      {
        runId,
        townId,
        playerActionId,
        model: "haiku",
        inferenceProfile: "haiku-resolved-id",
        promptVersion: "v1",
        purpose: "claim_normalization",
        promptSha256: VALID_SHA256,
        taskInputVersion: "task-v1",
        outputSchemaVersion: "schema-v1",
        validationPolicyVersion: "policy-v1",
        usage: VALID_USAGE,
        latencyMs: 250,
        estimatedCostMicroUsd: 1_234,
        outcome: "accepted",
        now: NOW,
      },
      {
        kind: "settled",
        reservationId: randomUUID(),
        settledCostMicroUsd: 1_234,
      },
    );

    await expect(append).rejects.toThrow();
    expect(await readRun(runId)).toBeUndefined();
  });

  it("commits a run and its cost settlement together", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const reservationId = randomUUID();
    const deadlineAt = Date.now() + 20_000;
    const admission = await reserveModelCost(db().pool, deadlineAt, {
      reservationId,
      source: { kind: "player_action", townId, playerActionId },
      attemptOrdinal: 0,
      purpose: "claim_normalization",
      model: "haiku",
      inferenceProfile: "haiku-resolved-id",
      priceVersion: "bedrock-prices/2026-08-01",
      maximumCostMicroUsd: 10_000,
      now: NOW,
    });
    expect(admission.admitted).toBe(true);

    const runId = randomUUID();
    await appendRun(
      db().pool,
      deadlineAt,
      {
        runId,
        townId,
        playerActionId,
        model: "haiku",
        inferenceProfile: "haiku-resolved-id",
        promptVersion: "v1",
        purpose: "claim_normalization",
        promptSha256: VALID_SHA256,
        taskInputVersion: "task-v1",
        outputSchemaVersion: "schema-v1",
        validationPolicyVersion: "policy-v1",
        usage: VALID_USAGE,
        latencyMs: 250,
        estimatedCostMicroUsd: 1_234,
        outcome: "accepted",
        now: NOW,
      },
      { kind: "settled", reservationId, settledCostMicroUsd: 1_234 },
    );

    expect(await readRun(runId)).toBeDefined();
    const reservation = await db().pool.query<{
      readonly status: string;
      readonly agent_run_id: string | null;
    }>(
      "SELECT status, agent_run_id FROM public.model_cost_reservations WHERE id = $1",
      [reservationId],
    );
    expect(reservation.rows[0]).toMatchObject({
      status: "settled",
      agent_run_id: runId,
    });
  });

  it("writes target_prompt_version alongside the other three for structured_repair", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const runId = randomUUID();
    await appendRun(db().pool, Date.now() + 20_000, {
      runId,
      townId,
      playerActionId,
      model: "haiku",
      inferenceProfile: "haiku-resolved-id",
      promptVersion: "repair-v1",
      purpose: "structured_repair",
      targetPromptVersion: "dialogue-v1",
      promptSha256: VALID_SHA256,
      taskInputVersion: "task-v1",
      outputSchemaVersion: "schema-v1",
      validationPolicyVersion: "policy-v1",
      usage: VALID_USAGE,
      latencyMs: 400,
      estimatedCostMicroUsd: 2_000,
      outcome: "repaired",
      now: NOW,
    });

    const row = await readRun(runId);
    expect(row).toMatchObject({
      purpose: "structured_repair",
      target_prompt_version: "dialogue-v1",
      outcome: "repaired",
    });
  });

  it("marks accepted and repaired calls superseded after a revision loss", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const runs = [
      { runId: randomUUID(), outcome: "accepted" as const },
      { runId: randomUUID(), outcome: "repaired" as const },
      { runId: randomUUID(), outcome: "rejected" as const },
    ];
    for (const run of runs) {
      await appendRun(db().pool, Date.now() + 20_000, {
        ...run,
        townId,
        playerActionId,
        model: "haiku",
        inferenceProfile: "haiku-resolved-id",
        promptVersion: "v1",
        purpose: "claim_normalization",
        promptSha256: VALID_SHA256,
        taskInputVersion: "task-v1",
        outputSchemaVersion: "schema-v1",
        validationPolicyVersion: "policy-v1",
        usage: VALID_USAGE,
        latencyMs: 250,
        estimatedCostMicroUsd: 1_234,
        now: NOW,
      });
    }

    await markActionRunsSuperseded(
      db().pool,
      Date.now() + 20_000,
      townId,
      playerActionId,
    );

    const outcomes = await db().pool.query<{
      readonly id: string;
      readonly outcome: string;
    }>(
      `SELECT id, outcome FROM public.agent_runs
        WHERE town_id = $1 AND player_action_id = $2`,
      [townId, playerActionId],
    );
    expect(
      Object.fromEntries(outcomes.rows.map((row) => [row.id, row.outcome])),
    ).toEqual({
      [runs[0]!.runId]: "superseded",
      [runs[1]!.runId]: "superseded",
      [runs[2]!.runId]: "rejected",
    });
  });

  it("writes null contract-version columns for an embedding purpose", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const runId = randomUUID();
    await appendRun(db().pool, Date.now() + 20_000, {
      runId,
      townId,
      playerActionId,
      model: "titan",
      inferenceProfile: "titan-resolved-id",
      promptVersion: "embedding-v1",
      purpose: "query_embedding",
      usage: {
        inputTokens: 20,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      latencyMs: 80,
      estimatedCostMicroUsd: 4,
      outcome: "accepted",
      now: NOW,
    });

    const row = await readRun(runId);
    expect(row).toMatchObject({
      purpose: "query_embedding",
      target_prompt_version: null,
      prompt_sha256: null,
      task_input_version: null,
      output_schema_version: null,
      validation_policy_version: null,
    });
  });

  it("is idempotent: appending the same runId twice writes exactly one row", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const runId = randomUUID();
    const params: AppendRunParams = {
      runId,
      townId,
      playerActionId,
      model: "haiku",
      inferenceProfile: "haiku-resolved-id",
      promptVersion: "v1",
      purpose: "ambient_choice",
      promptSha256: VALID_SHA256,
      taskInputVersion: "task-v1",
      outputSchemaVersion: "schema-v1",
      validationPolicyVersion: "policy-v1",
      usage: VALID_USAGE,
      latencyMs: 300,
      estimatedCostMicroUsd: 500,
      outcome: "accepted",
      now: NOW,
    };

    await appendRun(db().pool, Date.now() + 20_000, params);
    await appendRun(db().pool, Date.now() + 20_000, params);

    const count = await db().pool.query(
      `SELECT count(*)::INT8 AS n FROM public.agent_runs WHERE id = $1`,
      [runId],
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it("accepts a run whose only causal source is a world_event_id", async () => {
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    // A minimal world_events row to reference: this test is only about
    // agent_runs' own column, not world_events' own shape, so it borrows the
    // already-fixtured player action as the event's origin.
    const worldEventId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, player_action_id, effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, 1, 'note_added', false, now(), 'player_action', $3, 0, $4, '{}', now())`,
      [townId, worldEventId, playerActionId, `test:${worldEventId}`],
    );

    const runId = randomUUID();
    await appendRun(db().pool, Date.now() + 20_000, {
      runId,
      townId,
      worldEventId,
      model: "titan",
      inferenceProfile: "titan-resolved-id",
      promptVersion: "embedding-v1",
      purpose: "episode_embedding",
      usage: {
        inputTokens: 40,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      latencyMs: 60,
      estimatedCostMicroUsd: 8,
      outcome: "accepted",
      now: NOW,
    });

    const row = await readRun(runId);
    expect(row).toMatchObject({
      world_event_id: worldEventId,
      player_action_id: null,
      ambient_job_execution_id: null,
    });
  });

  describe("ck_agent_runs__contract_versions and ck_agent_runs__target_prompt_version", () => {
    async function rawInsert(overrides: Record<string, unknown>): Promise<void> {
      const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
      const columns = {
        town_id: townId,
        id: randomUUID(),
        player_action_id: playerActionId,
        ambient_job_execution_id: null,
        world_event_id: null,
        purpose: "claim_normalization",
        model: "haiku",
        inference_profile: "haiku-resolved-id",
        prompt_version: "v1",
        target_prompt_version: null,
        prompt_sha256: Buffer.from(VALID_SHA256),
        task_input_version: "task-v1",
        output_schema_version: "schema-v1",
        validation_policy_version: "policy-v1",
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        latency_ms: 100,
        estimated_cost: "0.000100",
        outcome: "accepted",
        validation_error_code: null,
        created_at: NOW,
        ...overrides,
      };
      const keys = Object.keys(columns);
      const values = Object.values(columns);
      const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
      await db().pool.query(
        `INSERT INTO public.agent_runs (${keys.join(", ")}) VALUES (${placeholders})`,
        values,
      );
    }

    it("rejects a structured purpose with all four contract columns null", async () => {
      await expect(
        rawInsert({
          prompt_sha256: null,
          task_input_version: null,
          output_schema_version: null,
          validation_policy_version: null,
        }),
      ).rejects.toMatchObject({ constraint: "ck_agent_runs__contract_versions" });
    });

    it("rejects an embedding purpose with the four contract columns populated", async () => {
      await expect(rawInsert({ purpose: "episode_embedding" })).rejects.toMatchObject({
        constraint: "ck_agent_runs__contract_versions",
      });
    });

    it("accepts an embedding purpose only when all four contract columns are null", async () => {
      await expect(
        rawInsert({
          purpose: "episode_embedding",
          prompt_sha256: null,
          task_input_version: null,
          output_schema_version: null,
          validation_policy_version: null,
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects a non-repair purpose with target_prompt_version set", async () => {
      await expect(
        rawInsert({ target_prompt_version: "some-version" }),
      ).rejects.toMatchObject({ constraint: "ck_agent_runs__target_prompt_version" });
    });

    it("rejects structured_repair without target_prompt_version", async () => {
      await expect(
        rawInsert({ purpose: "structured_repair", target_prompt_version: null }),
      ).rejects.toMatchObject({ constraint: "ck_agent_runs__target_prompt_version" });
    });

    it("accepts structured_repair with target_prompt_version set", async () => {
      await expect(
        rawInsert({
          purpose: "structured_repair",
          target_prompt_version: "some-version",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
