import { createHash } from "node:crypto";

import { ACCEPTED_VIEWS } from "@the-town-remembers/database-admin";
import {
  createDisposableDatabase,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { materializeTown } from "./materialize.js";

const CREATED_AT = new Date("2026-08-08T12:00:00.000Z");
const INVITE_SALT = "inspection-secret-marker";

/**
 * The judge surface, checked against a real seeded town.
 *
 * Two things have to be true at once: the views must reconstruct the causal
 * story well enough to explain a belief, and they must expose nothing that
 * could authenticate anyone. Either one alone is easy.
 */
describe.skipIf(!shouldRunDatabaseTests())("the inspection surface", () => {
  let handle: DisposableDatabase | undefined;
  let townId: string;

  beforeAll(async () => {
    handle = await createDisposableDatabase();
    const result = await materializeTown(handle.pool, {
      contentVersion: "bell-mystery-v1",
      createdAt: CREATED_AT,
      inviteTokenHash: createHash("sha256").update(INVITE_SALT).digest(),
    });
    if (result.outcome !== "committed") throw new Error("The seed did not commit.");
    townId = result.value.townId;
  }, 180_000);

  afterAll(async () => {
    await handle?.dispose();
  });

  function database(): DisposableDatabase {
    if (!handle) throw new Error("The disposable database was not created.");
    return handle;
  }

  it("reconstructs the seeded beliefs with readable keys", async () => {
    const rows = await database().pool.query<{
      npc_key: string;
      subject_key: string;
      predicate: string;
      object_key: string;
      label: string;
      score: number;
    }>(
      `SELECT npc_key, subject_key, predicate, object_key, label, score
         FROM inspection.npc_beliefs
        WHERE town_id = $1 AND npc_key = 'nessa_reed'
        ORDER BY subject_key, predicate, object_key`,
      [townId],
    );

    expect(rows.rows).toContainEqual({
      npc_key: "nessa_reed",
      subject_key: "corin_hale",
      predicate: "acted_for",
      object_key: "public_safety",
      label: "leaning",
      score: 40,
    });
  });

  it("explains a belief through the evidence that produced it", async () => {
    const rows = await database().pool.query<{
      evidence_kind: string;
      signed_weight: number;
      trust_snapshot: number | null;
      independent_source_name: string | null;
      event_type: string;
    }>(
      `SELECT evidence_kind, signed_weight, trust_snapshot,
              independent_source_name, event_type
         FROM inspection.belief_evidence
        WHERE town_id = $1 AND npc_name = 'Nessa Reed'
          AND evidence_kind = 'npc_testimony'`,
      [townId],
    );

    expect(rows.rows).toStrictEqual([
      {
        evidence_kind: "npc_testimony",
        signed_weight: 40,
        trust_snapshot: 0,
        independent_source_name: "Corin Hale",
        event_type: "claim_transmitted",
      },
    ]);
  });

  it("shows both pre-story communications with their speakers and recipients", async () => {
    const rows = await database().pool.query<{
      speaker_name: string;
      recipient_name: string;
      source_kind: string;
      hop_count: number;
    }>(
      `SELECT speaker_name, recipient_name, source_kind, hop_count
         FROM inspection.claim_paths
        WHERE town_id = $1
        ORDER BY recipient_name`,
      [townId],
    );

    expect(rows.rows).toStrictEqual([
      {
        speaker_name: "Corin Hale",
        recipient_name: "Mara Venn",
        source_kind: "original_assertion",
        hop_count: 0,
      },
      {
        speaker_name: "Corin Hale",
        recipient_name: "Nessa Reed",
        source_kind: "original_assertion",
        hop_count: 0,
      },
    ]);
  });

  it("reports authoritative item state, not what anyone believes", async () => {
    const rows = await database().pool.query<{
      item_key: string;
      location_key: string | null;
      held_by_name: string | null;
    }>(
      `SELECT item_key, location_key, held_by_name FROM inspection.object_history
        WHERE town_id = $1 ORDER BY item_key`,
      [townId],
    );
    expect(rows.rows).toContainEqual({
      item_key: "festival_bell",
      location_key: "old_chapel",
      held_by_name: null,
    });
  });

  it("keeps the private answer inside objective_truth", async () => {
    const rows = await database().pool.query<{
      truth_key: string;
      detail_key: string;
      secondary_key: string | null;
    }>(
      `SELECT truth_key, detail_key, secondary_key FROM inspection.objective_truth
        WHERE town_id = $1 AND truth_kind = 'case_solution'`,
      [townId],
    );
    expect(rows.rows).toStrictEqual([
      {
        truth_key: "corin_hale",
        detail_key: "protect_lark",
        secondary_key: "old_chapel",
      },
    ]);
  });

  it("orders the causal spine by sequence with its seed origins", async () => {
    const rows = await database().pool.query<{
      sequence_no: number;
      origin_kind: string;
      ambient_eligible: boolean;
      effect_key: string;
    }>(
      `SELECT sequence_no, origin_kind, ambient_eligible, effect_key
         FROM inspection.world_event_timeline
        WHERE town_id = $1 ORDER BY sequence_no`,
      [townId],
    );
    expect(rows.rows).toHaveLength(11);
    expect(rows.rows.every((row) => row.origin_kind === "system_seed")).toBe(true);
    expect(rows.rows.every((row) => !row.ambient_eligible)).toBe(true);
    expect(rows.rows[0]?.effect_key).toBe(
      "seed:bell-mystery-v1:corin_saw_the_accident",
    );
  });

  it("exposes no column that could hold credential material", async () => {
    const columns = await database().pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'inspection'`,
    );
    expect(columns.rowCount).toBeGreaterThan(0);

    const forbidden = /hash|cookie|secret|password|credential|prompt_text|raw_/;
    // `input_tokens` and its siblings are measures, not credentials. A single
    // `token` is a capability; a count of them is telemetry.
    const isTokenCount = (column: string): boolean => /_tokens$/.test(column);
    const offenders = columns.rows
      .filter(
        (row) =>
          forbidden.test(row.column_name) ||
          (row.column_name.includes("token") && !isTokenCount(row.column_name)),
      )
      .map((row) => `${row.table_name}.${row.column_name}`);
    expect(offenders).toStrictEqual([]);
  });

  it("returns no value equal to the town's invite hash", async () => {
    // Selecting every view's rows as text and searching for the digest is a
    // blunt instrument on purpose: it would catch a hash smuggled through a
    // cast or a concatenation, which a column-name scan would miss.
    const digest = createHash("sha256").update(INVITE_SALT).digest("hex");
    for (const view of ACCEPTED_VIEWS) {
      const rows = await database().pool.query<{ row: string }>(
        `SELECT (t.*)::STRING AS row FROM inspection.${view} t`,
      );
      for (const row of rows.rows) {
        expect(row.row.toLowerCase(), view).not.toContain(digest);
      }
    }
  });
});
