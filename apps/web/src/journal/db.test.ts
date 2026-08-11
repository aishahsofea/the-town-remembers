import { findSensitiveMarkers, SENSITIVE_TEST_MARKERS } from "@the-town-remembers/test-support";
import { afterEach, describe, expect, it } from "vitest";

import { deleteJournalEntry, readJournalEntry, writeJournalEntry } from "./db.js";

const ENTRY = {
  townId: "town-1",
  playerId: "player-1",
  idempotencyKey: "11111111-1111-1111-1111-111111111111",
  requestBody: { kind: "travel", destinationLocationId: "loc-1" } as const,
  createdAt: "2026-08-11T00:00:00.000Z",
  pollAfterMs: 2_000,
  takeoverPostSent: false,
};

afterEach(async () => {
  await deleteJournalEntry("town-1", "player-1");
  await deleteJournalEntry("town-2", "player-1");
});

describe("journal/db", () => {
  it("returns undefined for an entry that was never written", async () => {
    expect(await readJournalEntry("town-none", "player-none")).toBeUndefined();
  });

  it("round-trips a written entry exactly", async () => {
    await writeJournalEntry(ENTRY);
    expect(await readJournalEntry("town-1", "player-1")).toStrictEqual(ENTRY);
  });

  it("overwrites the entry for the same (townId, playerId) key on a second write", async () => {
    await writeJournalEntry(ENTRY);
    const updated = { ...ENTRY, actionId: "action-1" };
    await writeJournalEntry(updated);
    expect(await readJournalEntry("town-1", "player-1")).toStrictEqual(updated);
  });

  it("keeps separate players' entries independent", async () => {
    await writeJournalEntry(ENTRY);
    await writeJournalEntry({ ...ENTRY, townId: "town-2" });
    expect((await readJournalEntry("town-1", "player-1"))?.townId).toBe("town-1");
    expect((await readJournalEntry("town-2", "player-1"))?.townId).toBe("town-2");
  });

  it("deletes the entry so a later read returns undefined", async () => {
    await writeJournalEntry(ENTRY);
    await deleteJournalEntry("town-1", "player-1");
    expect(await readJournalEntry("town-1", "player-1")).toBeUndefined();
  });

  it("carries no cookie, invite token, join secret, or server credential (P3-15 acceptance 6)", async () => {
    const withMarkersInBody = {
      ...ENTRY,
      requestBody: {
        kind: "inspect" as const,
        inspectableId: SENSITIVE_TEST_MARKERS.payload,
      },
    };
    await writeJournalEntry(withMarkersInBody);
    const stored = await readJournalEntry("town-1", "player-1");

    // The whole object store dump: only the deliberately-injected payload
    // marker (proving the scan itself works) may appear — nothing else
    // this module adds ever introduces a cookie/token/secret marker.
    const dump = JSON.stringify(stored);
    expect(findSensitiveMarkers(dump)).toStrictEqual([SENSITIVE_TEST_MARKERS.payload]);
    expect(Object.keys(stored ?? {}).toSorted()).toStrictEqual(
      [
        "createdAt",
        "idempotencyKey",
        "playerId",
        "pollAfterMs",
        "requestBody",
        "takeoverPostSent",
        "townId",
      ].toSorted(),
    );
  });
});
