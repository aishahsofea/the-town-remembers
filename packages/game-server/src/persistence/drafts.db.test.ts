import {
  createDisposableDatabase,
  insertNpc,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveAllegedSourceActorId, resolveCanonicalEntityIds } from "./drafts.js";

describe.skipIf(!shouldRunDatabaseTests())(
  "claim normalization draft persistence",
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
  },
);
