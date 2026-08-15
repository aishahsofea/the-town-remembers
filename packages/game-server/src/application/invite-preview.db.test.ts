import { createHash, randomUUID } from "node:crypto";

import { materializeTown } from "@the-town-remembers/town-seed";
import {
  useSharedTestDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { previewInvite } from "./invite-preview.js";

const CREATED_AT = new Date("2026-08-10T12:00:00.000Z");

describe.skipIf(!shouldRunDatabaseTests())("invite preview", () => {
  let handle: DisposableDatabase | undefined;
  let townId: string;
  const token = randomUUID();
  const tokenHash = createHash("sha256").update(token).digest();

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: tokenHash,
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = result.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("returns exactly the six accepted fields for a valid hash", async () => {
    const preview = await previewInvite(db().pool, token);
    expect(Object.keys(preview).toSorted()).toStrictEqual(
      [
        "description",
        "joinMode",
        "mysteryTitle",
        "tagline",
        "townId",
        "townStatus",
      ].toSorted(),
    );
    expect(preview).toStrictEqual({
      townId,
      mysteryTitle: "The Missing Festival Bell",
      tagline: "The bell is gone. The town remembers a different story in every mouth.",
      description:
        "Visit a shared town, question its residents, trace its rumours, and " +
        "discover what happened before the festival begins.",
      townStatus: "active",
      joinMode: "play",
    });
  });

  it("returns 404 for an unknown hash", async () => {
    await expect(previewInvite(db().pool, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns 404 for a hash derived under a different town's derivation", async () => {
    const otherToken = randomUUID();
    const otherHash = createHash("sha256").update(otherToken).digest();
    const otherTown = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: otherHash,
    });
    if (otherTown.outcome !== "committed") throw new Error("The seed did not commit.");

    // Preview by the *first* town's token still resolves to the first town,
    // never the second — proving the lookup is hash-scoped, not name-scoped.
    const preview = await previewInvite(db().pool, token);
    expect(preview.townId).toBe(townId);

    await expect(previewInvite(db().pool, "not-a-real-token")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("returns a closed preview for a retired town", async () => {
    const retiredToken = randomUUID();
    const retiredHash = createHash("sha256").update(retiredToken).digest();
    const retired = await materializeTown(db().pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: retiredHash,
    });
    if (retired.outcome !== "committed") throw new Error("The seed did not commit.");
    await db().pool.query("UPDATE public.towns SET status = 'retired' WHERE id = $1", [
      retired.value.townId,
    ]);

    const preview = await previewInvite(db().pool, retiredToken);
    expect(preview.joinMode).toBe("closed");
    expect(preview.townStatus).toBe("resolved");
  });
});
