import { randomUUID } from "node:crypto";

import type { BedrockConverseClient } from "@the-town-remembers/model-runtime";
import { PRICE_CATALOG_VERSION } from "@the-town-remembers/model-runtime";
import type { ModelConfig } from "@the-town-remembers/runtime-config/model";
import {
  useSharedTestDatabase,
  insertNpc,
  insertPlayer,
  insertStoryEntity,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimAction } from "../../persistence/actions.js";
import { rateScopeKey } from "../../persistence/rate-limits.js";
import { actionRequestHash } from "../../security/fingerprint.js";
import { buildClaimNormalizationTrustedContext } from "./inputs/normalize-claim.js";
import { createProductionNormalizeClaimDependencies } from "./normalize-claim-model.js";
import { ModelSelectionUnavailableError } from "./model-executor.js";

const MODEL_CONFIG: ModelConfig = {
  region: "us-east-1",
  haikuModelId: "haiku-test",
  sonnetModelId: "sonnet-test",
  titanModelId: "titan-test",
  haikuInferenceProfileArn: undefined,
  sonnetInferenceProfileArn: undefined,
  priceCatalogVersion: PRICE_CATALOG_VERSION,
  reducedCostOverride: false,
  liveTestsEnabled: false,
};

function converseOutput(
  text: string,
): Awaited<ReturnType<BedrockConverseClient["send"]>> {
  return {
    stopReason: "end_turn",
    output: { message: { role: "assistant" as const, content: [{ text }] } },
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    metrics: { latencyMs: 1 },
    $metadata: {},
  };
}

const NORMALIZED_JSON = JSON.stringify({
  status: "normalized",
  subject_entity_id: "corin_hale",
  predicate: "was_at",
  object_entity_id: "lantern_inn",
  polarity: "positive",
  context_key: "festival_night",
  alleged_source_actor_id: null,
  reason_code: null,
});

const NEEDS_CLARIFICATION_JSON = JSON.stringify({
  status: "needs_clarification",
  subject_entity_id: null,
  predicate: null,
  object_entity_id: null,
  polarity: null,
  context_key: null,
  alleged_source_actor_id: null,
  reason_code: "ambiguous_subject",
});

const NORMALIZED_WITH_SOURCE_JSON = JSON.stringify({
  status: "normalized",
  subject_entity_id: "corin_hale",
  predicate: "was_at",
  object_entity_id: "lantern_inn",
  polarity: "positive",
  context_key: "festival_night",
  alleged_source_actor_id: "nessa_reed",
  reason_code: null,
});

const INVALID_JSON = JSON.stringify({
  status: "normalized",
  subject_entity_id: "not_a_real_entity",
  predicate: "was_at",
  object_entity_id: "lantern_inn",
  polarity: "positive",
  context_key: "festival_night",
  alleged_source_actor_id: null,
  reason_code: null,
});

