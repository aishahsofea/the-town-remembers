import { randomUUID } from "node:crypto";

import type {
  BedrockConverseClient,
  TitanEmbedClient,
} from "@the-town-remembers/model-runtime";
import { PRICE_CATALOG_VERSION } from "@the-town-remembers/model-runtime";
import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";
import { planAsk, type ExternalSelectionRequired } from "@the-town-remembers/rules";
import type { ModelConfig } from "@the-town-remembers/runtime-config/model";
import {
  createDisposableDatabase,
  insertPlayer,
  insertTown,
  shouldRunDatabaseTests,
  type DisposableDatabase,
} from "@the-town-remembers/test-support/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildNpcDialogueContext } from "../npc/context.js";
import { claimAction } from "../../persistence/actions.js";
import { rateScopeKey } from "../../persistence/rate-limits.js";
import { actionRequestHash } from "../../security/fingerprint.js";
import { createProductionAskDependencies } from "./ask-model.js";

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
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    metrics: { latencyMs: 1 },
    $metadata: {},
  };
}

describe.skipIf(!shouldRunDatabaseTests())("Ask model selection and repair", () => {
  let database: DisposableDatabase | undefined;

  beforeAll(async () => {
    database = await createDisposableDatabase();
  }, 180_000);

  afterAll(async () => {
    await database?.dispose();
  });

  function db(): DisposableDatabase {
    if (database === undefined) throw new Error("database not initialized");
    return database;
  }

  async function fixture(
    outputs: readonly ("invalid" | "valid" | "transport_failure")[],
  ) {
    const townId = await insertTown(db().pool);
    const playerId = await insertPlayer(db().pool, townId);
    const idempotencyKey = randomUUID();
    const claim = await claimAction(db().pool, {
      townId,
      playerId,
      idempotencyKey,
      requestHash: actionRequestHash({
        kind: "ask",
        targetActorId: null,
        targetEntityId: null,
        payload: { npcId: randomUUID(), question: "What happened?" },
      }),
      actionKind: "ask",
      requestPayload: {},
      targetActorId: null,
      targetEntityId: null,
      now: () => new Date(),
      deadlineAt: Date.now() + 20_000,
      requestId: "req_ask_model",
      modelRateLimit: {
        playerScopeKey: rateScopeKey("player", townId, playerId),
        townScopeKey: rateScopeKey("town", townId, townId),
      },
    });
    if (claim.outcome !== "claimed") throw new Error("action was not claimed");

    const pending = planAsk({
      npcPresent: true,
      disclosureCandidates: [],
      requiredDisclosureIds: [],
      approvedOutcomes: [],
      requiredOutcomeIds: [],
      approvedEpisodes: [],
    }) as ExternalSelectionRequired;
    const npcId = randomUUID();
    const assembled = buildNpcDialogueContext({
      npcKey: "mara_venn",
      npcId,
      currentLocationId: randomUUID(),
      disclosureSources: [],
      content: BELL_MYSTERY_V1,
      disclosureGateContext: {
        isRelevantToRequest: () => false,
        trust: 0,
        suspicion: 0,
        verifiedCluePresentedThisAction: false,
        everBrokenPromiseToThisNpc: false,
        confrontationGateOpen: false,
        beliefByClaimId: new Map(),
      },
      disclosureBundle: pending.trustedContext,
      playerAction: { actionKind: "ask", targetEntityIds: [] },
      dialogueDirective: { requiredAct: "Deflect without disclosure." },
      allowedResponseKinds: ["deflect"],
      canonicalEntities: [],
      approvedActors: [],
      untrustedPlayerText: "What happened?",
    });
    const renderingId = assembled.trustedContext.approved_renderings[0]!.rendering_id;
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
        return Promise.resolve(
          converseOutput(
            JSON.stringify({
              response_kind: "deflect",
              rendering_ids: [next === "valid" ? renderingId : "not-approved"],
            }),
          ),
        );
      },
    };
    const titanClient: TitanEmbedClient = {
      send() {
        return Promise.reject(new Error("Titan is not used by this test"));
      },
    };
    const dependencies = createProductionAskDependencies({
      pool: db().pool,
      modelConfig: MODEL_CONFIG,
      converseClient,
      titanClient,
    });
    return {
      dependencies,
      params: {
        townId,
        actionId: claim.actionId,
        npcKey: "mara_venn",
        assembled,
        pending,
        deadlineAt: Date.now() + 20_000,
        attempt: 0,
        now: new Date(),
      },
      actionId: claim.actionId,
    };
  }

  it("repairs one invalid selection and returns only the authored rendering", async () => {
    const value = await fixture(["invalid", "valid"]);
    const selection = await value.dependencies.selectDialogue(value.params);
    expect(selection.responseMode).toBe("repaired");
    expect(selection.text).toBe(
      "There is too much frightened talk already. Ask me about one thing at a time, and I will tell you what I can.",
    );
    expect(selection.expressedDisclosures).toStrictEqual([]);
  }, 60_000);

  it("uses the authored fallback when the single repair is also invalid", async () => {
    const value = await fixture(["invalid", "invalid"]);
    const selection = await value.dependencies.selectDialogue(value.params);
    expect(selection.responseMode).toBe("fallback");
    expect(selection.text).toBe(
      "There is too much frightened talk already. Ask me about one thing at a time, and I will tell you what I can.",
    );

    const runs = await db().pool.query<{ readonly outcome: string }>(
      `SELECT outcome FROM public.agent_runs
        WHERE town_id = $1 AND player_action_id = $2 ORDER BY created_at`,
      [value.params.townId, value.actionId],
    );
    expect(runs.rows.map((row) => row.outcome)).toStrictEqual(["rejected", "rejected"]);
  }, 60_000);

  it("keeps an ambiguous transport failure reserved at worst case", async () => {
    const value = await fixture(["transport_failure"]);
    const selection = await value.dependencies.selectDialogue(value.params);
    expect(selection.responseMode).toBe("fallback");

    const reservations = await db().pool.query<{
      readonly status: string;
      readonly actual_cost: string | null;
      readonly agent_run_id: string | null;
    }>(
      `SELECT status, actual_cost, agent_run_id
         FROM public.model_cost_reservations
        WHERE town_id = $1 AND player_action_id = $2`,
      [value.params.townId, value.actionId],
    );
    expect(reservations.rows).toEqual([
      { status: "reserved", actual_cost: null, agent_run_id: null },
    ]);

    const runs = await db().pool.query<{ readonly outcome: string }>(
      `SELECT outcome FROM public.agent_runs
        WHERE town_id = $1 AND player_action_id = $2`,
      [value.params.townId, value.actionId],
    );
    expect(runs.rows).toEqual([{ outcome: "failed" }]);
  }, 60_000);
});
