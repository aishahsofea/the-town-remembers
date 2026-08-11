/**
 * End-to-end `executeAction` coverage (`P3-09`).
 *
 * `loadStartVisitInputs`/`loadTravelInputs` (`D3-N`) do not exist yet —
 * they are `P3-10`'s job. These two test-local handlers stand in for them,
 * reading exactly the narrow inputs `planStartVisit`/`planTravel` (Phase 2's
 * real planners) declare, so this suite proves the executor's own mechanics
 * — claim, commit, retry, conflict, and completion — against real planners
 * and a real database rather than a synthetic stand-in decision.
 */

import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import {
  planStartVisit,
  planTravel,
  type StartVisitInputs,
  type TravelInputs,
} from "@the-town-remembers/rules";
import type {
  ActionKind,
  CompletedActionResponse,
} from "@the-town-remembers/http-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startOperationDeadline } from "../deadline.js";
import type { ActionHandler, ExecuteActionParams } from "./executor.js";
import { executeAction } from "./executor.js";

describe.skipIf(!shouldRunDatabaseTests())("executeAction", () => {
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
    readonly festivalSquareId: string;
  }

  async function fixtureTownAndPlayer(): Promise<Fixture> {
    const townId = await insertTown(db().pool);
    const playerId = await insertPlayer(db().pool, townId);
    const festivalSquareId = await insertStoryEntity(db().pool, townId, {
      entityType: "location",
      entityKey: "festival_square",
    });
    return { townId, playerId, festivalSquareId };
  }

  async function townRevision(townId: string): Promise<number> {
    const result = await db().pool.query<{ readonly revision: number }>(
      "SELECT revision FROM public.towns WHERE id = $1",
      [townId],
    );
    return result.rows[0]!.revision;
  }

  interface StartVisitTestInputs extends StartVisitInputs {
    readonly existingVisitId: string | null;
  }

  const startVisitHandler: ActionHandler<"start_visit", StartVisitTestInputs> = {
    kind: "start_visit",
    async loadInputs(pool, ctx) {
      const active = await pool.query<{ readonly id: string }>(
        `SELECT id FROM public.player_visits
          WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
        [ctx.townId, ctx.playerId],
      );
      const location = await pool.query<{ readonly id: string }>(
        `SELECT id FROM public.story_entities
          WHERE town_id = $1 AND entity_key = 'festival_square'`,
        [ctx.townId],
      );
      return {
        townActive: true,
        hasActiveVisit: active.rows.length > 0,
        priorAmbientJobStatus: "none",
        festivalSquareLocationId: location.rows[0]!.id,
        existingVisitId: active.rows[0]?.id ?? null,
      };
    },
    plan: planStartVisit,
    allocateInsertIds: () => ({ player_visits: randomUUID() }),
    buildResult(inputs, effects, insertIds) {
      const applied = effects.length > 0;
      const visitId = applied ? insertIds["player_visits"]! : inputs.existingVisitId!;
      return {
        disposition: applied ? "started" : "already_active",
        visitId,
        locationId: inputs.festivalSquareLocationId,
      };
    },
    reasonMessage: (code) => `Denied: ${code}`,
    resolveVisitId: (inputs, insertIds) =>
      insertIds["player_visits"] ?? inputs.existingVisitId,
  };

  type TravelTestInputs = TravelInputs;

  /**
   * `player_actions.target_entity_id` carries a real foreign key to
   * `story_entities` (`fk_player_actions__target_entity`) — a genuinely
   * unknown destination (the whole point of the `DESTINATION_UNKNOWN` case)
   * cannot be stored there. The requested id travels through
   * `requestPayload.destinationLocationId` instead (unconstrained JSON,
   * matching `ActionRequestSchema`'s own `travel` shape), and `targetEntityId`
   * is left `null` for every test call in this suite — resolving it to the
   * real entity id only when known is `P3-10`'s own policy decision to make,
   * not something this generic-executor suite needs to settle.
   */
  const travelHandler: ActionHandler<"travel", TravelTestInputs> = {
    kind: "travel",
    async loadInputs(pool, ctx) {
      const visit = await pool.query<{
        readonly id: string;
        readonly current_location_entity_id: string;
      }>(
        `SELECT id, current_location_entity_id FROM public.player_visits
          WHERE town_id = $1 AND player_id = $2 AND status = 'active'`,
        [ctx.townId, ctx.playerId],
      );
      const town = await pool.query<{ readonly revision: number }>(
        "SELECT revision FROM public.towns WHERE id = $1",
        [ctx.townId],
      );
      const destinationId = ctx.requestPayload["destinationLocationId"] as string;
      const destination = await pool.query<{ readonly id: string }>(
        "SELECT id FROM public.story_entities WHERE town_id = $1 AND id = $2",
        [ctx.townId, destinationId],
      );
      return {
        currentLocationId: visit.rows[0]!.current_location_entity_id,
        destinationLocationId: destinationId,
        destinationKnown: destination.rows.length > 0,
        destinationAccess: { state: "open" },
        visitId: visit.rows[0]!.id,
        townId: ctx.townId,
        townRevision: town.rows[0]!.revision,
      };
    },
    plan: planTravel,
    buildResult(inputs, effects) {
      const applied = effects.length > 0;
      return {
        disposition: applied ? "arrived" : "already_there",
        locationId: inputs.destinationLocationId,
      };
    },
    reasonMessage: (code) => `Denied: ${code}`,
    resolveVisitId: (inputs) => inputs.visitId,
  };

  /** A conflicting loader: bumps the town's own revision as a side effect of reading it, then hands back the now-stale value it read a moment earlier — simulating a concurrent interloper committing between load and commit. */
  function stalingTravelHandler(
    destinationId: () => string,
  ): ActionHandler<"travel", TravelTestInputs> {
    return {
      ...travelHandler,
      async loadInputs(pool, ctx) {
        const inputs = await travelHandler.loadInputs(pool, {
          ...ctx,
          requestPayload: { destinationLocationId: destinationId() },
        });
        await pool.query(
          "UPDATE public.towns SET revision = revision + 1, last_event_sequence = last_event_sequence + 1 WHERE id = $1",
          [ctx.townId],
        );
        return inputs;
      },
    };
  }

  function baseParams<K extends ActionKind, TInputs>(
    fixture: Fixture,
    handler: ActionHandler<K, TInputs>,
    actionKind: K,
    overrides: Partial<ExecuteActionParams<K, TInputs>> = {},
  ): ExecuteActionParams<K, TInputs> {
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
      ...overrides,
    };
  }

  /** Creates a real active visit through the same executor path under test, for a given player. */
  async function insertActiveVisit(
    fixture: Fixture,
    playerId: string = fixture.playerId,
  ): Promise<string> {
    const outcome = await executeAction(
      baseParams({ ...fixture, playerId }, startVisitHandler, "start_visit"),
    );
    if (outcome.kind !== "executed" || outcome.response.outcome !== "applied") {
      throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
    }
    return (outcome.response.result as { readonly visitId: string }).visitId;
  }

  it("applies start_visit, bumping revision by one and creating a real visit", async () => {
    const fixture = await fixtureTownAndPlayer();
    const before = await townRevision(fixture.townId);

    const outcome = await executeAction(
      baseParams(fixture, startVisitHandler, "start_visit"),
    );
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("applied");
    expect(
      (outcome.response as { readonly result: { readonly disposition: string } }).result
        .disposition,
    ).toBe("started");

    expect(await townRevision(fixture.townId)).toBe(before + 1);
  });

  it("returns no_change with no extra effects for a second start_visit while already active", async () => {
    const fixture = await fixtureTownAndPlayer();
    await executeAction(baseParams(fixture, startVisitHandler, "start_visit"));
    const afterFirst = await townRevision(fixture.townId);

    const outcome = await executeAction(
      baseParams(fixture, startVisitHandler, "start_visit"),
    );
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("no_change");
    expect(await townRevision(fixture.townId)).toBe(afterFirst);
  });

  it("denies travel to an unknown destination with DESTINATION_UNKNOWN, unchanged reasonCode, and no effects (acceptance 3/4)", async () => {
    const fixture = await fixtureTownAndPlayer();
    await insertActiveVisit(fixture);
    const before = await townRevision(fixture.townId);

    const outcome = await executeAction(
      baseParams(fixture, travelHandler, "travel", {
        requestPayload: { destinationLocationId: randomUUID() },
      }),
    );
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("denied");
    const result = outcome.response.result as { readonly reasonCode: string };
    expect(result.reasonCode).toBe("DESTINATION_UNKNOWN");
    expect(await townRevision(fixture.townId)).toBe(before);
  });

  it("reruns once after a town-revision conflict and then succeeds (D3-O)", async () => {
    const fixture = await fixtureTownAndPlayer();
    await insertActiveVisit(fixture);
    const destinationId = await insertStoryEntity(db().pool, fixture.townId, {
      entityType: "location",
    });
    const before = await townRevision(fixture.townId);

    let calls = 0;
    const handler: ActionHandler<"travel", TravelTestInputs> = {
      ...travelHandler,
      async loadInputs(pool, ctx) {
        calls += 1;
        const withTarget = {
          ...ctx,
          requestPayload: { destinationLocationId: destinationId },
        };
        if (calls === 1) {
          const inputs = await travelHandler.loadInputs(pool, withTarget);
          await pool.query(
            "UPDATE public.towns SET revision = revision + 1, last_event_sequence = last_event_sequence + 1 WHERE id = $1",
            [ctx.townId],
          );
          return inputs; // stale townRevision, on purpose
        }
        return travelHandler.loadInputs(pool, withTarget);
      },
    };

    const outcome = await executeAction(baseParams(fixture, handler, "travel"));
    expect(calls).toBe(2);
    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("applied");
    // The interloper's bump (+1) plus this action's own successful commit (+1).
    expect(await townRevision(fixture.townId)).toBe(before + 2);
  });

  it("stores a retryable 409 ACTION_CONFLICT after exhausting the town-revision rerun budget (acceptance 6)", async () => {
    const fixture = await fixtureTownAndPlayer();
    await insertActiveVisit(fixture);
    const destinationId = await insertStoryEntity(db().pool, fixture.townId, {
      entityType: "location",
    });

    const outcome = await executeAction(
      baseParams(
        fixture,
        stalingTravelHandler(() => destinationId),
        "travel",
      ),
    );
    expect(outcome.kind).toBe("replay");
    if (outcome.kind !== "replay") throw new Error("unreachable");
    expect(outcome.status).toBe("retryable");
    expect(outcome.responseStatus).toBe(409);
    expect(outcome.retryAfterSeconds).toBe(1);

    const row = await db().pool.query<{
      readonly status: string;
      readonly response_status: number;
      readonly error_code: string;
      readonly retry_after_at: Date;
    }>(
      "SELECT status, response_status, error_code, retry_after_at FROM public.player_actions WHERE town_id = $1 AND id = $2",
      [fixture.townId, outcome.actionId],
    );
    expect(row.rows[0]?.status).toBe("retryable");
    expect(row.rows[0]?.response_status).toBe(409);
    expect(row.rows[0]?.error_code).toBe("ACTION_CONFLICT");
    expect(row.rows[0]?.retry_after_at).toBeTruthy();
  });

  it("allocates contiguous sequence_no values with no gap under ten concurrent travels from two players (acceptance 1)", async () => {
    const fixture = await fixtureTownAndPlayer();
    const otherPlayerId = await insertPlayer(db().pool, fixture.townId);
    await insertActiveVisit(fixture);
    await insertActiveVisit(fixture, otherPlayerId);
    const locationB = await insertStoryEntity(db().pool, fixture.townId, {
      entityType: "location",
    });
    const before = await townRevision(fixture.townId);

    async function runFivetravels(playerId: string): Promise<void> {
      const destinations = [
        locationB,
        fixture.festivalSquareId,
        locationB,
        fixture.festivalSquareId,
        locationB,
      ];
      for (const destination of destinations) {
        const outcome = await executeAction({
          pool: db().pool,
          deadline: startOperationDeadline(new Date()),
          townId: fixture.townId,
          playerId,
          idempotencyKey: randomUUID(),
          actionKind: "travel",
          targetActorId: null,
          targetEntityId: null,
          requestPayload: { destinationLocationId: destination },
          handler: travelHandler,
          now: () => new Date(),
        });
        if (outcome.kind !== "executed" || outcome.response.outcome !== "applied") {
          throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
        }
      }
    }

    await Promise.all([
      runFivetravels(fixture.playerId),
      runFivetravels(otherPlayerId),
    ]);

    const after = await townRevision(fixture.townId);
    expect(after).toBe(before + 10);

    const sequences = await db().pool.query<{ readonly sequence_no: number }>(
      "SELECT sequence_no FROM public.world_events WHERE town_id = $1 AND sequence_no > $2 ORDER BY sequence_no",
      [fixture.townId, before],
    );
    const numbers = sequences.rows.map((row) => row.sequence_no);
    expect(numbers).toHaveLength(10);
    expect(new Set(numbers).size).toBe(10);
    expect(numbers[0]).toBe(before + 1);
    expect(numbers.at(-1)).toBe(before + 10);
    for (let index = 1; index < numbers.length; index += 1) {
      expect(numbers[index]).toBe(numbers[index - 1]! + 1);
    }
  });

  it("replays the stored response byte-identically for a repeated idempotency key, and validates the schema", async () => {
    const fixture = await fixtureTownAndPlayer();
    const params = baseParams(fixture, startVisitHandler, "start_visit");

    const first = await executeAction(params);
    expect(first.kind).toBe("executed");
    if (first.kind !== "executed") throw new Error("unreachable");

    const replay = await executeAction(params);
    expect(replay.kind).toBe("replay");
    if (replay.kind !== "replay") throw new Error("unreachable");
    expect(replay.status).toBe("completed");
    expect(replay.responsePayload).toStrictEqual(
      first.response satisfies CompletedActionResponse,
    );
  });

  function pausableHandler<K extends ActionKind, TInputs>(
    handler: ActionHandler<K, TInputs>,
    gate: Promise<void>,
  ): ActionHandler<K, TInputs> {
    return {
      ...handler,
      async loadInputs(pool, ctx) {
        await gate;
        return handler.loadInputs(pool, ctx);
      },
    };
  }

  it("returns processing for a same-key request while a claim is still live", async () => {
    const fixture = await fixtureTownAndPlayer();
    const idempotencyKey = randomUUID();
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const firstPromise = executeAction(
      baseParams(fixture, pausableHandler(startVisitHandler, gate), "start_visit", {
        idempotencyKey,
      }),
    );
    // Give the first call time to actually claim before the second fires.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = await executeAction(
      baseParams(fixture, startVisitHandler, "start_visit", { idempotencyKey }),
    );
    expect(second.kind).toBe("processing");

    releaseGate();
    const first = await firstPromise;
    expect(first.kind).toBe("executed");
  });

  it("returns blocked for a different key while another action is live for the same player", async () => {
    const fixture = await fixtureTownAndPlayer();
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const firstPromise = executeAction(
      baseParams(fixture, pausableHandler(startVisitHandler, gate), "start_visit"),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    const blocked = await executeAction(
      baseParams(fixture, startVisitHandler, "start_visit", {
        idempotencyKey: randomUUID(),
      }),
    );
    expect(blocked.kind).toBe("blocked");

    releaseGate();
    await firstPromise;
  });

  it("returns key_reused when the same key is submitted for a different action kind", async () => {
    const fixture = await fixtureTownAndPlayer();
    const idempotencyKey = randomUUID();

    const first = await executeAction(
      baseParams(fixture, startVisitHandler, "start_visit", { idempotencyKey }),
    );
    expect(first.kind).toBe("executed");

    const reused = await executeAction(
      baseParams(fixture, travelHandler, "travel", {
        idempotencyKey,
        requestPayload: { destinationLocationId: fixture.festivalSquareId },
      }),
    );
    expect(reused.kind).toBe("key_reused");
  });

  it("records eventMetadata through to the committed world_events row", async () => {
    const fixture = await fixtureTownAndPlayer();
    const handler: ActionHandler<"start_visit", StartVisitTestInputs> = {
      ...startVisitHandler,
      eventMetadata: (inputs) => ({
        actorId: fixture.playerId,
        locationEntityId: inputs.festivalSquareLocationId,
      }),
    };

    const outcome = await executeAction(baseParams(fixture, handler, "start_visit"));
    expect(outcome.kind).toBe("executed");

    const event = await db().pool.query<{
      readonly actor_id: string;
      readonly location_entity_id: string;
    }>(
      "SELECT actor_id, location_entity_id FROM public.world_events WHERE town_id = $1",
      [fixture.townId],
    );
    expect(event.rows[0]?.actor_id).toBe(fixture.playerId);
    expect(event.rows[0]?.location_entity_id).toBe(fixture.festivalSquareId);
  });

  it("propagates a genuine (non-conflict) database error rather than swallowing it", async () => {
    const fixture = await fixtureTownAndPlayer();
    const brokenHandler: ActionHandler<"start_visit", StartVisitTestInputs> = {
      ...startVisitHandler,
      plan(inputs) {
        const decision = planStartVisit(inputs);
        if (decision.outcome !== "applied") return decision;
        return {
          ...decision,
          effects: [
            ...decision.effects,
            {
              kind: "insert",
              table: "case_board_entries",
              // Missing the required `contributed_by_player_id` — a genuine
              // NOT NULL violation, not a revision conflict.
              row: {
                entry_kind: "note",
                verification_status: "unverified_player_note",
                note_text: "broken on purpose",
              },
            },
          ],
        };
      },
    };

    await expect(
      executeAction(baseParams(fixture, brokenHandler, "start_visit")),
    ).rejects.toThrow();
  });
});
