/**
 * End-to-end `tell` coverage (`P4-13`): the real `planTell`/`applyTellSelection`
 * pair, driven through `executeModelAction`, with a synthetic (non-Bedrock)
 * dialogue dependency — proves the full atomic commit (claim upsert,
 * transmission, episode, evidence, belief, draft confirmation), not the
 * Bedrock adapter itself (`tell-model.ts` is exercised separately, the same
 * way `ask-model.db.test.ts` exercises `ask`'s own adapter).
 */

import { randomUUID } from "node:crypto";

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

import { startOperationDeadline } from "../../deadline.js";
import { claimAction } from "../../../persistence/actions.js";
import { rateScopeKey } from "../../../persistence/rate-limits.js";
import { actionRequestHash } from "../../../security/fingerprint.js";
import type { ExecuteModelActionParams } from "../model-executor.js";
import { executeModelAction } from "../model-executor.js";
import {
  createTellActionHandler,
  type TellActionDependencies,
  type TellLoadedInputs,
} from "./tell.js";

describe.skipIf(!shouldRunDatabaseTests())("tell end to end", () => {
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

  interface DraftFixture {
    readonly townId: string;
    readonly playerId: string;
    readonly npcId: string;
    readonly npcCharacterEntityId: string;
    readonly npcLocationEntityId: string;
    readonly subjectEntityId: string;
    readonly objectEntityId: string;
    readonly draftId: string;
    readonly visitId: string;
    readonly normalizedKey: string;
  }

  async function insertSetupAction(pool: Pool, townId: string, playerId: string) {
    const npcId = await insertNpc(pool, townId);
    const claim = await claimAction(pool, {
      townId,
      playerId,
      idempotencyKey: randomUUID(),
      requestHash: actionRequestHash({
        kind: "normalize_claim",
        targetActorId: npcId,
        targetEntityId: null,
        payload: {},
      }),
      actionKind: "normalize_claim",
      requestPayload: {},
      targetActorId: npcId,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 20_000,
      requestId: "req_tell_e2e_setup",
      modelRateLimit: {
        playerScopeKey: rateScopeKey("player", townId, playerId),
        townScopeKey: rateScopeKey("town", townId, townId),
      },
    });
    if (claim.outcome !== "claimed") throw new Error("setup action was not claimed");
    // Finished immediately with a raw update — `claim_drafts.normalization_action_id`
    // and `player_visits.started_by_action_id` only need a real row to
    // reference, but `uq_player_actions__one_processing` blocks this player's
    // *next* real claim (the `tell` this fixture exists for) while any action
    // stays `processing`.
    await pool.query(
      `UPDATE public.player_actions
          SET status = 'completed', processing_token = null, processing_expires_at = null,
              outcome = 'applied', response_status = 200, response_payload = '{}',
              completed_at = now(), updated_at = now()
        WHERE town_id = $1 AND id = $2`,
      [townId, claim.actionId],
    );
    return claim.actionId;
  }

  async function insertDraft(
    pool: Pool,
    townId: string,
    playerId: string,
    npcId: string,
    npcLocationEntityId: string,
    normalizeActionId: string,
    options: {
      readonly normalizedKey: string;
      readonly expiresAt?: Date;
      readonly visitLocationEntityId?: string;
      readonly status?: string;
      /** Reuses an already-active visit instead of starting a second one (`uq_player_visits__active` allows at most one per player). */
      readonly existingVisitId?: string;
    },
  ): Promise<{ readonly draftId: string; readonly visitId: string }> {
    const visitId = options.existingVisitId ?? randomUUID();
    if (options.existingVisitId === undefined) {
      await pool.query(
        `INSERT INTO public.player_visits
           (town_id, id, player_id, current_location_entity_id, current_location_entity_type,
            status, start_revision, started_by_action_id, started_at)
         VALUES ($1, $2, $3, $4, 'location', 'active', 0, $5, now())`,
        [
          townId,
          visitId,
          playerId,
          options.visitLocationEntityId ?? npcLocationEntityId,
          normalizeActionId,
        ],
      );
    }

    const subjectEntityId = await insertStoryEntity(pool, townId, {
      entityType: "character",
      entityKey: "corin_hale",
    });
    const objectEntityId = await insertStoryEntity(pool, townId, {
      entityType: "location",
      entityKey: "lantern_inn",
    });
    const draftId = randomUUID();
    await pool.query(
      `INSERT INTO public.claim_drafts
         (town_id, id, player_id, visit_id, target_npc_id, original_text,
          subject_entity_id, subject_entity_type, predicate, object_entity_id,
          object_entity_type, polarity, context_key, normalized_key,
          alleged_source_actor_id, status, expires_at, normalization_action_id,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Corin was at the inn', $6, 'character', 'was_at',
               $7, 'location', 'positive', 'festival_night', $8,
               null, $9, $10, $11, now(), now())`,
      [
        townId,
        draftId,
        playerId,
        visitId,
        npcId,
        subjectEntityId,
        objectEntityId,
        options.normalizedKey,
        options.status ?? "pending",
        options.expiresAt ?? new Date(Date.now() + 10 * 60_000),
        normalizeActionId,
      ],
    );
    return { draftId, visitId };
  }

  async function fixtureWithDraft(
    normalizedKey: string,
    options: { readonly expiresAt?: Date } = {},
  ): Promise<DraftFixture> {
    const townId = await insertTown(db().pool);
    // `buildNpcDialogueContext#npcProfileFor` requires an authored
    // `NPC_DIALOGUE_PROFILES`/`CHARACTERS` entry, so the NPC being told must
    // use one of the three real content keys, not an arbitrary one — Nessa
    // here, distinct from the claim's own subject ("corin_hale" below).
    const npcCharacterEntityId = await insertStoryEntity(db().pool, townId, {
      entityType: "character",
      entityKey: "nessa_reed",
      displayName: "Nessa Reed",
    });
    const npcLocationEntityId = await insertStoryEntity(db().pool, townId, {
      entityType: "location",
    });
    const npcId = await insertNpc(db().pool, townId, {
      characterEntityId: npcCharacterEntityId,
      locationEntityId: npcLocationEntityId,
    });
    const playerId = await insertPlayer(db().pool, townId);
    const normalizeActionId = await insertSetupAction(db().pool, townId, playerId);
    const { draftId, visitId } = await insertDraft(
      db().pool,
      townId,
      playerId,
      npcId,
      npcLocationEntityId,
      normalizeActionId,
      { normalizedKey, ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}) },
    );

    const draftRow = await db().pool.query<{
      readonly subject_entity_id: string;
      readonly object_entity_id: string;
    }>(`SELECT subject_entity_id, object_entity_id FROM public.claim_drafts WHERE id = $1`, [
      draftId,
    ]);
    return {
      townId,
      playerId,
      npcId,
      npcCharacterEntityId,
      npcLocationEntityId,
      subjectEntityId: draftRow.rows[0]!.subject_entity_id,
      objectEntityId: draftRow.rows[0]!.object_entity_id,
      draftId,
      visitId,
      normalizedKey,
    };
  }

  function fallbackDependencies(): TellActionDependencies {
    return {
      selectDialogue: () =>
        Promise.resolve({
          npcId: randomUUID(),
          text: "I heard you. I am not ready to say what I make of it.",
          responseMode: "fallback" as const,
        }),
    };
  }

  function tellParams(
    fixture: DraftFixture,
    dependencies: TellActionDependencies,
  ): ExecuteModelActionParams<"tell", TellLoadedInputs> {
    return {
      pool: db().pool,
      deadline: startOperationDeadline(new Date()),
      townId: fixture.townId,
      playerId: fixture.playerId,
      idempotencyKey: randomUUID(),
      actionKind: "tell",
      targetActorId: fixture.npcId,
      targetEntityId: null,
      requestPayload: { claimDraftId: fixture.draftId },
      handler: createTellActionHandler(dependencies),
      now: () => new Date(),
      requestId: "req_tell_e2e",
    };
  }

  it("commits the claim, transmission, episode, evidence, belief, and draft confirmation atomically", async () => {
    const fixture = await fixtureWithDraft(`test:tell:${randomUUID()}`);
    const outcome = await executeModelAction(tellParams(fixture, fallbackDependencies()));

    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("applied");
    if (outcome.response.outcome !== "applied") throw new Error("unreachable");
    const result = outcome.response.result as {
      readonly claimDraftId: string;
      readonly claim: { readonly claimId: string; readonly text: string };
      readonly dialogue: { readonly responseMode: string };
    };
    expect(result.claimDraftId).toBe(fixture.draftId);
    expect(result.claim.text).toBe(
      "Corin Hale was at The Lantern Inn (on festival night).",
    );
    expect(result.dialogue.responseMode).toBe("fallback");
    const claimId = result.claim.claimId;

    const claimRows = await db().pool.query<{ readonly normalized_key: string }>(
      `SELECT normalized_key FROM public.claims WHERE town_id = $1 AND id = $2`,
      [fixture.townId, claimId],
    );
    expect(claimRows.rows).toStrictEqual([{ normalized_key: fixture.normalizedKey }]);

    const transmissions = await db().pool.query<{
      readonly source_kind: string;
      readonly hop_count: number;
      readonly speaker_actor_id: string;
      readonly recipient_actor_id: string;
    }>(
      `SELECT source_kind, hop_count, speaker_actor_id, recipient_actor_id
         FROM public.claim_transmissions WHERE town_id = $1 AND claim_id = $2`,
      [fixture.townId, claimId],
    );
    expect(transmissions.rows).toStrictEqual([
      {
        source_kind: "original_assertion",
        hop_count: 0,
        speaker_actor_id: fixture.playerId,
        recipient_actor_id: fixture.npcId,
      },
    ]);

    const interactions = await db().pool.query<{ readonly input_kind: string }>(
      `SELECT input_kind FROM public.npc_interactions WHERE town_id = $1 AND npc_id = $2`,
      [fixture.townId, fixture.npcId],
    );
    expect(interactions.rows).toStrictEqual([{ input_kind: "tell" }]);

    const episodes = await db().pool.query<{ readonly episode_kind: string }>(
      `SELECT episode_kind FROM public.episodes WHERE town_id = $1 AND npc_id = $2`,
      [fixture.townId, fixture.npcId],
    );
    expect(episodes.rows).toStrictEqual([{ episode_kind: "heard_claim" }]);

    const references = await db().pool.query<{ readonly reference_kind: string }>(
      `SELECT er.reference_kind FROM public.episode_references er
         JOIN public.episodes e ON e.town_id = er.town_id AND e.id = er.episode_id
        WHERE e.town_id = $1 AND e.npc_id = $2
        ORDER BY er.reference_kind`,
      [fixture.townId, fixture.npcId],
    );
    expect(references.rows.map((row) => row.reference_kind)).toStrictEqual([
      "claim",
      "location",
      "participant",
    ]);

    const evidence = await db().pool.query<{
      readonly evidence_kind: string;
      readonly signed_weight: number;
      readonly independent_source_actor_id: string | null;
    }>(
      `SELECT evidence_kind, signed_weight, independent_source_actor_id
         FROM public.belief_evidence WHERE town_id = $1 AND npc_id = $2 AND claim_id = $3`,
      [fixture.townId, fixture.npcId, claimId],
    );
    expect(evidence.rows).toStrictEqual([
      {
        evidence_kind: "player_testimony",
        signed_weight: 35,
        independent_source_actor_id: fixture.playerId,
      },
    ]);

    const belief = await db().pool.query<{ readonly score: number; readonly label: string }>(
      `SELECT score, label FROM public.npc_beliefs
        WHERE town_id = $1 AND npc_id = $2 AND claim_id = $3`,
      [fixture.townId, fixture.npcId, claimId],
    );
    expect(belief.rows).toStrictEqual([{ score: 35, label: "leaning" }]);

    const draft = await db().pool.query<{
      readonly status: string;
      readonly confirmed_claim_id: string;
      readonly confirmed_by_action_id: string;
    }>(
      `SELECT status, confirmed_claim_id, confirmed_by_action_id
         FROM public.claim_drafts WHERE town_id = $1 AND id = $2`,
      [fixture.townId, fixture.draftId],
    );
    expect(draft.rows).toStrictEqual([
      {
        status: "confirmed",
        confirmed_claim_id: claimId,
        confirmed_by_action_id: outcome.actionId,
      },
    ]);
  }, 60_000);

  it("adds no second evidence row when the same player tells the same claim again, but still confirms the second draft", async () => {
    const normalizedKey = `test:tell:${randomUUID()}`;
    const first = await fixtureWithDraft(normalizedKey);
    const firstOutcome = await executeModelAction(tellParams(first, fallbackDependencies()));
    expect(firstOutcome.kind).toBe("executed");

    const townId = first.townId;
    const setupActionId = await insertSetupAction(db().pool, townId, first.playerId);
    const { draftId: secondDraftId } = await insertDraft(
      db().pool,
      townId,
      first.playerId,
      first.npcId,
      first.npcLocationEntityId,
      setupActionId,
      { normalizedKey, existingVisitId: first.visitId },
    );

    const secondFixture: DraftFixture = { ...first, draftId: secondDraftId };
    const secondOutcome = await executeModelAction(
      tellParams(secondFixture, fallbackDependencies()),
    );
    expect(secondOutcome.kind).toBe("executed");
    if (secondOutcome.kind !== "executed") throw new Error("unreachable");
    expect(secondOutcome.response.outcome).toBe("applied");

    const claimRows = await db().pool.query<{ readonly id: string }>(
      `SELECT id FROM public.claims WHERE town_id = $1 AND normalized_key = $2`,
      [townId, normalizedKey],
    );
    expect(claimRows.rows).toHaveLength(1);

    const evidence = await db().pool.query<{ readonly evidence_kind: string }>(
      `SELECT evidence_kind FROM public.belief_evidence
        WHERE town_id = $1 AND npc_id = $2 AND claim_id = $3`,
      [townId, first.npcId, claimRows.rows[0]!.id],
    );
    expect(evidence.rows).toHaveLength(1);

    const transmissions = await db().pool.query<{ readonly id: string }>(
      `SELECT id FROM public.claim_transmissions
        WHERE town_id = $1 AND claim_id = $2`,
      [townId, claimRows.rows[0]!.id],
    );
    expect(transmissions.rows).toHaveLength(2);
  }, 60_000);

  it("denies an expired draft, creating no claim, transmission, or evidence", async () => {
    const fixture = await fixtureWithDraft(`test:tell:${randomUUID()}`, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const outcome = await executeModelAction(tellParams(fixture, fallbackDependencies()));

    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") throw new Error("unreachable");
    expect(outcome.response.outcome).toBe("denied");
    if (outcome.response.outcome !== "denied") throw new Error("unreachable");
    expect(outcome.response.result.reasonCode).toBe("CLAIM_DRAFT_EXPIRED");

    const claimRows = await db().pool.query(
      `SELECT id FROM public.claims WHERE town_id = $1 AND normalized_key = $2`,
      [fixture.townId, fixture.normalizedKey],
    );
    expect(claimRows.rows).toHaveLength(0);

    const draft = await db().pool.query<{ readonly status: string }>(
      `SELECT status FROM public.claim_drafts WHERE town_id = $1 AND id = $2`,
      [fixture.townId, fixture.draftId],
    );
    expect(draft.rows).toStrictEqual([{ status: "pending" }]);
  }, 60_000);
});
