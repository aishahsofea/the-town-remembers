import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { runSerializable } from "@the-town-remembers/database";
import type { EffectPlanEntry } from "@the-town-remembers/rules";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimAction } from "../../persistence/actions.js";
import { actionRequestHash } from "../../security/fingerprint.js";
import { commitEffectPlan, RevisionConflictError } from "./commit.js";

describe.skipIf(!shouldRunDatabaseTests())("commitEffectPlan", () => {
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

  /** A fresh claimed `player_actions` row — every `world_events` insert needs one to satisfy `fk_world_events__player_action`, and a distinct idempotency key per claim keeps `uq_world_events__effect_key` from colliding across independent commits in the same test. */
  async function claimSyntheticAction(
    townId: string,
    playerId: string,
  ): Promise<{ readonly actionId: string; readonly idempotencyKey: string }> {
    const idempotencyKey = randomUUID();
    const claim = await claimAction(db().pool, {
      townId,
      playerId,
      idempotencyKey,
      requestHash: actionRequestHash({
        kind: "start_visit",
        targetActorId: null,
        targetEntityId: null,
        payload: { nonce: idempotencyKey },
      }),
      actionKind: "start_visit",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 5_000,
    });
    if (claim.outcome !== "claimed") throw new Error("unreachable");
    // Frees the ledger's one-processing-slot-per-player immediately: this
    // helper exists to hand out independent `player_actions` rows for
    // isolated `commitEffectPlan` calls, not to exercise the claim/complete
    // lifecycle itself (that's `executor.db.test.ts`'s job).
    await db().pool.query(
      `UPDATE public.player_actions
          SET status = 'completed', outcome = 'applied', response_status = 200,
              response_payload = '{}', processing_token = NULL,
              processing_expires_at = NULL, completed_at = now(), updated_at = now()
        WHERE town_id = $1 AND id = $2`,
      [townId, claim.actionId],
    );
    return { actionId: claim.actionId, idempotencyKey };
  }

  async function fixtureTownPlayerAndAction(): Promise<{
    readonly townId: string;
    readonly playerId: string;
    readonly actionId: string;
    readonly idempotencyKey: string;
    readonly locationId: string;
  }> {
    const townId = await insertTown(db().pool);
    const playerId = await insertPlayer(db().pool, townId);
    const locationId = await insertStoryEntity(db().pool, townId, {
      entityType: "location",
      entityKey: "festival_square",
    });
    const { actionId, idempotencyKey } = await claimSyntheticAction(townId, playerId);
    return { townId, playerId, actionId, idempotencyKey, locationId };
  }

  async function townRow(
    townId: string,
  ): Promise<{ readonly revision: number; readonly last_event_sequence: number }> {
    const result = await db().pool.query<{
      readonly revision: number;
      readonly last_event_sequence: number;
    }>("SELECT revision, last_event_sequence FROM public.towns WHERE id = $1", [
      townId,
    ]);
    return result.rows[0]!;
  }

  it("bumps towns.revision and last_event_sequence by exactly one, and inserts an augmented player_visits row (acceptance 1)", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const before = await townRow(fixture.townId);

    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "visit_started", effectIndex: 0 },
      {
        kind: "insert",
        table: "player_visits",
        row: { current_location_entity_id: fixture.locationId, status: "active" },
      },
    ];

    const result = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      (transaction) =>
        commitEffectPlan({
          transaction,
          townId: fixture.townId,
          playerId: fixture.playerId,
          actionId: fixture.actionId,
          idempotencyKey: fixture.idempotencyKey,
          effects,
          now: new Date(),
        }),
    );
    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("unreachable");

    const after = await townRow(fixture.townId);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.last_event_sequence).toBe(before.last_event_sequence + 1);
    expect(result.value.eventIds).toHaveLength(1);
    expect(result.value.revision).toBe(after.revision);

    const event = await db().pool.query<{
      readonly effect_key: string;
      readonly sequence_no: number;
    }>(
      "SELECT effect_key, sequence_no FROM public.world_events WHERE town_id = $1 AND id = $2",
      [fixture.townId, result.value.eventIds[0]],
    );
    expect(event.rows[0]?.effect_key).toBe(`player:${fixture.idempotencyKey}:0`);
    expect(event.rows[0]?.sequence_no).toBe(after.last_event_sequence);

    const visit = await db().pool.query<{
      readonly player_id: string;
      readonly start_revision: number;
      readonly started_by_action_id: string;
      readonly current_location_entity_type: string;
    }>(
      `SELECT player_id, start_revision, started_by_action_id, current_location_entity_type
         FROM public.player_visits WHERE town_id = $1`,
      [fixture.townId],
    );
    expect(visit.rows[0]?.player_id).toBe(fixture.playerId);
    expect(visit.rows[0]?.start_revision).toBe(after.revision);
    expect(visit.rows[0]?.started_by_action_id).toBe(fixture.actionId);
    expect(visit.rows[0]?.current_location_entity_type).toBe("location");
  });

  it("applies a guarded towns change and a same-plan player_visits update together (travel-shaped plan)", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const destinationId = await insertStoryEntity(db().pool, fixture.townId, {
      entityType: "location",
    });
    const visitId = randomUUID();
    await db().pool.query(
      `INSERT INTO public.player_visits
         (town_id, id, player_id, current_location_entity_id, current_location_entity_type,
          status, start_revision, started_by_action_id, started_at)
       VALUES ($1, $2, $3, $4, 'location', 'active', 0, $5, now())`,
      [fixture.townId, visitId, fixture.playerId, fixture.locationId, fixture.actionId],
    );
    const before = await townRow(fixture.townId);

    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "travelled", effectIndex: 0 },
      {
        kind: "conditional_state_change",
        table: "towns",
        key: { id: fixture.townId },
        expectedRevision: before.revision,
        change: {},
      },
      {
        kind: "conditional_state_change",
        table: "player_visits",
        key: { id: visitId },
        change: { current_location_entity_id: destinationId },
      },
    ];

    const result = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      (transaction) =>
        commitEffectPlan({
          transaction,
          townId: fixture.townId,
          playerId: fixture.playerId,
          actionId: fixture.actionId,
          idempotencyKey: fixture.idempotencyKey,
          effects,
          now: new Date(),
        }),
    );
    expect(result.outcome).toBe("committed");

    const after = await townRow(fixture.townId);
    expect(after.revision).toBe(before.revision + 1);

    const visit = await db().pool.query<{
      readonly current_location_entity_id: string;
    }>(
      "SELECT current_location_entity_id FROM public.player_visits WHERE town_id = $1 AND id = $2",
      [fixture.townId, visitId],
    );
    expect(visit.rows[0]?.current_location_entity_id).toBe(destinationId);
  });

  it("discards the whole plan when the town's revision no longer matches (acceptance 5)", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const before = await townRow(fixture.townId);

    // Someone else commits first, between this test's "load" and its "commit".
    await db().pool.query(
      "UPDATE public.towns SET revision = revision + 1, last_event_sequence = last_event_sequence + 1 WHERE id = $1",
      [fixture.townId],
    );

    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "travelled", effectIndex: 0 },
      {
        kind: "conditional_state_change",
        table: "towns",
        key: { id: fixture.townId },
        expectedRevision: before.revision, // stale on purpose
        change: {},
      },
    ];

    // Mirrors `executor.ts#attemptCommit`'s own pattern: a caller inside a
    // `runSerializable` body must catch `RevisionConflictError` itself and
    // return it as data — anything thrown past `runSerializable`'s own catch
    // is reclassified through `toDatabaseError`, which discards a custom
    // error's identity (the same reason `persistence/actions.ts#completeAction`
    // never throws its own error from inside a transaction body either).
    const result = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      async (transaction) => {
        try {
          await commitEffectPlan({
            transaction,
            townId: fixture.townId,
            playerId: fixture.playerId,
            actionId: fixture.actionId,
            idempotencyKey: fixture.idempotencyKey,
            effects,
            now: new Date(),
          });
          return { conflicted: false };
        } catch (error) {
          if (error instanceof RevisionConflictError) return { conflicted: true };
          throw error;
        }
      },
    );
    expect(result.outcome).toBe("committed");
    if (result.outcome === "committed") expect(result.value.conflicted).toBe(true);

    // Nothing else the plan would have written exists: no event, no second bump.
    const after = await townRow(fixture.townId);
    expect(after.revision).toBe(before.revision + 1); // only the interloper's bump
    const events = await db().pool.query(
      "SELECT id FROM public.world_events WHERE town_id = $1",
      [fixture.townId],
    );
    expect(events.rowCount).toBe(0);
  });

  it("rejects a second commit under the same idempotency key and effect index (acceptance 2)", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "visit_started", effectIndex: 0 },
      {
        kind: "insert",
        table: "player_visits",
        row: { current_location_entity_id: fixture.locationId, status: "active" },
      },
    ];
    const commitOnce = () =>
      runSerializable(db().pool, { deadlineAt: Date.now() + 5_000 }, (transaction) =>
        commitEffectPlan({
          transaction,
          townId: fixture.townId,
          playerId: fixture.playerId,
          actionId: fixture.actionId,
          idempotencyKey: fixture.idempotencyKey,
          effects,
          now: new Date(),
        }),
      );

    await expect(commitOnce()).resolves.toMatchObject({ outcome: "committed" });
    await expect(commitOnce()).rejects.toThrow();
  });

  it("refuses to interpolate an unsafe table name", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "note_added", effectIndex: 0 },
      {
        kind: "insert",
        table: "case_board_entries; DROP TABLE towns",
        row: {},
      },
    ];

    // `runSerializable` reclassifies anything thrown from its body through
    // `toDatabaseError`, discarding a custom error's message — the same
    // reason `executor.ts#attemptCommit` catches inside the body rather than
    // letting its own errors surface that way.
    const caught = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      async (transaction) => {
        try {
          await commitEffectPlan({
            transaction,
            townId: fixture.townId,
            playerId: fixture.playerId,
            actionId: fixture.actionId,
            idempotencyKey: fixture.idempotencyKey,
            effects,
            now: new Date(),
          });
          return { message: undefined };
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) };
        }
      },
    );
    expect(caught.outcome).toBe("committed");
    if (caught.outcome === "committed") {
      expect(caught.value.message).toMatch(/unsafe SQL identifier/);
    }
  });

  it("backfills the event id and created_at for an insert on a table other than player_visits", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "note_added", effectIndex: 0 },
      {
        kind: "insert",
        table: "case_board_entries",
        row: {
          entry_kind: "note",
          verification_status: "unverified_player_note",
          note_text: "hello",
          contributed_by_player_id: fixture.playerId,
        },
      },
    ];

    const result = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      (transaction) =>
        commitEffectPlan({
          transaction,
          townId: fixture.townId,
          playerId: fixture.playerId,
          actionId: fixture.actionId,
          idempotencyKey: fixture.idempotencyKey,
          effects,
          now: new Date(),
        }),
    );
    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("unreachable");

    const entry = await db().pool.query<{
      readonly source_event_id: string;
      readonly created_at: Date;
    }>(
      "SELECT source_event_id, created_at FROM public.case_board_entries WHERE town_id = $1",
      [fixture.townId],
    );
    expect(entry.rows[0]?.source_event_id).toBe(result.value.eventIds[0]);
    expect(entry.rows[0]?.created_at).toBeTruthy();
  });

  it("throws when an insert needing the plan's event runs with no preceding event_origin", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const effects: readonly EffectPlanEntry[] = [
      {
        kind: "insert",
        table: "case_board_entries",
        row: {
          entry_kind: "note",
          verification_status: "unverified_player_note",
          note_text: "hello",
          contributed_by_player_id: fixture.playerId,
        },
      },
    ];

    const caught = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      async (transaction) => {
        try {
          await commitEffectPlan({
            transaction,
            townId: fixture.townId,
            playerId: fixture.playerId,
            actionId: fixture.actionId,
            idempotencyKey: fixture.idempotencyKey,
            effects,
            now: new Date(),
          });
          return { message: undefined };
        } catch (error) {
          return { message: error instanceof Error ? error.message : String(error) };
        }
      },
    );
    expect(caught.outcome).toBe("committed");
    if (caught.outcome === "committed") {
      expect(caught.value.message).toMatch(/needs the plan's event id/);
    }
  });

  it("records eventMetadata on the world_events row", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const effects: readonly EffectPlanEntry[] = [
      { kind: "event_origin", eventType: "inspected", effectIndex: 0 },
    ];

    const result = await runSerializable(
      db().pool,
      { deadlineAt: Date.now() + 5_000 },
      (transaction) =>
        commitEffectPlan({
          transaction,
          townId: fixture.townId,
          playerId: fixture.playerId,
          actionId: fixture.actionId,
          idempotencyKey: fixture.idempotencyKey,
          effects,
          now: new Date(),
          eventMetadata: {
            actorId: fixture.playerId,
            locationEntityId: fixture.locationId,
          },
        }),
    );
    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("unreachable");

    const event = await db().pool.query<{
      readonly actor_id: string;
      readonly location_entity_id: string;
    }>(
      "SELECT actor_id, location_entity_id FROM public.world_events WHERE town_id = $1 AND id = $2",
      [fixture.townId, result.value.eventIds[0]],
    );
    expect(event.rows[0]?.actor_id).toBe(fixture.playerId);
    expect(event.rows[0]?.location_entity_id).toBe(fixture.locationId);
  });

  it("applies a guarded update on a non-towns revisioned table, and rejects a stale one (Phase 6 shape)", async () => {
    const fixture = await fixtureTownPlayerAndAction();
    const itemEntityId = await insertStoryEntity(db().pool, fixture.townId, {
      entityType: "item",
    });
    await db().pool.query(
      `INSERT INTO public.items
         (town_id, id, entity_type, location_entity_id, location_entity_type, portable,
          revision, created_at, updated_at)
       VALUES ($1, $2, 'item', $3, 'location', true, 0, now(), now())`,
      [fixture.townId, itemEntityId, fixture.locationId],
    );
    const otherLocationId = await insertStoryEntity(db().pool, fixture.townId, {
      entityType: "location",
    });

    const applyMove = async (expectedRevision: number) => {
      const attempt = await claimSyntheticAction(fixture.townId, fixture.playerId);
      return runSerializable(
        db().pool,
        { deadlineAt: Date.now() + 5_000 },
        async (transaction) => {
          try {
            const commitResult = await commitEffectPlan({
              transaction,
              townId: fixture.townId,
              playerId: fixture.playerId,
              actionId: attempt.actionId,
              idempotencyKey: attempt.idempotencyKey,
              effects: [
                { kind: "event_origin", eventType: "item_relocated", effectIndex: 0 },
                {
                  kind: "conditional_state_change",
                  table: "items",
                  key: { id: itemEntityId },
                  expectedRevision,
                  change: { location_entity_id: otherLocationId },
                },
              ],
              now: new Date(),
            });
            return { conflicted: false, commitResult };
          } catch (error) {
            if (error instanceof RevisionConflictError)
              return { conflicted: true } as const;
            throw error;
          }
        },
      );
    };

    const first = await applyMove(0);
    expect(first.outcome).toBe("committed");
    if (first.outcome !== "committed") throw new Error("unreachable");
    expect(first.value.conflicted).toBe(false);

    const item = await db().pool.query<{
      readonly location_entity_id: string;
      readonly revision: number;
    }>(
      "SELECT location_entity_id, revision FROM public.items WHERE town_id = $1 AND id = $2",
      [fixture.townId, itemEntityId],
    );
    expect(item.rows[0]?.location_entity_id).toBe(otherLocationId);
    expect(item.rows[0]?.revision).toBe(1);

    // The item is now at revision 1; retrying with the stale expectedRevision 0 conflicts.
    const second = await applyMove(0);
    expect(second.outcome).toBe("committed");
    if (second.outcome !== "committed") throw new Error("unreachable");
    expect(second.value.conflicted).toBe(true);
  });
});
