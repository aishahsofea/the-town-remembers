import { randomUUID } from "node:crypto";

import { asVector256 } from "@the-town-remembers/database";
import type { TitanEmbedClient } from "@the-town-remembers/model-runtime";
import {
  createDisposableDatabase,
  insertNpc,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  markEmbeddingReady,
  readEpisodeEmbedding,
} from "../../persistence/episodes.js";
import { runEmbedSeedCommand } from "./embed-seed.js";

function validEmbedding(seed: number): number[] {
  return Array.from({ length: 256 }, (_, index) => ((index + seed) % 11) / 11 - 0.5);
}

type TitanSendResult = Awaited<ReturnType<TitanEmbedClient["send"]>>;

/**
 * The real response `body` type is `@smithy/core`'s `Uint8ArrayBlobAdapter`
 * (a `Uint8Array` subtype with a `transformToString` method) — `game-server`
 * cannot import it directly (`D4-A`: only `model-runtime` may depend on
 * anything AWS-SDK-shaped), and a plain `Buffer` already satisfies
 * everything `titan.ts` actually reads from it. `TitanSendResult` (derived
 * from the already-imported `TitanEmbedClient` interface, never the SDK
 * package by name) is what makes this cast possible without that import —
 * the same pattern `titan.test.ts` uses for the same reason.
 */
function fixtureResponse(payload: unknown): TitanSendResult {
  return {
    $metadata: {},
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(payload), "utf8"),
  } as unknown as TitanSendResult;
}

/** Always accepts, returning a distinct deterministic vector per call. */
function alwaysSucceedsClient(): TitanEmbedClient {
  let callCount = 0;
  return {
    send() {
      callCount += 1;
      return Promise.resolve(
        fixtureResponse({
          embedding: validEmbedding(callCount),
          inputTextTokenCount: 10,
        }),
      );
    },
  };
}

function alwaysWrongDimensionClient(): TitanEmbedClient {
  return {
    send() {
      return Promise.resolve(
        fixtureResponse({ embedding: [1, 2, 3], inputTextTokenCount: 5 }),
      );
    },
  };
}

