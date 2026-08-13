import { randomUUID } from "node:crypto";

import {
  asVector256,
  type TransactionContext,
  type Vector256,
} from "@the-town-remembers/database";
import {
  createDisposableDatabase,
  insertNpc,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool, QueryResultRow } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EpisodeEmbeddingResolutionAmbiguousError,
  insertEpisode,
  markEmbeddingFailed,
  markEmbeddingReady,
  readEpisodeEmbedding,
  readPendingEmbeddings,
  type InsertEpisodeParams,
} from "./episodes.js";

function poolAsTransactionContext(pool: Pool): TransactionContext {
  return {
    async query<Row extends QueryResultRow>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<Row[]> {
      const result = await pool.query<Row>(sql, [...parameters]);
      return result.rows;
    },
  };
}

describe.skipIf(!shouldRunDatabaseTests())("episodes lifecycle", () => {
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

  async function insertEpisodeViaPool(params: InsertEpisodeParams): Promise<void> {
    await insertEpisode(poolAsTransactionContext(db().pool), params);
  }

  const NOW = new Date("2026-08-13T12:00:00.000Z");

  const worldEventSequenceByTown = new Map<string, number>();

  async function insertWorldEvent(pool: Pool, townId: string): Promise<string> {
    const eventId = randomUUID();
    const sequenceNo = (worldEventSequenceByTown.get(townId) ?? 0) + 1;
    worldEventSequenceByTown.set(townId, sequenceNo);
    await pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, $3, 'npc_interaction', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, sequenceNo, `test:${eventId}`],
    );
    return eventId;
  }

  /** A minimal `was_at` claim, satisfying `ck_claims__entity_matrix` (character subject, location object). */
  async function insertMinimalClaim(pool: Pool, townId: string): Promise<string> {
    const claimId = randomUUID();
    const subjectId = await insertStoryEntity(pool, townId, {
      entityType: "character",
    });
    const objectId = await insertStoryEntity(pool, townId, { entityType: "location" });
    await pool.query(
      `INSERT INTO public.claims
         (town_id, id, subject_entity_id, subject_entity_type, predicate,
          object_entity_id, object_entity_type, polarity, context_key,
          normalized_key, created_at)
       VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive',
               'default', $5, now())`,
      [townId, claimId, subjectId, objectId, `test:${claimId}`],
    );
    return claimId;
  }

  function baseEpisodeParams(
    overrides: Partial<InsertEpisodeParams> &
      Pick<InsertEpisodeParams, "townId" | "npcId" | "eventId">,
  ): InsertEpisodeParams {
    return {
      episodeId: randomUUID(),
      episodeKind: "direct_observation",
      summary: "Saw the chapel door left unlatched after dusk.",
      importance: 40,
      occurredAt: NOW,
      embedding: { status: "pending" },
      references: [],
      now: NOW,
      ...overrides,
    };
  }

  function fixtureVector(seed: number): Vector256 {
    return asVector256(
      Array.from({ length: 256 }, (_, index) => ((index + seed) % 11) / 11 - 0.5),
    );
  }

  async function fixtureTownAndNpc(): Promise<{
    readonly townId: string;
    readonly npcId: string;
    readonly eventId: string;
  }> {
    const townId = await insertTown(db().pool);
    const npcId = await insertNpc(db().pool, townId);
    const eventId = await insertWorldEvent(db().pool, townId);
    return { townId, npcId, eventId };
  }

  it("inserts a pending episode with no embedding", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();

    await insertEpisodeViaPool(
      baseEpisodeParams({ episodeId, townId, npcId, eventId }),
    );

    const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
    expect(row).toStrictEqual({ embedding: null, embeddingStatus: "pending" });
  });

  it("inserts a failed episode with no embedding", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();

    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId,
        townId,
        npcId,
        eventId,
        embedding: { status: "failed" },
      }),
    );

    const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
    expect(row).toStrictEqual({ embedding: null, embeddingStatus: "failed" });
  });

  it("inserts a ready episode with its embedding, round-tripping the vector exactly", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();
    const vector = fixtureVector(3);

    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId,
        townId,
        npcId,
        eventId,
        embedding: { status: "ready", embedding: vector },
      }),
    );

    const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
    expect(row?.embeddingStatus).toBe("ready");
    expect(row?.embedding).toHaveLength(256);
    for (let index = 0; index < 256; index += 1) {
      expect(row?.embedding?.[index]).toBeCloseTo(vector[index]!, 5);
    }
  });

  it("inserts entity-kind and claim-kind references together", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();
    const participantEntityId = await insertStoryEntity(db().pool, townId, {
      entityType: "character",
    });
    const claimId = await insertMinimalClaim(db().pool, townId);

    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId,
        townId,
        npcId,
        eventId,
        references: [
          { kind: "participant", entityId: participantEntityId },
          { kind: "claim", claimId },
        ],
      }),
    );

    const rows = await db().pool.query<{
      reference_kind: string;
      entity_id: string | null;
      claim_id: string | null;
    }>(
      `SELECT reference_kind, entity_id, claim_id FROM public.episode_references
        WHERE town_id = $1 AND episode_id = $2 ORDER BY reference_kind`,
      [townId, episodeId],
    );
    expect(rows.rows).toStrictEqual([
      { reference_kind: "claim", entity_id: null, claim_id: claimId },
      { reference_kind: "participant", entity_id: participantEntityId, claim_id: null },
    ]);
  });

  it("markEmbeddingReady transitions a pending episode without touching its other fields", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId,
        townId,
        npcId,
        eventId,
        summary: "A precise, unique summary for this test.",
        importance: 77,
      }),
    );

    const vector = fixtureVector(5);
    const result = await markEmbeddingReady(
      db().pool,
      Date.now() + 20_000,
      townId,
      episodeId,
      vector,
      NOW,
    );
    expect(result).toStrictEqual({ matched: true });

    const row = await db().pool.query<{
      summary: string;
      importance: number;
      npc_id: string;
      event_id: string;
    }>(
      `SELECT summary, importance, npc_id, event_id FROM public.episodes
        WHERE town_id = $1 AND id = $2`,
      [townId, episodeId],
    );
    expect(row.rows[0]).toStrictEqual({
      summary: "A precise, unique summary for this test.",
      importance: 77,
      npc_id: npcId,
      event_id: eventId,
    });
  });

  it("markEmbeddingReady also resolves a failed episode", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId,
        townId,
        npcId,
        eventId,
        embedding: { status: "failed" },
      }),
    );

    const result = await markEmbeddingReady(
      db().pool,
      Date.now() + 20_000,
      townId,
      episodeId,
      fixtureVector(1),
      NOW,
    );
    expect(result).toStrictEqual({ matched: true });
    const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
    expect(row?.embeddingStatus).toBe("ready");
  });

  it("never overwrites an already-ready episode", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();
    const firstVector = fixtureVector(1);
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId,
        townId,
        npcId,
        eventId,
        embedding: { status: "ready", embedding: firstVector },
      }),
    );

    const result = await markEmbeddingReady(
      db().pool,
      Date.now() + 20_000,
      townId,
      episodeId,
      fixtureVector(9),
      NOW,
    );
    expect(result).toStrictEqual({ matched: false });

    const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
    expect(row?.embedding?.[0]).toBeCloseTo(firstVector[0]!, 5);
  });

  it("admits exactly one write among ten concurrent markEmbeddingReady calls on the same episode", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const episodeId = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({ episodeId, townId, npcId, eventId }),
    );

    const deadlineAt = Date.now() + 30_000;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        markEmbeddingReady(
          db().pool,
          deadlineAt,
          townId,
          episodeId,
          fixtureVector(index),
          NOW,
        ),
      ),
    );

    expect(results.filter((result) => result.matched)).toHaveLength(1);
    expect(results.filter((result) => !result.matched)).toHaveLength(9);

    const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
    expect(row?.embeddingStatus).toBe("ready");
  }, 30_000);

  it("markEmbeddingFailed transitions a pending episode without touching its other fields, and never touches a ready row", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    const pendingId = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId: pendingId,
        townId,
        npcId,
        eventId,
        summary: "Untouched summary.",
        importance: 12,
      }),
    );

    const failResult = await markEmbeddingFailed(
      db().pool,
      Date.now() + 20_000,
      townId,
      pendingId,
      NOW,
    );
    expect(failResult).toStrictEqual({ matched: true });

    const row = await db().pool.query<{ summary: string; importance: number }>(
      `SELECT summary, importance FROM public.episodes WHERE town_id = $1 AND id = $2`,
      [townId, pendingId],
    );
    expect(row.rows[0]).toStrictEqual({
      summary: "Untouched summary.",
      importance: 12,
    });
    expect(
      (await readEpisodeEmbedding(db().pool, townId, pendingId))?.embeddingStatus,
    ).toBe("failed");

    const readyId = randomUUID();
    const readyVector = fixtureVector(2);
    const secondEventId = await insertWorldEvent(db().pool, townId);
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId: readyId,
        townId,
        npcId,
        eventId: secondEventId,
        embedding: { status: "ready", embedding: readyVector },
      }),
    );
    const noopResult = await markEmbeddingFailed(
      db().pool,
      Date.now() + 20_000,
      townId,
      readyId,
      NOW,
    );
    expect(noopResult).toStrictEqual({ matched: false });
    expect(
      (await readEpisodeEmbedding(db().pool, townId, readyId))?.embeddingStatus,
    ).toBe("ready");
  });

  it("readPendingEmbeddings returns only pending/failed rows for the given town, respecting the limit", async () => {
    const { townId, npcId, eventId } = await fixtureTownAndNpc();
    // Each episode below is the same (npc, event) pair with a distinct
    // episode_kind, since `uq_episodes__npc_event_kind` allows only one
    // episode per (town, npc, event, kind) — a real event producing five
    // episodes for one NPC would need five distinct kinds too.
    const kinds = [
      "direct_observation",
      "heard_claim",
      "player_interaction",
      "promise_consequence",
      "item_transfer",
    ] as const;
    const pendingIds: string[] = [];
    for (const episodeKind of kinds.slice(0, 3)) {
      const episodeId = randomUUID();
      pendingIds.push(episodeId);
      await insertEpisodeViaPool(
        baseEpisodeParams({ episodeId, townId, npcId, eventId, episodeKind }),
      );
    }
    const failedId = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId: failedId,
        townId,
        npcId,
        eventId,
        episodeKind: kinds[3],
        embedding: { status: "failed" },
      }),
    );
    const readyId = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId: readyId,
        townId,
        npcId,
        eventId,
        episodeKind: kinds[4],
        embedding: { status: "ready", embedding: fixtureVector(4) },
      }),
    );

    const page = await readPendingEmbeddings(db().pool, townId, 2);
    expect(page).toHaveLength(2);
    for (const row of page) {
      expect([...pendingIds, failedId]).toContain(row.episodeId);
    }

    const fullPage = await readPendingEmbeddings(db().pool, townId, 10);
    expect(fullPage).toHaveLength(4);
    expect(fullPage.map((row) => row.episodeId)).not.toContain(readyId);
  });

  it("scopes readPendingEmbeddings to its own town only", async () => {
    const { townId: townA, npcId: npcA, eventId: eventA } = await fixtureTownAndNpc();
    const { townId: townB, npcId: npcB, eventId: eventB } = await fixtureTownAndNpc();

    const episodeA = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId: episodeA,
        townId: townA,
        npcId: npcA,
        eventId: eventA,
      }),
    );
    const episodeB = randomUUID();
    await insertEpisodeViaPool(
      baseEpisodeParams({
        episodeId: episodeB,
        townId: townB,
        npcId: npcB,
        eventId: eventB,
      }),
    );

    const pageA = await readPendingEmbeddings(db().pool, townA, 10);
    expect(pageA.map((row) => row.episodeId)).toStrictEqual([episodeA]);
  });

  it("throws a distinguishable error only when the outcome is genuinely ambiguous", () => {
    expect(new EpisodeEmbeddingResolutionAmbiguousError("id", "settle").name).toBe(
      "EpisodeEmbeddingResolutionAmbiguousError",
    );
  });
});