describe.skipIf(!shouldRunDatabaseTests())("normalize_claim model selection", () => {
  let database: DisposableDatabase | undefined;

  beforeAll(async () => {
    database = await useSharedTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await database?.dispose();
  });

  function db(): DisposableDatabase {
    if (database === undefined) throw new Error("database not initialized");
    return database;
  }

  async function fixture(
    outputs: readonly (
      | "invalid"
      | "valid"
      | "valid_with_source"
      | "needs_clarification"
      | "transport_failure"
    )[],
  ) {
    const townId = await insertTown(db().pool);
    await insertStoryEntity(db().pool, townId, {
      entityType: "character",
      entityKey: "corin_hale",
    });
    await insertStoryEntity(db().pool, townId, {
      entityType: "location",
      entityKey: "lantern_inn",
    });
    const nessaCharacterId = await insertStoryEntity(db().pool, townId, {
      entityType: "character",
      entityKey: "nessa_reed",
      displayName: "Nessa Reed",
    });
    const nessaNpcId = await insertNpc(db().pool, townId, {
      characterEntityId: nessaCharacterId,
    });
    const playerId = await insertPlayer(db().pool, townId);
    const idempotencyKey = randomUUID();
    const claim = await claimAction(db().pool, {
      townId,
      playerId,
      idempotencyKey,
      requestHash: actionRequestHash({
        kind: "normalize_claim",
        targetActorId: null,
        targetEntityId: null,
        payload: { npcId: randomUUID(), text: "Corin was at the inn" },
      }),
      actionKind: "normalize_claim",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 20_000,
      requestId: "req_normalize_claim_model",
      modelRateLimit: {
        playerScopeKey: rateScopeKey("player", townId, playerId),
        townScopeKey: rateScopeKey("town", townId, townId),
      },
    });
    if (claim.outcome !== "claimed") throw new Error("action was not claimed");

    const queue = [...outputs];
    const converseClient: BedrockConverseClient = {
      send() {
        const next = queue.shift();
        if (next === undefined)
          return Promise.reject(new Error("unexpected model call"));
        if (next === "transport_failure") {
          const error = new Error("ambiguous transport failure");
          error.name = "AccessDeniedException";
          return Promise.reject(error);
        }
        const json =
          next === "valid"
            ? NORMALIZED_JSON
            : next === "valid_with_source"
              ? NORMALIZED_WITH_SOURCE_JSON
              : next === "needs_clarification"
                ? NEEDS_CLARIFICATION_JSON
                : INVALID_JSON;
        return Promise.resolve(converseOutput(json));
      },
    };
    const dependencies = createProductionNormalizeClaimDependencies({
      pool: db().pool,
      modelConfig: MODEL_CONFIG,
      converseClient,
    });
    return {
      dependencies,
      townId,
      actionId: claim.actionId,
      nessaNpcId,
      params: {
        townId,
        actionId: claim.actionId,
        trustedContext: buildClaimNormalizationTrustedContext(playerId),
        untrustedPlayerText: "Corin was at the inn",
        deadlineAt: Date.now() + 20_000,
        attempt: 0,
        now: new Date(),
      },
    };
  }

  it("normalizes a valid statement and settles the cost ledger", async () => {
    const value = await fixture(["valid"]);
    const selection = await value.dependencies.normalizeClaim(value.params);
    expect(selection.outcome.kind).toBe("normalized");
    if (selection.outcome.kind !== "normalized") throw new Error("unreachable");
    expect(selection.outcome.canonicalText).toBe(
      "Corin Hale was at The Lantern Inn (on festival night).",
    );
    expect(selection.responseMode).toBe("selected");

    const runs = await db().pool.query<{ readonly outcome: string }>(
      `SELECT outcome FROM public.agent_runs
        WHERE town_id = $1 AND player_action_id = $2`,
      [value.townId, value.actionId],
    );
    expect(runs.rows.map((row) => row.outcome)).toStrictEqual(["accepted"]);

    const reservations = await db().pool.query<{ readonly status: string }>(
      `SELECT status FROM public.model_cost_reservations
        WHERE town_id = $1 AND player_action_id = $2`,
      [value.townId, value.actionId],
    );
    expect(reservations.rows.map((row) => row.status)).toStrictEqual(["settled"]);
  }, 60_000);

  it("resolves an explicitly alleged source to this town's real NPC row", async () => {
    const value = await fixture(["valid_with_source"]);
    const selection = await value.dependencies.normalizeClaim(value.params);
    expect(selection.outcome.kind).toBe("normalized");
    if (selection.outcome.kind !== "normalized") throw new Error("unreachable");
    expect(selection.outcome.allegedSource).toStrictEqual({
      id: value.nessaNpcId,
      displayName: "Nessa Reed",
    });
  }, 60_000);

  it("repairs one invalid output and returns the repaired normalization", async () => {
    const value = await fixture(["invalid", "valid"]);
    const selection = await value.dependencies.normalizeClaim(value.params);
    expect(selection.outcome.kind).toBe("normalized");
    expect(selection.responseMode).toBe("repaired");

    const runs = await db().pool.query<{ readonly outcome: string }>(
      `SELECT outcome FROM public.agent_runs
        WHERE town_id = $1 AND player_action_id = $2 ORDER BY created_at`,
      [value.townId, value.actionId],
    );
    expect(runs.rows.map((row) => row.outcome)).toStrictEqual(["rejected", "repaired"]);
  }, 60_000);

  it("maps needs_clarification to a needs_revision outcome with no draft", async () => {
    const value = await fixture(["needs_clarification"]);
    const selection = await value.dependencies.normalizeClaim(value.params);
    expect(selection.outcome).toStrictEqual({
      kind: "needs_revision",
      explanation: "I can't tell who that's about. Try naming them directly.",
    });
  }, 60_000);

  it("throws ModelSelectionUnavailableError when repair is also invalid — no authored fallback exists", async () => {
    const value = await fixture(["invalid", "invalid"]);
    await expect(
      value.dependencies.normalizeClaim(value.params),
    ).rejects.toBeInstanceOf(ModelSelectionUnavailableError);

    const runs = await db().pool.query<{ readonly outcome: string }>(
      `SELECT outcome FROM public.agent_runs
        WHERE town_id = $1 AND player_action_id = $2 ORDER BY created_at`,
      [value.townId, value.actionId],
    );
    expect(runs.rows.map((row) => row.outcome)).toStrictEqual(["rejected", "rejected"]);
  }, 60_000);

  it("throws ModelSelectionUnavailableError on a transport failure with no raw output to repair", async () => {
    const value = await fixture(["transport_failure"]);
    await expect(
      value.dependencies.normalizeClaim(value.params),
    ).rejects.toBeInstanceOf(ModelSelectionUnavailableError);

    const reservations = await db().pool.query<{
      readonly status: string;
      readonly agent_run_id: string | null;
    }>(
      `SELECT status, agent_run_id FROM public.model_cost_reservations
        WHERE town_id = $1 AND player_action_id = $2`,
      [value.townId, value.actionId],
    );
    expect(reservations.rows).toStrictEqual([
      { status: "reserved", agent_run_id: null },
    ]);
  }, 60_000);
});