describe.skipIf(!shouldRunDatabaseTests())("embed-seed backfill", () => {
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

  const CONTENT_VERSION = `embed-seed-test-${randomUUID()}`;

  async function insertWorldEvent(
    pool: Pool,
    townId: string,
    sequenceNo: number,
  ): Promise<string> {
    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, $3, 'npc_interaction', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, sequenceNo, `test:${eventId}`],
    );
    return eventId;
  }

  async function insertPendingEpisode(
    pool: Pool,
    townId: string,
    npcId: string,
    eventId: string,
    summary: string,
  ): Promise<string> {
    const episodeId = randomUUID();
    await pool.query(
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding, embedding_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'direct_observation', $5, 30, now(), NULL, 'pending', now(), now())`,
      [townId, episodeId, npcId, eventId, summary],
    );
    return episodeId;
  }

  async function fixtureTownWithPendingEpisodes(
    count: number,
  ): Promise<{ readonly townId: string; readonly episodeIds: string[] }> {
    const townId = await insertTown(db().pool, { contentVersion: CONTENT_VERSION });
    const npcId = await insertNpc(db().pool, townId);
    const episodeIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const eventId = await insertWorldEvent(db().pool, townId, index + 1);
      episodeIds.push(
        await insertPendingEpisode(
          db().pool,
          townId,
          npcId,
          eventId,
          `Episode ${index}`,
        ),
      );
    }
    return { townId, episodeIds };
  }

  function baseParams(overrides: Partial<Parameters<typeof runEmbedSeedCommand>[0]>) {
    return {
      pool: db().pool,
      client: alwaysSucceedsClient(),
      modelId: "amazon.titan-embed-text-v2:0",
      contentVersion: CONTENT_VERSION,
      batchSize: 10,
      concurrency: 2,
      now: () => new Date(),
      callDeadlineMs: 5_000,
      reservationDeadlineMs: 20_000,
      ...overrides,
    };
  }

  it("embeds every pending episode in a town at the given content version", async () => {
    const { townId, episodeIds } = await fixtureTownWithPendingEpisodes(3);

    const result = await runEmbedSeedCommand(baseParams({ townId }));

    expect(result).toStrictEqual({ readyCount: 3, failedCount: 0, townsProcessed: 1 });
    for (const episodeId of episodeIds) {
      const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
      expect(row?.embeddingStatus).toBe("ready");
      expect(row?.embedding).toHaveLength(256);
    }
  }, 30_000);

  it("writes an agent_runs row per embedded episode carrying the embedding-purpose shape", async () => {
    const { townId } = await fixtureTownWithPendingEpisodes(1);

    await runEmbedSeedCommand(baseParams({ townId }));

    const rows = await db().pool.query<{
      purpose: string;
      outcome: string;
      prompt_sha256: Buffer | null;
      task_input_version: string | null;
      output_schema_version: string | null;
      validation_policy_version: string | null;
      world_event_id: string;
    }>(
      `SELECT purpose, outcome, prompt_sha256, task_input_version, output_schema_version,
              validation_policy_version, world_event_id
         FROM public.agent_runs WHERE town_id = $1`,
      [townId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      purpose: "episode_embedding",
      outcome: "accepted",
      prompt_sha256: null,
      task_input_version: null,
      output_schema_version: null,
      validation_policy_version: null,
    });
    expect(rows.rows[0]!.world_event_id).toBeTruthy();
  }, 30_000);

  it("marks a wrong-dimension response as failed, releases its reservation, and touches no other episode field", async () => {
    const { townId, episodeIds } = await fixtureTownWithPendingEpisodes(1);
    const [episodeId] = episodeIds;

    const result = await runEmbedSeedCommand(
      baseParams({ townId, client: alwaysWrongDimensionClient() }),
    );

    expect(result).toStrictEqual({ readyCount: 0, failedCount: 1, townsProcessed: 1 });
    const row = await readEpisodeEmbedding(db().pool, townId, episodeId!);
    expect(row).toStrictEqual({ embedding: null, embeddingStatus: "failed" });

    const reservation = await db().pool.query<{ status: string; actual_cost: string }>(
      `SELECT status, actual_cost FROM public.model_cost_reservations
        WHERE town_id = $1 AND purpose = 'episode_embedding'`,
      [townId],
    );
    expect(reservation.rows[0]).toStrictEqual({
      status: "released",
      actual_cost: "0.000000",
    });
  }, 30_000);

  it("is resumable: a run only embeds episodes still pending, and re-embeds none already ready", async () => {
    const { townId, episodeIds } = await fixtureTownWithPendingEpisodes(4);

    // Simulate "a first run got this far before being killed": two of the
    // four episodes are already `ready`, resolved outside this run entirely
    // (an earlier process's own commits, exactly what a kill would leave
    // behind — this run must not know or care how they got that way).
    const alreadyReady = episodeIds.slice(0, 2);
    const stillPending = episodeIds.slice(2);
    for (const [index, episodeId] of alreadyReady.entries()) {
      await markEmbeddingReady(
        db().pool,
        Date.now() + 20_000,
        townId,
        episodeId,
        asVector256(validEmbedding(index)),
        new Date(),
      );
    }

    const result = await runEmbedSeedCommand(baseParams({ townId }));

    expect(result).toStrictEqual({ readyCount: 2, failedCount: 0, townsProcessed: 1 });
    for (const episodeId of episodeIds) {
      const row = await readEpisodeEmbedding(db().pool, townId, episodeId);
      expect(row?.embeddingStatus).toBe("ready");
    }

    // Only the two genuinely processed by this run got an agent_runs row —
    // the two pre-seeded as `ready` were never touched, let alone re-embedded.
    const runs = await db().pool.query<{ world_event_id: string }>(
      `SELECT world_event_id FROM public.agent_runs
        WHERE town_id = $1 AND purpose = 'episode_embedding'`,
      [townId],
    );
    expect(runs.rows).toHaveLength(2);

    const stillPendingEventIds = await db().pool.query<{ event_id: string }>(
      `SELECT event_id FROM public.episodes WHERE town_id = $1 AND id = ANY($2)`,
      [townId, stillPending],
    );
    const runEventIds = new Set(runs.rows.map((row) => row.world_event_id));
    for (const row of stillPendingEventIds.rows) {
      expect(runEventIds.has(row.event_id)).toBe(true);
    }
  }, 30_000);

  it("never processes a town at a different content version", async () => {
    // A version unique to this test, not the shared `CONTENT_VERSION` other
    // tests in this file also use — scanning "every town at this version"
    // (no explicit `townId`) must only ever see what this test itself
    // created, never another test's towns sharing the module-level constant.
    const scanVersion = `${CONTENT_VERSION}-scan-${randomUUID()}`;
    const otherVersion = `${scanVersion}-other`;

    const otherTownId = await insertTown(db().pool, { contentVersion: otherVersion });
    const npcId = await insertNpc(db().pool, otherTownId);
    const eventId = await insertWorldEvent(db().pool, otherTownId, 1);
    const episodeId = await insertPendingEpisode(
      db().pool,
      otherTownId,
      npcId,
      eventId,
      "Should never be touched.",
    );

    const result = await runEmbedSeedCommand(
      baseParams({ contentVersion: scanVersion }),
    );

    expect(result.townsProcessed).toBe(0);
    const row = await readEpisodeEmbedding(db().pool, otherTownId, episodeId);
    expect(row?.embeddingStatus).toBe("pending");
  }, 30_000);
});
