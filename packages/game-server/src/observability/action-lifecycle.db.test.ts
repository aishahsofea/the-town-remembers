/**
 * `action_lifecycle` events, asserted from captured stdout rather than a
 * spy (`P3-18` acceptance 3): a retried transaction reports its retry
 * count, a takeover reports the rejection, and — separately, since no
 * Phase 3 route can trigger a genuine ambiguous commit against a real
 * engine — a claim-level ambiguous commit reports its resolution against a
 * scripted pool (`persistence/actions.test.ts`'s own file, alongside this
 * one's real-engine cases).
 *
 * Reuses `application/actions/executor.db.test.ts`'s own conflict-then-
 * succeed and takeover fixtures rather than inventing new ones — the
 * property under test here is that the *existing, already-proven* executor
 * mechanics now also log, not that the mechanics themselves work.
 */

import { randomUUID } from "node:crypto";

import type { ActionKind } from "@the-town-remembers/http-contracts";
import {
  planStartVisit,
  planTravel,
  type StartVisitInputs,
  type TravelInputs,
} from "@the-town-remembers/rules";
import {
  createDisposableDatabase,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { captureStdout } from "@the-town-remembers/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startOperationDeadline } from "../application/deadline.js";
import {
  executeAction,
  type ActionHandler,
  type ExecuteActionParams,
} from "../application/actions/executor.js";
import { claimAction, type ClaimActionParams } from "../persistence/actions.js";
import { actionRequestHash } from "../security/fingerprint.js";

describe.skipIf(!shouldRunDatabaseTests())(
  "action_lifecycle logging (P3-18 acceptance 3)",
  () => {
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
        requestId: "req_action_lifecycle_test",
        ...overrides,
      };
    }

    async function insertActiveVisit(fixture: Fixture): Promise<void> {
      const outcome = await executeAction(
        baseParams(fixture, startVisitHandler, "start_visit"),
      );
      if (outcome.kind !== "executed" || outcome.response.outcome !== "applied") {
        throw new Error(`unexpected outcome: ${JSON.stringify(outcome)}`);
      }
    }

    it("reports its retry count when a town-revision conflict reruns the plan once and then succeeds", async () => {
      const fixture = await fixtureTownAndPlayer();
      await insertActiveVisit(fixture);
      const destinationId = await insertStoryEntity(db().pool, fixture.townId, {
        entityType: "location",
      });

      let calls = 0;
      const conflictingHandler: ActionHandler<"travel", TravelTestInputs> = {
        ...travelHandler,
        async loadInputs(pool, ctx) {
          calls += 1;
          const withTarget = {
            ...ctx,
            requestPayload: { destinationLocationId: destinationId },
          };
          if (calls === 1) {
            const inputs = await travelHandler.loadInputs(pool, withTarget);
            // The interloper: commits a town-revision bump between this load
            // and this attempt's own commit, forcing exactly one rerun.
            await pool.query(
              "UPDATE public.towns SET revision = revision + 1, last_event_sequence = last_event_sequence + 1 WHERE id = $1",
              [ctx.townId],
            );
            return inputs;
          }
          return travelHandler.loadInputs(pool, withTarget);
        },
      };

      const captured = await captureStdout(async () => {
        const outcome = await executeAction(
          baseParams(fixture, conflictingHandler, "travel", {
            requestId: "req_retry_test",
          }),
        );
        expect(outcome.kind).toBe("executed");
      });

      const retryEvent = captured.events.find(
        (event) =>
          event["event"] === "action_lifecycle" &&
          event["requestId"] === "req_retry_test" &&
          event["status"] === "conflict_retry",
      );
      expect(retryEvent).toBeDefined();
      expect(retryEvent?.["attempt"]).toBe(0);
    });

    it("reports the rejection when a stale worker's claim is superseded by a takeover", async () => {
      const townId = await insertTown(db().pool);
      const playerId = await insertPlayer(db().pool, townId);

      const requestHash = actionRequestHash({
        kind: "start_visit",
        targetActorId: null,
        targetEntityId: null,
        payload: {},
      });
      const claimedAt = new Date("2026-01-01T00:00:00.000Z");
      const params: ClaimActionParams = {
        townId,
        playerId,
        idempotencyKey: randomUUID(),
        requestHash,
        actionKind: "start_visit",
        requestPayload: {},
        targetActorId: null,
        targetEntityId: null,
        now: () => claimedAt,
        deadlineAt: Date.now() + 5_000,
        requestId: "req_takeover_test",
      };
      const first = await claimAction(db().pool, params);
      expect(first.outcome).toBe("claimed");

      const afterExpiry = new Date(claimedAt.getTime() + 40_000);
      const captured = await captureStdout(async () => {
        const second = await claimAction(db().pool, {
          ...params,
          now: () => afterExpiry,
        });
        expect(second.outcome).toBe("claimed");
      });

      const takeoverEvent = captured.events.find(
        (event) =>
          event["event"] === "action_lifecycle" &&
          event["requestId"] === "req_takeover_test" &&
          event["status"] === "takeover",
      );
      expect(takeoverEvent).toBeDefined();
    });
  },
);
