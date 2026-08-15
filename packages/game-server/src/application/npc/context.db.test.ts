import { createHash, randomUUID } from "node:crypto";

import {
  useSharedTestDatabase,
  insertPlayer,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { materializeTown, type MaterializedTown } from "@the-town-remembers/town-seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadDisclosureSources } from "./context.js";

describe.skipIf(!shouldRunDatabaseTests())("loadDisclosureSources", () => {
  let handle: DisposableDatabase | undefined;
  let town: MaterializedTown | undefined;
  let playerId: string | undefined;

  beforeAll(async () => {
    handle = await useSharedTestDatabase();
    const inviteToken = randomUUID();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: new Date(),
      inviteTokenHash: createHash("sha256").update(inviteToken).digest(),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    town = result.value;
    playerId = await insertPlayer(handle.pool, town.townId);
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function db(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  function seededTown(): MaterializedTown {
    if (!town) throw new Error("The town was not materialized.");
    return town;
  }

  function player(): string {
    if (!playerId) throw new Error("The player was not created.");
    return playerId;
  }

  it("resolves Mara's direct_observation and heard_claim rows against the real seed", async () => {
    const seeded = seededTown();
    const npcId = seeded.ids.get("actor:mara_venn");
    if (npcId === undefined) throw new Error("Missing seeded Mara actor ID.");

    const loaded = await loadDisclosureSources({
      pool: db().pool,
      townId: seeded.townId,
      npcId,
      npcKey: "mara_venn",
      playerId: player(),
    });

    const damagedBell = loaded.sources.find(
      (source) => source.claimKey === "lark_damaged_bell",
    );
    expect(damagedBell?.claimId).toBe(seeded.ids.get("claim:lark_damaged_bell"));
    expect(damagedBell?.grounding).toMatchObject({ kind: "direct_observation" });

    // Both authored tiers of `corin_protected_lark` resolve — same claim ID,
    // same heard_claim grounding, distinct tiers (guarded and confidential).
    const protectedLark = loaded.sources.filter(
      (source) => source.claimKey === "corin_protected_lark",
    );
    expect(protectedLark).toHaveLength(2);
    expect(new Set(protectedLark.map((source) => source.tier))).toEqual(
      new Set(["guarded", "confidential"]),
    );
    for (const source of protectedLark) {
      expect(source.claimId).toBe(seeded.ids.get("claim:corin_protected_lark"));
      expect(source.grounding).toEqual({
        kind: "heard_claim",
        episodeId: seeded.ids.get("episode:mara_heard_corins_offer"),
        parentTransmissionId: seeded.ids.get(
          "transmission:corin_told_mara_he_would_protect_lark",
        ),
      });
    }
  });

  it("reads real belief scores from the seed, not defaults", async () => {
    const seeded = seededTown();
    const npcId = seeded.ids.get("actor:mara_venn");
    if (npcId === undefined) throw new Error("Missing seeded Mara actor ID.");
    const claimId = seeded.ids.get("claim:lark_damaged_bell");
    if (claimId === undefined) throw new Error("Missing seeded claim ID.");

    const loaded = await loadDisclosureSources({
      pool: db().pool,
      townId: seeded.townId,
      npcId,
      npcKey: "mara_venn",
      playerId: player(),
    });

    // Direct observation alone is worth +80 (`DIRECT_OBSERVATION_WEIGHT`);
    // a default of 0 would mean the read silently fell through to "no
    // evidence" instead of the real seeded row.
    expect(loaded.beliefByClaimId.get(claimId)?.score).toBeGreaterThan(0);
  });

  it("defaults relationship and grievance state for a player who never interacted", async () => {
    const seeded = seededTown();
    const npcId = seeded.ids.get("actor:corin_hale");
    if (npcId === undefined) throw new Error("Missing seeded Corin actor ID.");

    const loaded = await loadDisclosureSources({
      pool: db().pool,
      townId: seeded.townId,
      npcId,
      npcKey: "corin_hale",
      playerId: player(),
    });

    expect(loaded.relationship).toEqual({ trust: 0, suspicion: 0 });
    expect(loaded.everBrokenPromiseToThisNpc).toBe(false);
  });
});
