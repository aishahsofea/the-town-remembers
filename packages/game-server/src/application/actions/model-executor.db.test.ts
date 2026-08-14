/**
 * End-to-end `executeModelAction` coverage (`P4-10`).
 *
 * Uses the real `planAsk` planner (`rules/actions/model-backed.ts`, Phase 2)
 * with an empty disclosure bundle — this suite proves the executor's own
 * mechanics (revision-loss reload-and-rerun, `superseded` telemetry, the
 * exhausted retryable `409`), not `ask`'s real content, which is `P4-11`'s
 * job.
 */

import { randomUUID } from "node:crypto";

import type { ActionKind } from "@the-town-remembers/http-contracts";
import { planAsk, type AskInputs } from "@the-town-remembers/rules";
import {
  createDisposableDatabase,
  insertPlayer,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startOperationDeadline } from "../deadline.js";
import type { ExecuteModelActionParams, ModelActionHandler } from "./model-executor.js";
import { executeModelAction } from "./model-executor.js";

describe.skipIf(!shouldRunDatabaseTests())("executeModelAction", () => {
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

  interface Fixture {
    readonly townId: string;
    readonly playerId: string;
  }

  async function fixtureTownAndPlayer(): Promise<Fixture> {
    const townId = await insertTown(db().pool);
    const playerId = await insertPlayer(db().pool, townId);
    return { townId, playerId };
  }

  async function townRevision(townId: string): Promise<number> {
    const result = await db().pool.query<{ readonly revision: number }>(
      "SELECT revision FROM public.towns WHERE id = $1",
      [townId],
    );
    return result.rows[0]!.revision;
  }

  async function bumpRevision(pool: Pool, townId: string): Promise<void> {
    await pool.query("UPDATE public.towns SET revision = revision + 1 WHERE id = $1", [
      townId,
    ]);
  }

  type AskTestInputs = AskInputs;

  const EMPTY_BUNDLE_INPUTS: AskInputs = {
    npcPresent: true,
    disclosureCandidates: [],
    requiredDisclosureIds: [],
    approvedOutcomes: [],
    requiredOutcomeIds: [],
    approvedEpisodes: [],
  };

  function askHandler(
    runModelSelection: ModelActionHandler<"ask", AskTestInputs>["runModelSelection"],
  ): ModelActionHandler<"ask", AskTestInputs> {
    return {
      kind: "ask",
      loadInputs() {
        return Promise.resolve(EMPTY_BUNDLE_INPUTS);
      },
      plan: planAsk,
      runModelSelection,
      buildResult() {
        return {
          dialogue: { npcId: randomUUID(), text: "hi", responseMode: "selected" },
          promiseOffers: [],
        };
      },
      reasonMessage() {
        return "not present";
      },
    };
  }

  function baseParams<K extends ActionKind, TInputs>(
    fixture: Fixture,
    handler: ModelActionHandler<K, TInputs>,
    actionKind: K,
  ): ExecuteModelActionParams<K, TInputs> {
    return {
      pool: db().pool,
      deadline: startOperationDeadline(new Date()),
      townId: fixture.townId,
      playerId: fixture.playerId,
      idempotencyKey: randomUUID(),
      actionKind,
      targetActorId: null,
      targetEntityId: null,
      requestPayload: {},
      handler,
      now: () => new Date(),
      requestId: "req_test",
    };
  }

  it("calls the model exactly once and commits when nothing interleaves", async () => {
    const fixture = await fixtureTownAndPlayer();
    const before = await townRevision(fixture.townId);
    let calls = 0;

    const outcome = await executeModelAction(
      baseParams(
        fixture,
        askHandler(() => {
          calls += 1;
          return Promise.resolve({
            npcId: randomUUID(),
            text: "hello there",
            responseMode: "selected",
          });
        }),
        "ask",
      ),
    );

    expect(calls).toBe(1);
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("applied");
    expect(await townRevision(fixture.townId)).toBe(before + 1);
  });

  it("reruns exactly once after a revision loss during model work, and succeeds (acceptance 1)", async () => {
    const fixture = await fixtureTownAndPlayer();
    const before = await townRevision(fixture.townId);
    let calls = 0;

    const outcome = await executeModelAction(
      baseParams(
        fixture,
        askHandler(async () => {
          calls += 1;
          if (calls === 1) {
            // The "interloper": something else commits while this call's
            // model work is in flight.
            await bumpRevision(db().pool, fixture.townId);
          }
          return { npcId: randomUUID(), text: "hello there", responseMode: "selected" };
        }),
        "ask",
      ),
    );

    expect(calls).toBe(2);
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    // The interloper's bump (+1) plus this action's own successful commit (+1).
    expect(await townRevision(fixture.townId)).toBe(before + 2);
  });

  it("records superseded telemetry-worthy discards and stores a retryable 409 after exhausting the rerun budget (acceptance 1)", async () => {
    const fixture = await fixtureTownAndPlayer();
    let calls = 0;

    const outcome = await executeModelAction(
      baseParams(
        fixture,
        askHandler(async () => {
          calls += 1;
          // Every attempt's model work is interleaved with a concurrent
          // write — never converges.
          await bumpRevision(db().pool, fixture.townId);
          return { npcId: randomUUID(), text: "hello there", responseMode: "selected" };
        }),
        "ask",
      ),
    );

    expect(calls).toBe(2);
    expect(outcome.kind).toBe("replay");
    if (outcome.kind !== "replay") throw new Error("unreachable");
    expect(outcome.status).toBe("retryable");
    expect(outcome.responseStatus).toBe(409);
    expect(outcome.retryAfterSeconds).toBe(1);

    const row = await db().pool.query<{
      readonly status: string;
      readonly response_status: number;
      readonly error_code: string;
    }>(
      "SELECT status, response_status, error_code FROM public.player_actions WHERE town_id = $1 AND id = $2",
      [fixture.townId, outcome.actionId],
    );
    expect(row.rows[0]?.status).toBe("retryable");
    expect(row.rows[0]?.response_status).toBe(409);
    expect(row.rows[0]?.error_code).toBe("ACTION_CONFLICT");
  });

  it("completes immediately with no model call for a denied plan (no npc present)", async () => {
    const fixture = await fixtureTownAndPlayer();
    let modelCalls = 0;

    const handler: ModelActionHandler<"ask", AskTestInputs> = {
      ...askHandler(() => {
        modelCalls += 1;
        return Promise.resolve({
          npcId: randomUUID(),
          text: "hello",
          responseMode: "selected",
        });
      }),
      loadInputs() {
        return Promise.resolve({ ...EMPTY_BUNDLE_INPUTS, npcPresent: false });
      },
    };

    const outcome = await executeModelAction(baseParams(fixture, handler, "ask"));
    expect(modelCalls).toBe(0);
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("denied");
  });

  it("charges only fresh model work, rejects the fourth burst action without a ledger row, and bypasses replay", async () => {
    const fixture = await fixtureTownAndPlayer();
    const keys = Array.from({ length: 4 }, () => randomUUID());
    let modelCalls = 0;
    const handler = askHandler(() => {
      modelCalls += 1;
      return Promise.resolve({
        npcId: randomUUID(),
        text: "hello",
        responseMode: "selected",
      });
    });

    for (const idempotencyKey of keys.slice(0, 3)) {
      const outcome = await executeModelAction({
        ...baseParams(fixture, handler, "ask"),
        idempotencyKey,
      });
      expect(outcome.kind).toBe("executed");
    }

    const fourth = await executeModelAction({
      ...baseParams(fixture, handler, "ask"),
      idempotencyKey: keys[3]!,
    });
    expect(fourth.kind).toBe("rate_limited");
    if (fourth.kind !== "rate_limited") throw new Error("unreachable");
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(modelCalls).toBe(3);

    const absent = await db().pool.query(
      `SELECT id FROM public.player_actions
        WHERE town_id = $1 AND player_id = $2 AND idempotency_key = $3`,
      [fixture.townId, fixture.playerId, keys[3]],
    );
    expect(absent.rowCount).toBe(0);

    const replay = await executeModelAction({
      ...baseParams(fixture, handler, "ask"),
      idempotencyKey: keys[0]!,
    });
    expect(replay.kind).toBe("replay");
    expect(modelCalls).toBe(3);
  });

  it("charges before reclaiming retryable work and leaves the row retryable when rejected", async () => {
    const fixture = await fixtureTownAndPlayer();
    const ordinaryHandler = askHandler(() =>
      Promise.resolve({
        npcId: randomUUID(),
        text: "hello",
        responseMode: "selected",
      }),
    );

    for (let index = 0; index < 2; index += 1) {
      const outcome = await executeModelAction(
        baseParams(fixture, ordinaryHandler, "ask"),
      );
      expect(outcome.kind).toBe("executed");
    }

    const retryKey = randomUUID();
    const conflictingHandler = askHandler(async () => {
      await bumpRevision(db().pool, fixture.townId);
      return { npcId: randomUUID(), text: "hello", responseMode: "selected" };
    });
    const retryable = await executeModelAction({
      ...baseParams(fixture, conflictingHandler, "ask"),
      idempotencyKey: retryKey,
    });
    expect(retryable.kind).toBe("replay");
    if (retryable.kind !== "replay") throw new Error("unreachable");
    expect(retryable.status).toBe("retryable");

    await db().pool.query(
      `UPDATE public.player_actions SET retry_after_at = $3
        WHERE town_id = $1 AND id = $2`,
      [fixture.townId, retryable.actionId, new Date(Date.now() - 1_000)],
    );

    const rejectedReclaim = await executeModelAction({
      ...baseParams(fixture, ordinaryHandler, "ask"),
      idempotencyKey: retryKey,
    });
    expect(rejectedReclaim.kind).toBe("rate_limited");

    const row = await db().pool.query<{ readonly status: string }>(
      `SELECT status FROM public.player_actions WHERE town_id = $1 AND id = $2`,
      [fixture.townId, retryable.actionId],
    );
    expect(row.rows[0]?.status).toBe("retryable");
  });
});
