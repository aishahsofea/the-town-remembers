import { randomUUID } from "node:crypto";

import {
  createDisposableDatabase,
  expectRejection,
  insertActor,
  insertNpc,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(!shouldRunDatabaseTests())("town, entity, and actor identity", () => {
  let handle: DisposableDatabase | undefined;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  describe("towns", () => {
    it("accepts an active town with no resolution reservation", async () => {
      const townId = await insertTown(database().pool);
      const result = await database().pool.query<{ status: string }>(
        "SELECT status FROM public.towns WHERE id = $1",
        [townId],
      );
      expect(result.rows[0]?.status).toBe("active");
    });

    it("rejects a status outside the accepted domain", async () => {
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.towns
           (id, invite_token_hash, content_version, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'bell-mystery-v1', 'paused', now(), now())`,
        [Buffer.alloc(32, 1)],
      );
      expect(rejection.constraint).toBe("ck_towns__status");
    });

    it("rejects an invite hash that is not a SHA-256 digest", async () => {
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.towns
           (id, invite_token_hash, content_version, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'bell-mystery-v1', 'active', now(), now())`,
        [Buffer.alloc(16, 1)],
      );
      expect(rejection.constraint).toBe("ck_towns__invite_token_hash_length");
    });

    it("refuses to schedule ambient work past the last appended event", async () => {
      const townId = await insertTown(database().pool);
      const rejection = await expectRejection(
        database().pool,
        `UPDATE public.towns
            SET ambient_scheduled_through_sequence = 5
          WHERE id = $1`,
        [townId],
      );
      expect(rejection.constraint).toBe("ck_towns__ambient_boundary");
    });

    it("keeps the resolution reservation absent while the town is active", async () => {
      const townId = await insertTown(database().pool);
      const rejection = await expectRejection(
        database().pool,
        `UPDATE public.towns
            SET resolution_reservation_expires_at = now()
          WHERE id = $1`,
        [townId],
      );
      expect(rejection.constraint).toBe("ck_towns__resolution_reservation");
    });

    it("requires a resolution time once the town is resolved", async () => {
      const townId = await insertTown(database().pool);
      const rejection = await expectRejection(
        database().pool,
        `UPDATE public.towns SET status = 'resolved' WHERE id = $1`,
        [townId],
      );
      // Both checks guard this transition; either one refusing is correct.
      expect(["ck_towns__resolution_reservation", "ck_towns__resolved_at"]).toContain(
        rejection.constraint,
      );
    });
  });

  describe("story entities", () => {
    it("rejects a second entity claiming one authored key", async () => {
      const townId = await insertTown(database().pool);
      await insertStoryEntity(database().pool, townId, {
        entityType: "character",
        entityKey: "mara_venn",
      });
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.story_entities
           (town_id, id, entity_type, entity_key, display_name, content_key, created_at)
         VALUES ($1, gen_random_uuid(), 'location', 'mara_venn', 'x', 'x', now())`,
        [townId],
      );
      expect(rejection.constraint).toBe("uq_story_entities__entity_key");
    });

    it("permits the same authored key in a different town", async () => {
      const first = await insertTown(database().pool);
      const second = await insertTown(database().pool);
      await insertStoryEntity(database().pool, first, {
        entityType: "character",
        entityKey: "corin_hale",
      });
      await expect(
        insertStoryEntity(database().pool, second, {
          entityType: "character",
          entityKey: "corin_hale",
        }),
      ).resolves.toBeTypeOf("string");
    });
  });

  describe("actor subtypes", () => {
    it("keeps a player actor from acquiring an NPC subtype", async () => {
      const townId = await insertTown(database().pool);
      const playerActorId = await insertActor(database().pool, townId, {
        actorType: "player",
      });
      const characterId = await insertStoryEntity(database().pool, townId, {
        entityType: "character",
      });
      const locationId = await insertStoryEntity(database().pool, townId, {
        entityType: "location",
      });

      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.npcs
           (town_id, id, character_entity_id, location_entity_id,
            profile_key, profile_version, created_at)
         VALUES ($1, $2, $3, $4, 'profile', 'v1', now())`,
        [townId, playerActorId, characterId, locationId],
      );
      expect(rejection.constraint).toBe("fk_npcs__actor");
    });

    it("keeps an NPC actor from acquiring a player subtype", async () => {
      const townId = await insertTown(database().pool);
      const npcActorId = await insertActor(database().pool, townId, {
        actorType: "npc",
      });
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.players (town_id, id, last_seen_at, created_at, updated_at)
         VALUES ($1, $2, now(), now(), now())`,
        [townId, npcActorId],
      );
      expect(rejection.constraint).toBe("fk_players__actor");
    });

    it("refuses an NPC that portrays a location instead of a character", async () => {
      const townId = await insertTown(database().pool);
      const locationId = await insertStoryEntity(database().pool, townId, {
        entityType: "location",
      });
      const actorId = await insertActor(database().pool, townId, { actorType: "npc" });

      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.npcs
           (town_id, id, character_entity_id, location_entity_id,
            profile_key, profile_version, created_at)
         VALUES ($1, $2, $3, $3, 'profile', 'v1', now())`,
        [townId, actorId, locationId],
      );
      expect(rejection.constraint).toBe("fk_npcs__character");
    });

    it("allows at most one conversational actor per authored character", async () => {
      const townId = await insertTown(database().pool);
      const characterId = await insertStoryEntity(database().pool, townId, {
        entityType: "character",
      });
      const locationId = await insertStoryEntity(database().pool, townId, {
        entityType: "location",
      });
      await insertNpc(database().pool, townId, {
        characterEntityId: characterId,
        locationEntityId: locationId,
      });
      const secondActorId = await insertActor(database().pool, townId, {
        actorType: "npc",
      });

      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.npcs
           (town_id, id, character_entity_id, location_entity_id,
            profile_key, profile_version, created_at)
         VALUES ($1, $2, $3, $4, 'profile', 'v1', now())`,
        [townId, secondActorId, characterId, locationId],
      );
      expect(rejection.constraint).toBe("uq_npcs__character");
    });

    it("lets an authored character exist with no actor at all", async () => {
      const townId = await insertTown(database().pool);
      const larkId = await insertStoryEntity(database().pool, townId, {
        entityType: "character",
        entityKey: "lark_venn",
      });
      const actors = await database().pool.query(
        "SELECT 1 FROM public.npcs WHERE town_id = $1 AND character_entity_id = $2",
        [townId, larkId],
      );
      expect(actors.rowCount).toBe(0);
    });

    it("rejects two actors whose normalized names collide", async () => {
      const townId = await insertTown(database().pool);
      await insertActor(database().pool, townId, { actorType: "player" });
      await database().pool.query(
        `INSERT INTO public.actors
           (town_id, id, actor_type, display_name, display_name_normalized, created_at)
         VALUES ($1, gen_random_uuid(), 'player', 'Mara Venn', 'mara venn', now())`,
        [townId],
      );

      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.actors
           (town_id, id, actor_type, display_name, display_name_normalized, created_at)
         VALUES ($1, gen_random_uuid(), 'npc', 'MARA  VENN', 'mara venn', now())`,
        [townId],
      );
      expect(rejection.constraint).toBe("uq_actors__display_name_normalized");
    });
  });

  describe("cross-town references", () => {
    it("refuses a subtype whose actor belongs to another town", async () => {
      const first = await insertTown(database().pool);
      const second = await insertTown(database().pool);
      const actorId = await insertActor(database().pool, first, {
        actorType: "player",
      });

      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.players (town_id, id, last_seen_at, created_at, updated_at)
         VALUES ($1, $2, now(), now(), now())`,
        [second, actorId],
      );
      expect(rejection.constraint).toBe("fk_players__actor");
    });

    it("refuses a contact edge that reaches into another town", async () => {
      const first = await insertTown(database().pool);
      const second = await insertTown(database().pool);
      const here = await insertNpc(database().pool, first);
      const elsewhere = await insertNpc(database().pool, second);

      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.npc_contact_edges
           (town_id, from_npc_id, to_npc_id, trust_score, created_at, updated_at)
         VALUES ($1, $2, $3, 30, now(), now())`,
        [first, here, elsewhere],
      );
      expect(rejection.constraint).toBe("fk_npc_contact_edges__to");
    });
  });

  describe("contact edges", () => {
    it("rejects a self edge", async () => {
      const townId = await insertTown(database().pool);
      const npcId = await insertNpc(database().pool, townId);
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.npc_contact_edges
           (town_id, from_npc_id, to_npc_id, trust_score, created_at, updated_at)
         VALUES ($1, $2, $2, 30, now(), now())`,
        [townId, npcId],
      );
      expect(rejection.constraint).toBe("ck_npc_contact_edges__distinct");
    });

    it("rejects trust outside the accepted range", async () => {
      const townId = await insertTown(database().pool);
      const from = await insertNpc(database().pool, townId);
      const to = await insertNpc(database().pool, townId);
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.npc_contact_edges
           (town_id, from_npc_id, to_npc_id, trust_score, created_at, updated_at)
         VALUES ($1, $2, $3, 101, now(), now())`,
        [townId, from, to],
      );
      expect(rejection.constraint).toBe("ck_npc_contact_edges__trust_range");
    });

    it("stores both directions independently", async () => {
      const townId = await insertTown(database().pool);
      const mara = await insertNpc(database().pool, townId);
      const nessa = await insertNpc(database().pool, townId);
      await database().pool.query(
        `INSERT INTO public.npc_contact_edges
           (town_id, from_npc_id, to_npc_id, trust_score, created_at, updated_at)
         VALUES ($1, $2, $3, 30, now(), now()), ($1, $3, $2, 20, now(), now())`,
        [townId, mara, nessa],
      );
      const result = await database().pool.query<{ trust_score: number }>(
        `SELECT trust_score FROM public.npc_contact_edges
          WHERE town_id = $1 AND from_npc_id = $2 AND to_npc_id = $3`,
        [townId, nessa, mara],
      );
      expect(result.rows[0]?.trust_score).toBe(20);
    });
  });

  describe("generated identity", () => {
    it("never lets a child row name a parent that does not exist", async () => {
      const rejection = await expectRejection(
        database().pool,
        `INSERT INTO public.actors
           (town_id, id, actor_type, display_name, display_name_normalized, created_at)
         VALUES ($1, gen_random_uuid(), 'player', 'Ghost', 'ghost', now())`,
        [randomUUID()],
      );
      expect(rejection.constraint).toBe("fk_actors__town");
    });
  });
});
