import { randomUUID } from "node:crypto";

import { DatabaseError } from "@the-town-remembers/database";
import { microUsdToDecimalString } from "@the-town-remembers/model-runtime";
import {
  createDisposableDatabase,
  insertPlayer,
  insertTown,
  shouldRunDatabaseTests,
  SHA256_PLACEHOLDER,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  billingMonthFor,
  currentCostMode,
  releaseModelCost,
  reserveModelCost,
  settleModelCost,
  type AdmitModelCostParams,
} from "./model-cost.js";

describe.skipIf(!shouldRunDatabaseTests())("model_cost_reservations ledger", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  // `model_cost_reservations` is deliberately global, not scoped per town
  // (migration 0008's own header comment) — there is no scope key to
  // isolate one test's spend from another's the way `rate-limits.db.test.ts`
  // isolates buckets by a random scope key. The only isolating dimension it
  // has is the billing month, so each test gets its own, monotonically
  // advancing far enough that no two tests ever share one.
  let monthCounter = 0;
  function freshNow(): Date {
    monthCounter += 1;
    const year = 2020 + Math.floor(monthCounter / 12);
    const month = (monthCounter % 12) + 1;
    return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
  }

  function baseParams(
    now: Date,
    overrides: Partial<AdmitModelCostParams> & Pick<AdmitModelCostParams, "source">,
  ): AdmitModelCostParams {
    return {
      reservationId: randomUUID(),
      attemptOrdinal: 0,
      purpose: "claim_normalization",
      model: "haiku",
      inferenceProfile: "arn:aws:bedrock:us-east-1:111:inference-profile/haiku",
      priceVersion: "bedrock-prices/2026-08-01",
      maximumCostMicroUsd: 1_000_000,
      now,
      ...overrides,
    };
  }

  /** Minimal valid `towns`/`players`/`player_actions` row, only to satisfy `fk_model_cost_reservations__town`/`__player_action` — nothing about the action itself is under test here. */
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

  /** Seeds prior spend for `now`'s billing month as an already-`settled` row, bypassing admission — for tests that need a known starting total. */
  async function seedSettledSpend(
    now: Date,
    microUsd: number,
    key: string,
  ): Promise<void> {
    const decimal = microUsdToDecimalString(microUsd);
    await db().pool.query(
      `INSERT INTO public.model_cost_reservations
         (id, billing_month, town_id, player_action_id, ambient_job_execution_id,
          world_event_id, non_game_operation_key, attempt_ordinal, purpose, model,
          inference_profile, price_version, maximum_cost, status, actual_cost,
          settled_at, created_at)
       VALUES ($1, $2, NULL, NULL, NULL, NULL, $3, 0, 'claim_normalization', 'haiku',
               'haiku-profile', 'v1', $4, 'settled', $4, $5, $5)`,
      [randomUUID(), billingMonthFor(now), key, decimal, now],
    );
  }

  it("admits and inserts a reservation for a fresh player-action source", async () => {
    const now = freshNow();
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const params = baseParams(now, {
      source: { kind: "player_action", townId, playerActionId },
    });
    const deadlineAt = Date.now() + 20_000;

    const decision = await reserveModelCost(db().pool, deadlineAt, params);
    expect(decision).toStrictEqual({ admitted: true, mode: "normal" });

    const row = await db().pool.query(
      `SELECT status, town_id, player_action_id, attempt_ordinal, maximum_cost
         FROM public.model_cost_reservations WHERE id = $1`,
      [params.reservationId],
    );
    expect(row.rows[0]).toMatchObject({
      status: "reserved",
      town_id: townId,
      player_action_id: playerActionId,
      attempt_ordinal: 0,
    });
  });

  it("admits a non_game_operation source with no town", async () => {
    const now = freshNow();
    const params = baseParams(now, {
      source: {
        kind: "non_game_operation",
        nonGameOperationKey: `prewarm:${randomUUID()}`,
      },
    });
    const decision = await reserveModelCost(db().pool, Date.now() + 20_000, params);
    expect(decision.admitted).toBe(true);

    const row = await db().pool.query(
      `SELECT town_id, non_game_operation_key FROM public.model_cost_reservations WHERE id = $1`,
      [params.reservationId],
    );
    expect(row.rows[0]!.town_id).toBeNull();
    expect(row.rows[0]!.non_game_operation_key).not.toBeNull();
  });

  it("admits exactly the number of concurrent reservations the $10.35 hard cap permits, rejecting the rest", async () => {
    const now = freshNow();
    const seedKey = `hardcap:${randomUUID()}`;
    await seedSettledSpend(now, 10_000_000, seedKey); // $10.00 already spent this month.

    // From $10.00, three $0.10 reservations reach $10.30 (< $10.35); a fourth
    // would reach $10.40 (>= $10.35) and every call past it sees the same
    // still-$10.30 committed total, so exactly three of any larger batch fit.
    const deadlineAt = Date.now() + 30_000;
    const attempts = Array.from({ length: 10 }, (_, index) =>
      reserveModelCost(
        db().pool,
        deadlineAt,
        baseParams(now, {
          source: {
            kind: "non_game_operation",
            nonGameOperationKey: `${seedKey}:${index}`,
          },
          maximumCostMicroUsd: 100_000,
        }),
      ),
    );
    const decisions = await Promise.all(attempts);

    const admitted = decisions.filter((decision) => decision.admitted);
    const rejected = decisions.filter((decision) => !decision.admitted);
    expect(admitted).toHaveLength(3);
    expect(rejected).toHaveLength(7);
    expect(admitted.every((decision) => decision.mode === "tighten")).toBe(true);
    expect(rejected.every((decision) => decision.mode === "fallback_only")).toBe(true);
  }, 30_000);

  it("resolves the reduced_cost and tighten thresholds correctly under concurrency, admitting all ten", async () => {
    // Ten concurrent $1.00 reservations from a clean month: whichever
    // serialization order CockroachDB picks, exactly seven land with a
    // projected total under $8.00 ("normal"), two land in [$8.00, $9.50)
    // ("reduced_cost"), and one lands at/above $9.50 ("tighten") — the
    // per-call assignment is order-dependent, but the histogram is not.
    const now = freshNow();
    const seedKey = `thresholds:${randomUUID()}`;
    const deadlineAt = Date.now() + 30_000;
    const attempts = Array.from({ length: 10 }, (_, index) =>
      reserveModelCost(
        db().pool,
        deadlineAt,
        baseParams(now, {
          source: {
            kind: "non_game_operation",
            nonGameOperationKey: `${seedKey}:${index}`,
          },
          maximumCostMicroUsd: 1_000_000,
        }),
      ),
    );
    const decisions = await Promise.all(attempts);

    expect(decisions.every((decision) => decision.admitted)).toBe(true);
    const histogram = { normal: 0, reduced_cost: 0, tighten: 0, fallback_only: 0 };
    for (const decision of decisions) histogram[decision.mode] += 1;
    expect(histogram).toStrictEqual({
      normal: 7,
      reduced_cost: 2,
      tighten: 1,
      fallback_only: 0,
    });
  }, 30_000);

  it("never calls the model before a reservation has committed, and never calls it at all when rejected", async () => {
    const now = freshNow();
    const spy: string[] = [];
    async function reserveThenMaybeCall(
      params: AdmitModelCostParams,
    ): Promise<{ admitted: boolean }> {
      const decision = await reserveModelCost(db().pool, Date.now() + 20_000, params);
      if (!decision.admitted) return { admitted: false };
      // Only reachable once the reservation's INSERT has committed.
      const row = await db().pool.query(
        `SELECT id FROM public.model_cost_reservations WHERE id = $1 AND status = 'reserved'`,
        [params.reservationId],
      );
      expect(row.rowCount).toBe(1);
      spy.push(params.reservationId);
      return { admitted: true };
    }

    const admittedResult = await reserveThenMaybeCall(
      baseParams(now, {
        source: {
          kind: "non_game_operation",
          nonGameOperationKey: `spy-admit:${randomUUID()}`,
        },
      }),
    );
    expect(admittedResult.admitted).toBe(true);
    expect(spy).toHaveLength(1);

    const seedKey = `spy-reject:${randomUUID()}`;
    await seedSettledSpend(now, 10_350_000, seedKey); // Already at the hard cap.
    const rejectedResult = await reserveThenMaybeCall(
      baseParams(now, {
        source: { kind: "non_game_operation", nonGameOperationKey: `${seedKey}:call` },
      }),
    );
    expect(rejectedResult.admitted).toBe(false);
    expect(spy).toHaveLength(1); // Unchanged: the rejected call never ran.
  }, 30_000);

  it("lets retry, repair, and a revision rerun reserve separately under distinct attempt_ordinals", async () => {
    const now = freshNow();
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const deadlineAt = Date.now() + 20_000;

    const first = await reserveModelCost(
      db().pool,
      deadlineAt,
      baseParams(now, {
        source: { kind: "player_action", townId, playerActionId },
        attemptOrdinal: 0,
      }),
    );
    const retry = await reserveModelCost(
      db().pool,
      deadlineAt,
      baseParams(now, {
        source: { kind: "player_action", townId, playerActionId },
        attemptOrdinal: 1,
      }),
    );
    const repair = await reserveModelCost(
      db().pool,
      deadlineAt,
      baseParams(now, {
        source: { kind: "player_action", townId, playerActionId },
        attemptOrdinal: 2,
        purpose: "structured_repair",
      }),
    );
    expect([first.admitted, retry.admitted, repair.admitted]).toStrictEqual([
      true,
      true,
      true,
    ]);

    const count = await db().pool.query(
      `SELECT count(*)::INT8 AS n FROM public.model_cost_reservations WHERE player_action_id = $1`,
      [playerActionId],
    );
    expect(count.rows[0]!.n).toBe(3);
  }, 30_000);

  it("rejects a reused attempt_ordinal for the same source and purpose with a unique_violation", async () => {
    const now = freshNow();
    const { townId, playerActionId } = await fixtureTownAndPlayerAction(db().pool);
    const deadlineAt = Date.now() + 20_000;
    const params = baseParams(now, {
      source: { kind: "player_action", townId, playerActionId },
      attemptOrdinal: 0,
    });

    const first = await reserveModelCost(db().pool, deadlineAt, params);
    expect(first.admitted).toBe(true);

    // A unique-constraint violation is not a serialization conflict, so
    // `runSerializable` never retries it and it propagates straight out of
    // `reserveModelCost` rather than being folded into "not admitted".
    const reused = reserveModelCost(db().pool, deadlineAt, {
      ...params,
      reservationId: randomUUID(),
    });
    await expect(reused).rejects.toThrow(DatabaseError);
    await reused.catch((error: unknown) => {
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).category).toBe("unique_violation");
      expect((error as DatabaseError).constraintName).toBe(
        "uq_model_cost_reservations__player_action",
      );
    });
  }, 30_000);

  it("clamps settlement to the reservation's maximum and reports the clamp", async () => {
    const now = freshNow();
    const params = baseParams(now, {
      source: {
        kind: "non_game_operation",
        nonGameOperationKey: `clamp:${randomUUID()}`,
      },
      maximumCostMicroUsd: 500_000,
    });
    const deadlineAt = Date.now() + 20_000;
    const decision = await reserveModelCost(db().pool, deadlineAt, params);
    expect(decision.admitted).toBe(true);

    const agentRunId = randomUUID();
    const result = await settleModelCost(db().pool, deadlineAt, {
      reservationId: params.reservationId,
      agentRunId,
      settledCostMicroUsd: 900_000, // Exceeds the 500,000 maximum.
      now,
    });
    expect(result).toStrictEqual({ clamped: true });

    const row = await db().pool.query(
      `SELECT status, actual_cost, agent_run_id FROM public.model_cost_reservations WHERE id = $1`,
      [params.reservationId],
    );
    expect(row.rows[0]!.status).toBe("settled");
    expect(row.rows[0]!.actual_cost).toBe("0.500000");
    expect(row.rows[0]!.agent_run_id).toBe(agentRunId);
  }, 30_000);

  it("settles within the maximum without clamping", async () => {
    const now = freshNow();
    const params = baseParams(now, {
      source: {
        kind: "non_game_operation",
        nonGameOperationKey: `no-clamp:${randomUUID()}`,
      },
      maximumCostMicroUsd: 500_000,
    });
    const deadlineAt = Date.now() + 20_000;
    await reserveModelCost(db().pool, deadlineAt, params);

    const result = await settleModelCost(db().pool, deadlineAt, {
      reservationId: params.reservationId,
      agentRunId: randomUUID(),
      settledCostMicroUsd: 200_000,
      now,
    });
    expect(result).toStrictEqual({ clamped: false });
  }, 30_000);

  it("settling twice with the same reservation and run id is idempotent", async () => {
    const now = freshNow();
    const params = baseParams(now, {
      source: {
        kind: "non_game_operation",
        nonGameOperationKey: `idempotent:${randomUUID()}`,
      },
    });
    const deadlineAt = Date.now() + 20_000;
    await reserveModelCost(db().pool, deadlineAt, params);
    const agentRunId = randomUUID();
    const settleParams = {
      reservationId: params.reservationId,
      agentRunId,
      settledCostMicroUsd: 300_000,
      now,
    };

    const firstResult = await settleModelCost(db().pool, deadlineAt, settleParams);
    const secondResult = await settleModelCost(db().pool, deadlineAt, settleParams);
    expect(firstResult).toStrictEqual(secondResult);
  }, 30_000);

  it("releases a proven non-call with actual_cost = 0", async () => {
    const now = freshNow();
    const params = baseParams(now, {
      source: {
        kind: "non_game_operation",
        nonGameOperationKey: `release:${randomUUID()}`,
      },
    });
    const deadlineAt = Date.now() + 20_000;
    await reserveModelCost(db().pool, deadlineAt, params);

    await releaseModelCost(db().pool, deadlineAt, params.reservationId, now);

    const row = await db().pool.query(
      `SELECT status, actual_cost FROM public.model_cost_reservations WHERE id = $1`,
      [params.reservationId],
    );
    expect(row.rows[0]).toMatchObject({ status: "released", actual_cost: "0.000000" });
  }, 30_000);

  it("leaves an ambiguous call's reservation untouched, still consuming capacity, until a later settlement resolves it", async () => {
    const now = freshNow();
    const params = baseParams(now, {
      source: {
        kind: "non_game_operation",
        nonGameOperationKey: `reconcile:${randomUUID()}`,
      },
      maximumCostMicroUsd: 2_000_000,
    });
    const deadlineAt = Date.now() + 20_000;
    await reserveModelCost(db().pool, deadlineAt, params);

    // Nothing settles or releases it yet — simulating an outcome that was
    // never resolved after the call. It must still count toward the month.
    const modeWhileReserved = await currentCostMode(db().pool, { now });
    const row = await db().pool.query(
      `SELECT status FROM public.model_cost_reservations WHERE id = $1`,
      [params.reservationId],
    );
    expect(row.rows[0]!.status).toBe("reserved");
    expect(modeWhileReserved).toBe("normal");

    // A later reconciliation settles it for real.
    const result = await settleModelCost(db().pool, deadlineAt, {
      reservationId: params.reservationId,
      agentRunId: randomUUID(),
      settledCostMicroUsd: 1_500_000,
      now: new Date(now.getTime() + 60_000),
    });
    expect(result).toStrictEqual({ clamped: false });
  }, 30_000);

  it("currentCostMode reflects settled and reserved sums together, with no pending call added", async () => {
    const now = freshNow();
    const key = `mode:${randomUUID()}`;
    await seedSettledSpend(now, 6_000_000, key); // $6.00 settled...
    const beforeReserving = await currentCostMode(db().pool, { now });
    expect(beforeReserving).toBe("normal"); // ...alone, under $8.00.

    const reservation = baseParams(now, {
      source: { kind: "non_game_operation", nonGameOperationKey: `${key}:reserve` },
      maximumCostMicroUsd: 3_500_000, // ...plus $3.50 reserved = $9.50 together.
    });
    const decision = await reserveModelCost(
      db().pool,
      Date.now() + 20_000,
      reservation,
    );
    expect(decision.admitted).toBe(true);

    const afterReserving = await currentCostMode(db().pool, { now });
    expect(afterReserving).toBe("tighten");
  }, 30_000);
});
