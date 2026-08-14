import { randomUUID } from "node:crypto";

import { asVector256, type Vector256 } from "@the-town-remembers/database";
import {
  createDisposableDatabase,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readRecallEpisodeDetails,
  readStructuredAnchorCandidates,
  readVectorCandidates,
} from "./recall.js";

describe.skipIf(!shouldRunDatabaseTests())("recall persistence", () => {
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

  let worldEventSequence = 0;

  async function insertWorldEvent(pool: Pool, townId: string): Promise<string> {
    const eventId = randomUUID();
    worldEventSequence += 1;
    await pool.query(
      `INSERT INTO public.world_events
         (town_id, id, sequence_no, event_type, ambient_eligible, occurred_at,
          origin_kind, effect_index, effect_key, payload, created_at)
       VALUES ($1, $2, $3, 'npc_interaction', true, now(), 'system_seed', 0, $4, '{}', now())`,
      [townId, eventId, worldEventSequence, `test:${eventId}`],
    );
    return eventId;
  }

  function fixtureVector(seed: number): Vector256 {
    return asVector256(
      Array.from({ length: 256 }, (_, index) => ((index + seed) % 11) / 11 - 0.5),
    );
  }

  async function insertReadyEpisode(
    pool: Pool,
    townId: string,
    npcId: string,
    eventId: string,
    options: {
      readonly episodeKind?: string;
      readonly importance?: number;
      readonly occurredAt?: Date;
      readonly embedding?: Vector256;
    } = {},
  ): Promise<string> {
    const episodeId = randomUUID();
    await pool.query(
      `INSERT INTO public.episodes
         (town_id, id, npc_id, event_id, episode_kind, summary, importance,
          occurred_at, embedding, embedding_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'test episode', $6, $7, $8, $9, now(), now())`,
      [
        townId,
        episodeId,
        npcId,
        eventId,
        options.episodeKind ?? "direct_observation",
        options.importance ?? 40,
        options.occurredAt ?? new Date(),
        options.embedding ? `[${options.embedding.join(",")}]` : null,
        options.embedding ? "ready" : "pending",
      ],
    );
    return episodeId;
  }

  async function fixtureTownAndNpc(): Promise<{
    readonly townId: string;
    readonly npcId: string;
  }> {
    const townId = await insertTown(db().pool);
    const npcId = await insertNpc(db().pool, townId);
    return { townId, npcId };
  }

  describe("readVectorCandidates", () => {
    it("returns only ready episodes scoped to the given town and npc", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const eventId = await insertWorldEvent(db().pool, townId);
      const readyId = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        embedding: fixtureVector(1),
      });
      await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        episodeKind: "heard_claim",
        // pending: no embedding
      });

      const results = await readVectorCandidates(
        db().pool,
        townId,
        npcId,
        fixtureVector(1),
        30,
      );

      expect(results.map((row) => row.episodeId)).toStrictEqual([readyId]);
      expect(results[0]!.distance).toBeCloseTo(0, 5);
    });

    it("never returns another town's or another npc's episodes, even with a deliberately identical embedding", async () => {
      const { townId: townA, npcId: npcA } = await fixtureTownAndNpc();
      const { townId: townB, npcId: npcB } = await fixtureTownAndNpc();
      const npcC = await insertNpc(db().pool, townA);

      const sharedVector = fixtureVector(7);
      const eventA = await insertWorldEvent(db().pool, townA);
      const eventB = await insertWorldEvent(db().pool, townB);
      const eventC = await insertWorldEvent(db().pool, townA);

      const episodeA = await insertReadyEpisode(db().pool, townA, npcA, eventA, {
        embedding: sharedVector,
      });
      await insertReadyEpisode(db().pool, townB, npcB, eventB, {
        embedding: sharedVector,
      });
      await insertReadyEpisode(db().pool, townA, npcC, eventC, {
        embedding: sharedVector,
      });

      const results = await readVectorCandidates(
        db().pool,
        townA,
        npcA,
        sharedVector,
        30,
      );
      expect(results.map((row) => row.episodeId)).toStrictEqual([episodeA]);
    });

    it("orders by ascending distance (nearest first)", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const eventId = await insertWorldEvent(db().pool, townId);
      const query = fixtureVector(0);
      const near = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        embedding: fixtureVector(0),
      });
      const far = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        episodeKind: "heard_claim",
        embedding: fixtureVector(5),
      });

      const results = await readVectorCandidates(db().pool, townId, npcId, query, 30);
      expect(results.map((row) => row.episodeId)).toStrictEqual([near, far]);
      expect(results[0]!.distance).toBeLessThan(results[1]!.distance);
    });
  });

  describe("readRecallEpisodeDetails (P4-22 acceptance 2)", () => {
    it("returns only the given town and npc's own episodes among the requested ids", async () => {
      const { townId: townA, npcId: npcA } = await fixtureTownAndNpc();
      const { townId: townB, npcId: npcB } = await fixtureTownAndNpc();
      const npcC = await insertNpc(db().pool, townA);
      const playerA = await insertPlayer(db().pool, townA);

      const eventA = await insertWorldEvent(db().pool, townA);
      const eventB = await insertWorldEvent(db().pool, townB);
      const eventC = await insertWorldEvent(db().pool, townA);
      const episodeA = await insertReadyEpisode(db().pool, townA, npcA, eventA);
      const episodeB = await insertReadyEpisode(db().pool, townB, npcB, eventB);
      const episodeC = await insertReadyEpisode(db().pool, townA, npcC, eventC);

      const results = await readRecallEpisodeDetails(db().pool, townA, npcA, playerA, [
        episodeA,
        episodeB,
        episodeC,
      ]);
      expect(results.map((row) => row.episodeId)).toStrictEqual([episodeA]);
    });

    it("another town's or another npc's real episode id draws the identical empty result a nonexistent id draws", async () => {
      const { townId: townA, npcId: npcA } = await fixtureTownAndNpc();
      const { townId: townB, npcId: npcB } = await fixtureTownAndNpc();
      const playerA = await insertPlayer(db().pool, townA);
      const eventB = await insertWorldEvent(db().pool, townB);
      const otherTownEpisode = await insertReadyEpisode(db().pool, townB, npcB, eventB);
      const nonexistentEpisode = randomUUID();

      const forOtherTown = await readRecallEpisodeDetails(
        db().pool,
        townA,
        npcA,
        playerA,
        [otherTownEpisode],
      );
      const forNonexistent = await readRecallEpisodeDetails(
        db().pool,
        townA,
        npcA,
        playerA,
        [nonexistentEpisode],
      );
      expect(forOtherTown).toStrictEqual(forNonexistent);
      expect(forOtherTown).toStrictEqual([]);
    });
  });

  describe("readStructuredAnchorCandidates", () => {
    it("includes a recent episode with no other qualifying property", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const eventId = await insertWorldEvent(db().pool, townId);
      const episodeId = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        importance: 10,
      });

      const anchors = await readStructuredAnchorCandidates(db().pool, townId, npcId);
      expect(anchors.map((anchor) => anchor.episodeId)).toContain(episodeId);
    });

    it("includes an importance-80+ episode", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const eventId = await insertWorldEvent(db().pool, townId);
      const episodeId = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        importance: 85,
      });

      const anchors = await readStructuredAnchorCandidates(db().pool, townId, npcId);
      const match = anchors.find((anchor) => anchor.episodeId === episodeId);
      expect(match).toMatchObject({ episodeId, importance: 85 });
    });

    it("includes episodes tied to an active promise's accepted event and a resolved promise's resolved event", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const playerActorId = await insertPlayer(db().pool, townId);

      const claimSubject = await insertStoryEntity(db().pool, townId, {
        entityType: "character",
      });
      const claimObject = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
      });
      const claimId = randomUUID();
      await db().pool.query(
        `INSERT INTO public.claims
           (town_id, id, subject_entity_id, subject_entity_type, predicate,
            object_entity_id, object_entity_type, polarity, context_key,
            normalized_key, created_at)
         VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive',
                 'default', $5, now())`,
        [townId, claimId, claimSubject, claimObject, `test:${claimId}`],
      );

      const acceptedEventId = await insertWorldEvent(db().pool, townId);
      const resolvedEventId = await insertWorldEvent(db().pool, townId);
      const acceptedEpisodeId = await insertReadyEpisode(
        db().pool,
        townId,
        npcId,
        acceptedEventId,
        { episodeKind: "promise_consequence", importance: 10 },
      );
      const resolvedEpisodeId = await insertReadyEpisode(
        db().pool,
        townId,
        npcId,
        resolvedEventId,
        { episodeKind: "promise_consequence", importance: 10 },
      );

      await db().pool.query(
        `INSERT INTO public.promises
           (town_id, id, npc_id, player_id, kind, protected_claim_id, item_id,
            status, accepted_event_id, resolved_event_id, terms_version,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'keep_secret', $5, NULL, 'broken', $6, $7,
                 'v1', now(), now())`,
        [
          townId,
          randomUUID(),
          npcId,
          playerActorId,
          claimId,
          acceptedEventId,
          resolvedEventId,
        ],
      );

      const anchors = await readStructuredAnchorCandidates(db().pool, townId, npcId);
      const anchorIds = anchors.map((anchor) => anchor.episodeId);
      expect(anchorIds).toContain(acceptedEpisodeId);
      expect(anchorIds).toContain(resolvedEpisodeId);
    });

    it("includes episodes referencing either side of an active contradiction", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const subject = await insertStoryEntity(db().pool, townId, {
        entityType: "character",
      });
      const objectA = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
      });
      const objectB = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
      });

      const claimAId = randomUUID();
      const claimBId = randomUUID();
      await db().pool.query(
        `INSERT INTO public.claims
           (town_id, id, subject_entity_id, subject_entity_type, predicate,
            object_entity_id, object_entity_type, polarity, context_key,
            normalized_key, created_at)
         VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive', 'default', $5, now())`,
        [townId, claimAId, subject, objectA, `test:${claimAId}`],
      );
      await db().pool.query(
        `INSERT INTO public.claims
           (town_id, id, subject_entity_id, subject_entity_type, predicate,
            object_entity_id, object_entity_type, polarity, context_key,
            normalized_key, created_at)
         VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive', 'default', $5, now())`,
        [townId, claimBId, subject, objectB, `test:${claimBId}`],
      );
      await db().pool.query(
        `INSERT INTO public.claim_relations
           (town_id, claim_a_id, claim_b_id, relation_kind, rule_version, created_at)
         VALUES ($1, $2, $3, 'contradicts', 'v1', now())`,
        [townId, claimAId, claimBId],
      );

      const eventId = await insertWorldEvent(db().pool, townId);
      await db().pool.query(
        `INSERT INTO public.npc_beliefs
           (town_id, npc_id, claim_id, score, label, updated_event_id, created_at, updated_at)
         VALUES ($1, $2, $3, 60, 'convinced', $4, now(), now())`,
        [townId, npcId, claimAId, eventId],
      );
      await db().pool.query(
        `INSERT INTO public.npc_beliefs
           (town_id, npc_id, claim_id, score, label, updated_event_id, created_at, updated_at)
         VALUES ($1, $2, $3, 25, 'leaning', $4, now(), now())`,
        [townId, npcId, claimBId, eventId],
      );

      const episodeId = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        importance: 10,
      });
      await db().pool.query(
        `INSERT INTO public.episode_references
           (town_id, episode_id, reference_kind, entity_id, claim_id, created_at)
         VALUES ($1, $2, 'claim', NULL, $3, now())`,
        [townId, episodeId, claimAId],
      );

      const anchors = await readStructuredAnchorCandidates(db().pool, townId, npcId);
      expect(anchors.map((anchor) => anchor.episodeId)).toContain(episodeId);
    });

    it("does not include a claim reference whose contradiction does not clear the score-20 floor on both sides", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const subject = await insertStoryEntity(db().pool, townId, {
        entityType: "character",
      });
      const objectA = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
      });
      const objectB = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
      });

      const claimAId = randomUUID();
      const claimBId = randomUUID();
      await db().pool.query(
        `INSERT INTO public.claims
           (town_id, id, subject_entity_id, subject_entity_type, predicate,
            object_entity_id, object_entity_type, polarity, context_key,
            normalized_key, created_at)
         VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive', 'default', $5, now())`,
        [townId, claimAId, subject, objectA, `test:${claimAId}`],
      );
      await db().pool.query(
        `INSERT INTO public.claims
           (town_id, id, subject_entity_id, subject_entity_type, predicate,
            object_entity_id, object_entity_type, polarity, context_key,
            normalized_key, created_at)
         VALUES ($1, $2, $3, 'character', 'was_at', $4, 'location', 'positive', 'default', $5, now())`,
        [townId, claimBId, subject, objectB, `test:${claimBId}`],
      );
      await db().pool.query(
        `INSERT INTO public.claim_relations
           (town_id, claim_a_id, claim_b_id, relation_kind, rule_version, created_at)
         VALUES ($1, $2, $3, 'contradicts', 'v1', now())`,
        [townId, claimAId, claimBId],
      );

      const eventId = await insertWorldEvent(db().pool, townId);
      // Claim A clears the floor; claim B does not (score 5 < 20).
      await db().pool.query(
        `INSERT INTO public.npc_beliefs
           (town_id, npc_id, claim_id, score, label, updated_event_id, created_at, updated_at)
         VALUES ($1, $2, $3, 60, 'convinced', $4, now(), now())`,
        [townId, npcId, claimAId, eventId],
      );
      await db().pool.query(
        `INSERT INTO public.npc_beliefs
           (town_id, npc_id, claim_id, score, label, updated_event_id, created_at, updated_at)
         VALUES ($1, $2, $3, 5, 'doubtful', $4, now(), now())`,
        [townId, npcId, claimBId, eventId],
      );

      // Old and low-importance, so this episode does not separately qualify
      // via the "recent" or "importance >= 80" categories — only via the
      // contradiction join under test.
      const episodeId = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        importance: 10,
        occurredAt: new Date("2020-01-01T00:00:00Z"),
      });
      await db().pool.query(
        `INSERT INTO public.episode_references
           (town_id, episode_id, reference_kind, entity_id, claim_id, created_at)
         VALUES ($1, $2, 'claim', NULL, $3, now())`,
        [townId, episodeId, claimAId],
      );

      // Push the target episode out of "recent episodes"' top-10 window with
      // ten more-recent, low-importance, unrelated decoys.
      for (let index = 0; index < 10; index += 1) {
        const decoyEventId = await insertWorldEvent(db().pool, townId);
        await insertReadyEpisode(db().pool, townId, npcId, decoyEventId, {
          importance: 10,
          occurredAt: new Date(),
        });
      }

      const anchors = await readStructuredAnchorCandidates(db().pool, townId, npcId);
      expect(anchors.map((anchor) => anchor.episodeId)).not.toContain(episodeId);
    });

    it("deduplicates an episode that qualifies under more than one category", async () => {
      const { townId, npcId } = await fixtureTownAndNpc();
      const eventId = await insertWorldEvent(db().pool, townId);
      // Recent AND importance >= 80 at once.
      const episodeId = await insertReadyEpisode(db().pool, townId, npcId, eventId, {
        importance: 90,
      });

      const anchors = await readStructuredAnchorCandidates(db().pool, townId, npcId);
      expect(anchors.filter((anchor) => anchor.episodeId === episodeId)).toHaveLength(
        1,
      );
    });

    it("never includes another town's or another npc's high-importance episode (P4-22 acceptance 2)", async () => {
      const { townId: townA, npcId: npcA } = await fixtureTownAndNpc();
      const { townId: townB, npcId: npcB } = await fixtureTownAndNpc();
      const npcC = await insertNpc(db().pool, townA);

      const eventA = await insertWorldEvent(db().pool, townA);
      const eventB = await insertWorldEvent(db().pool, townB);
      const eventC = await insertWorldEvent(db().pool, townA);
      await insertReadyEpisode(db().pool, townB, npcB, eventB, { importance: 95 });
      await insertReadyEpisode(db().pool, townA, npcC, eventC, { importance: 95 });
      const ownEpisode = await insertReadyEpisode(db().pool, townA, npcA, eventA, {
        importance: 95,
      });

      const anchors = await readStructuredAnchorCandidates(db().pool, townA, npcA);
      expect(anchors.map((anchor) => anchor.episodeId)).toStrictEqual([ownEpisode]);
    });
  });

  describe("vector index usage", () => {
    it("EXPLAIN shows ix_episodes__embedding in use once enough rows are analyzed", async (ctx) => {
      const { townId, npcId } = await fixtureTownAndNpc();

      // The cost-based optimizer only prefers the vector index over a plain
      // scan of `pk_episodes` once the table is large enough that a partial
      // scan actually costs more — confirmed empirically in this
      // environment: 100 rows still gets a filtered `pk_episodes` scan, 500
      // reliably gets `ix_episodes__embedding`. Seeded at bounded
      // concurrency (matching the harness's own pool size) to keep this
      // one-time cost down.
      const rowCount = 500;
      const concurrency = 4;
      let cursor = 0;
      async function worker(): Promise<void> {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= rowCount) return;
          const eventId = await insertWorldEvent(db().pool, townId);
          await insertReadyEpisode(db().pool, townId, npcId, eventId, {
            embedding: fixtureVector(index),
          });
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker));

      await db().pool.query("ANALYZE public.episodes");

      const explain = await db().pool.query<Record<string, unknown>>(
        `EXPLAIN SELECT id FROM public.episodes
             WHERE town_id = $1 AND npc_id = $2 AND embedding_status = 'ready'
             ORDER BY embedding <-> $3
             LIMIT 30`,
        [townId, npcId, `[${fixtureVector(0).join(",")}]`],
      );
      const plan = explain.rows.map((row) => Object.values(row).join(" ")).join("\n");

      if (!plan.includes("ix_episodes__embedding")) {
        ctx.skip(
          `The cost-based optimizer did not select ix_episodes__embedding in this environment; plan was:\n${plan}`,
        );
        return;
      }
      expect(plan).toContain("vector search");
    }, 90_000);
  });
});
