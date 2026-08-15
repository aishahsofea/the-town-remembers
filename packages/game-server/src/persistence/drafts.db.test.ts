import { randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimAction } from "./actions.js";
import { rateScopeKey } from "./rate-limits.js";
import { actionRequestHash } from "../security/fingerprint.js";
import {
  readDraftForPlayer,
  resolveAllegedSourceActorId,
  resolveCanonicalEntityIds,
  resolveEntityKeysByIds,
} from "./drafts.js";

describe.skipIf(!shouldRunDatabaseTests())(
  "claim normalization draft persistence",
  () => {
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

    it("resolves exactly the requested entity keys to this town's rows", async () => {
      const townId = await insertTown(db().pool);
      const characterId = await insertStoryEntity(db().pool, townId, {
        entityType: "character",
        entityKey: "corin_hale",
      });
      const locationId = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
        entityKey: "lantern_inn",
      });
      // A third entity exists in this town but is never asked for.
      await insertStoryEntity(db().pool, townId, {
        entityType: "item",
        entityKey: "old_chapel_key",
      });

      const resolved = await resolveCanonicalEntityIds(db().pool, townId, [
        "corin_hale",
        "lantern_inn",
      ]);

      expect(resolved.size).toBe(2);
      expect(resolved.get("corin_hale")).toStrictEqual({
        id: characterId,
        entityType: "character",
      });
      expect(resolved.get("lantern_inn")).toStrictEqual({
        id: locationId,
        entityType: "location",
      });
      expect(resolved.get("old_chapel_key")).toBeUndefined();
    });

    it("returns an empty map for an empty key list without querying", async () => {
      const townId = await insertTown(db().pool);
      const resolved = await resolveCanonicalEntityIds(db().pool, townId, []);
      expect(resolved.size).toBe(0);
    });

    it("resolves an alleged source NPC by its character's content-stable key", async () => {
      const townId = await insertTown(db().pool);
      const characterId = await insertStoryEntity(db().pool, townId, {
        entityType: "character",
        entityKey: "nessa_reed",
      });
      const npcId = await insertNpc(db().pool, townId, {
        characterEntityId: characterId,
      });

      const resolved = await resolveAllegedSourceActorId(
        db().pool,
        townId,
        "nessa_reed",
      );
      expect(resolved).toBe(npcId);
    });

    it("resolves to undefined for a character key with no NPC row", async () => {
      const townId = await insertTown(db().pool);
      await insertStoryEntity(db().pool, townId, {
        entityType: "character",
        entityKey: "lark_venn",
      });

      const resolved = await resolveAllegedSourceActorId(
        db().pool,
        townId,
        "lark_venn",
      );
      expect(resolved).toBeUndefined();
    });

    it("scopes resolution to the requesting town only", async () => {
      const townA = await insertTown(db().pool);
      const townB = await insertTown(db().pool);
      await insertStoryEntity(db().pool, townA, {
        entityType: "character",
        entityKey: "corin_hale",
      });

      const resolved = await resolveCanonicalEntityIds(db().pool, townB, [
        "corin_hale",
      ]);
      expect(resolved.size).toBe(0);
    });

    it("resolves this town's real story_entities ids back to their content keys", async () => {
      const townId = await insertTown(db().pool);
      const characterId = await insertStoryEntity(db().pool, townId, {
        entityType: "character",
        entityKey: "corin_hale",
      });
      const locationId = await insertStoryEntity(db().pool, townId, {
        entityType: "location",
        entityKey: "lantern_inn",
      });

      const resolved = await resolveEntityKeysByIds(db().pool, townId, [
        characterId,
        locationId,
      ]);
      expect(resolved.get(characterId)).toBe("corin_hale");
      expect(resolved.get(locationId)).toBe("lantern_inn");
    });

    it("returns an empty map for an empty id list without querying", async () => {
      const townId = await insertTown(db().pool);
      expect(await resolveEntityKeysByIds(db().pool, townId, [])).toStrictEqual(
        new Map(),
      );
    });

    it("reads a pending draft scoped to the confirming player, undefined for another player's draft id", async () => {
      const pool: Pool = db().pool;
      const townId = await insertTown(pool);
      const characterId = await insertStoryEntity(pool, townId, {
        entityType: "character",
        entityKey: "corin_hale",
      });
      const npcId = await insertNpc(pool, townId, { characterEntityId: characterId });
      const locationId = await insertStoryEntity(pool, townId, {
        entityType: "location",
      });
      const subjectId = await insertStoryEntity(pool, townId, {
        entityType: "character",
      });
      const objectId = await insertStoryEntity(pool, townId, {
        entityType: "location",
      });
      const playerId = await insertPlayer(pool, townId);
      const otherPlayerId = await insertPlayer(pool, townId);

      const claim = await claimAction(pool, {
        townId,
        playerId,
        idempotencyKey: randomUUID(),
        requestHash: actionRequestHash({
          kind: "normalize_claim",
          targetActorId: npcId,
          targetEntityId: null,
          payload: { npcId, text: "Corin was at the inn" },
        }),
        actionKind: "normalize_claim",
        requestPayload: {},
        targetActorId: npcId,
        targetEntityId: null,
        now: () => new Date(),
        deadlineAt: Date.now() + 20_000,
        requestId: "req_drafts_test",
        modelRateLimit: {
          playerScopeKey: rateScopeKey("player", townId, playerId),
          townScopeKey: rateScopeKey("town", townId, townId),
        },
      });
      if (claim.outcome !== "claimed") throw new Error("action was not claimed");
      const normalizeActionId = claim.actionId;
      const visitId = randomUUID();
      await pool.query(
        `INSERT INTO public.player_visits
           (town_id, id, player_id, current_location_entity_id, current_location_entity_type,
            status, start_revision, started_by_action_id, started_at)
         VALUES ($1, $2, $3, $4, 'location', 'active', 0, $5, now())`,
        [townId, visitId, playerId, locationId, normalizeActionId],
      );
      const draftId = randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      await pool.query(
        `INSERT INTO public.claim_drafts
           (town_id, id, player_id, visit_id, target_npc_id, original_text,
            subject_entity_id, subject_entity_type, predicate, object_entity_id,
            object_entity_type, polarity, context_key, normalized_key,
            alleged_source_actor_id, status, expires_at, normalization_action_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Corin was at the inn', $6, 'character', 'was_at',
                 $7, 'location', 'positive', 'festival_night', 'test-normalized-key',
                 null, 'pending', $8, $9, now(), now())`,
        [
          townId,
          draftId,
          playerId,
          visitId,
          npcId,
          subjectId,
          objectId,
          expiresAt,
          normalizeActionId,
        ],
      );

      const read = await readDraftForPlayer(pool, townId, draftId, playerId);
      expect(read).toMatchObject({
        id: draftId,
        playerId,
        visitId,
        targetNpcId: npcId,
        subjectEntityId: subjectId,
        objectEntityId: objectId,
        predicate: "was_at",
        polarity: "positive",
        contextKey: "festival_night",
        normalizedKey: "test-normalized-key",
        allegedSourceActorId: null,
        status: "pending",
      });

      expect(
        await readDraftForPlayer(pool, townId, draftId, otherPlayerId),
      ).toBeUndefined();
      expect(
        await readDraftForPlayer(pool, townId, randomUUID(), playerId),
      ).toBeUndefined();
    });
  },
);
