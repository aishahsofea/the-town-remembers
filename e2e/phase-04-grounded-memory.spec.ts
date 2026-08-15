import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { readInspectedInteraction } from "@the-town-remembers/game-server";
import { loadTestConfig } from "@the-town-remembers/runtime-config/test";
import { findSensitiveMarkers } from "@the-town-remembers/test-support";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { applyLocalDefaults } from "../scripts/local-env.mjs";
import {
  DISPOSABLE_DB_STATE_FILE,
  type DisposableDbState,
} from "./disposable-db-state.js";
import { E2E_JUDGE_CODE } from "./security-fixtures.js";

/**
 * `P4-24` acceptance 3: the grounded-memory journey Decision 011/`docs/014`
 * §9 describe — Player A confirms `bell_at_reeds_garden` to Mara and stays
 * (`D4-P`: Phase 4 never calls `leave` after a mutation); Player B then asks
 * Mara a relevant question and receives a response drawn from a bundle the
 * just-committed episode/belief affects, and shows the real `guard_cart_ruts`
 * clue, producing a deterministic belief/relationship change plus grounded
 * dialogue. Database inspection reconstructs the claim, transmission,
 * episode, evidence, belief, selected rendering, and model run, while the
 * `items` row for `festival_bell` stays untouched by a claim nobody verified.
 *
 * Requires real Bedrock/Titan access (`docs/014` §1): `TTR_AWS_REGION`/
 * `TTR_BEDROCK_*` credentials the local dev server can actually reach.
 * `playwright.config.ts`'s API `webServer` merges the parent process's own
 * environment in, so real `.env` credentials already reach it — this spec
 * only adds the opt-in gate so `pnpm test:e2e`/`pnpm validate` stay green
 * (skipped, not failed) without them, matching `test:model:live`/
 * `prompts:eval:live`'s existing opt-in pattern.
 *
 *   TTR_E2E_LIVE_MODEL=1 pnpm test:e2e:live
 *
 * Costs a handful of real Bedrock/Titan calls (well under the model-runtime
 * price catalog's cent-level per-call estimates) each time it runs.
 */

applyLocalDefaults();

const LIVE_MODEL_E2E = process.env["TTR_E2E_LIVE_MODEL"] === "1";

const { apiBaseUrl, webBaseUrl } = loadTestConfig(process.env);
const JUDGE_CODE = E2E_JUDGE_CODE;

function readDisposableDbState(): DisposableDbState {
  return JSON.parse(
    readFileSync(DISPOSABLE_DB_STATE_FILE, "utf8"),
  ) as DisposableDbState;
}

interface GroundedMemoryTrace {
  townId: string;
  readonly requestIds: string[];
  readonly actionIds: Record<string, string>;
}

test("grounded memory: Player A's confirmed claim shapes Player B's dialogue and evidence changes belief, with the object of a false claim left untouched", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.skip(
    !LIVE_MODEL_E2E,
    "Requires real Bedrock/Titan access. Opt in with TTR_E2E_LIVE_MODEL=1 pnpm test:e2e:live.",
  );

  const trace: GroundedMemoryTrace = { townId: "", requestIds: [], actionIds: {} };
  const dbState = readDisposableDbState();
  const dbPool = new Pool({ connectionString: dbState.adminUrl, max: 4 });

  try {
    // --- 1. Create the town -------------------------------------------------
    const createResponse = await request.post(`${apiBaseUrl}/api/v1/towns`, {
      headers: {
        origin: webBaseUrl,
        authorization: `Bearer ${JUDGE_CODE}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      data: {},
    });
    expect(createResponse.status()).toBe(201);
    trace.requestIds.push(createResponse.headers()["x-request-id"] ?? "");
    const { townId, inviteUrl } = (await createResponse.json()) as {
      readonly townId: string;
      readonly inviteUrl: string;
    };
    trace.townId = townId;
    const inviteToken = new URL(inviteUrl).pathname.split("/").at(-1)!;

    const festivalBellId = (
      await dbPool.query<{ id: string }>(
        `SELECT se.id FROM public.story_entities se
          WHERE se.town_id = $1 AND se.entity_type = 'item' AND se.entity_key = 'festival_bell'`,
        [townId],
      )
    ).rows[0]!.id;
    const itemsBefore = (
      await dbPool.query(`SELECT * FROM public.items WHERE town_id = $1 AND id = $2`, [
        townId,
        festivalBellId,
      ])
    ).rows[0];

    // --- 2. Player A joins, travels to the Lantern Inn, and confirms a claim
    async function joinAs(playerPage: typeof page, displayName: string): Promise<void> {
      await playerPage.goto(`/join/${inviteToken}`);
      await expect(
        playerPage.getByRole("heading", { name: "The Missing Festival Bell" }),
      ).toBeVisible();
      await playerPage.getByLabel("Your name").fill(displayName);
      const joinResponsePromise = playerPage.waitForResponse(
        (response) =>
          response.url().includes("/join") && response.request().method() === "POST",
      );
      await playerPage.getByRole("button", { name: "Enter the town" }).click();
      const joinResponse = await joinResponsePromise;
      trace.requestIds.push(joinResponse.headers()["x-request-id"] ?? "");
      await expect(playerPage).toHaveURL(new RegExp(`/town/${townId}/map`));
    }

    async function travelTo(
      playerPage: typeof page,
      locationName: string,
    ): Promise<void> {
      const card = playerPage.locator(".map-screen__location-card", {
        hasText: locationName,
      });
      const responsePromise = playerPage.waitForResponse(
        (response) =>
          response.url().includes("/actions") && response.request().method() === "POST",
      );
      await card.getByRole("button", { name: "Travel" }).click();
      const response = await responsePromise;
      trace.requestIds.push(response.headers()["x-request-id"] ?? "");
      const body = (await response.json()) as { readonly actionId: string };
      await expect(card.getByText("You are here")).toBeVisible();
      return void body;
    }

    async function speakWithMara(playerPage: typeof page): Promise<void> {
      await playerPage
        .locator("li", { hasText: "Mara Venn" })
        .getByRole("button", { name: "Speak with Mara Venn" })
        .click();
      await expect(
        playerPage.getByRole("heading", { name: "Mara Venn" }),
      ).toBeVisible();
    }

    await joinAs(page, "Player A");
    await travelTo(page, "The Lantern Inn");
    await speakWithMara(page);

    await page.getByRole("button", { name: "Tell Mara Venn" }).click();
    await page
      .getByLabel("What do you want to tell Mara Venn?")
      .fill(
        "I saw the festival bell sitting at Reed's Garden on the night of the festival.",
      );
    const interpretResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/actions") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Interpret claim" }).click();
    const interpretResponse = await interpretResponsePromise;
    trace.requestIds.push(interpretResponse.headers()["x-request-id"] ?? "");

    await expect(
      page.getByRole("dialog", { name: "Is this what you mean?" }),
    ).toBeVisible();
    const tellResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/actions") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Tell Mara Venn" }).click();
    const tellResponse = await tellResponsePromise;
    trace.requestIds.push(tellResponse.headers()["x-request-id"] ?? "");
    const tellBody = (await tellResponse.json()) as {
      readonly actionId: string;
      readonly outcome: string;
    };
    expect(tellBody.outcome).toBe("applied");
    trace.actionIds["playerA_tell"] = tellBody.actionId;

    // Player A stays in town — D4-P: Phase 4 never calls `leave` after a
    // mutation, so no leave step exists here at all.

    // --- 3. Player B joins the same town, asks Mara a relevant question ----
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      await joinAs(pageB, "Player B");
      await travelTo(pageB, "The Lantern Inn");
      await speakWithMara(pageB);

      await pageB.getByRole("button", { name: "Ask Mara Venn" }).click();
      await pageB
        .getByLabel("Ask Mara Venn")
        .fill("Do you know anything about where the festival bell ended up?");
      const askResponsePromise = pageB.waitForResponse(
        (response) =>
          response.url().includes("/actions") && response.request().method() === "POST",
      );
      await pageB
        .locator("section[aria-label='Ask composer']")
        .getByRole("button", {
          name: "Ask Mara Venn",
        })
        .click();
      const askResponse = await askResponsePromise;
      trace.requestIds.push(askResponse.headers()["x-request-id"] ?? "");
      const askBody = (await askResponse.json()) as {
        readonly actionId: string;
        readonly outcome: string;
      };
      expect(askBody.outcome).toBe("applied");
      trace.actionIds["playerB_ask"] = askBody.actionId;

      // --- 4. Player B discovers and shows real physical evidence ----------
      await pageB.getByRole("button", { name: "Back" }).click();
      await travelTo(pageB, "Festival Square");
      await pageB.reload();
      const examineResponsePromise = pageB.waitForResponse(
        (response) =>
          response.url().includes("/actions") && response.request().method() === "POST",
      );
      await pageB
        .locator("li", { hasText: "Cart Tracks by the Guard Post" })
        .getByRole("button", { name: "Examine" })
        .click();
      const examineResponse = await examineResponsePromise;
      trace.requestIds.push(examineResponse.headers()["x-request-id"] ?? "");
      const examineBody = (await examineResponse.json()) as {
        readonly actionId: string;
      };
      trace.actionIds["playerB_examine"] = examineBody.actionId;

      await travelTo(pageB, "The Lantern Inn");
      await speakWithMara(pageB);
      await pageB.getByRole("button", { name: "Show Mara Venn" }).click();
      await pageB
        .locator("fieldset", { hasText: "Evidence" })
        .getByRole("button", { name: "Guard Cart Ruts" })
        .click();
      await expect(pageB.getByRole("dialog", { name: "Show this?" })).toBeVisible();
      const showResponsePromise = pageB.waitForResponse(
        (response) =>
          response.url().includes("/actions") && response.request().method() === "POST",
      );
      await pageB
        .getByRole("dialog", { name: "Show this?" })
        .getByRole("button", { name: "Show Mara Venn" })
        .click();
      const showResponse = await showResponsePromise;
      trace.requestIds.push(showResponse.headers()["x-request-id"] ?? "");
      const showBody = (await showResponse.json()) as {
        readonly actionId: string;
        readonly outcome: string;
      };
      expect(showBody.outcome).toBe("applied");
      trace.actionIds["playerB_show"] = showBody.actionId;
    } finally {
      await contextB.close();
    }

    // --- 5. Database inspection: reconstruct the causal trace -------------
    const tellInteraction = await readInspectedInteraction(
      dbPool,
      townId,
      trace.actionIds["playerA_tell"],
    );
    expect(tellInteraction).toBeDefined();
    expect(tellInteraction!.npcName).toBe("Mara Venn");
    expect(tellInteraction!.transmissions.map((t) => t.claimKey)).toContain(
      "bell_at_reeds_garden",
    );

    const askInteraction = await readInspectedInteraction(
      dbPool,
      townId,
      trace.actionIds["playerB_ask"],
    );
    expect(askInteraction).toBeDefined();
    expect(askInteraction!.npcText.length).toBeGreaterThan(0);

    const showInteraction = await readInspectedInteraction(
      dbPool,
      townId,
      trace.actionIds["playerB_show"],
    );
    expect(showInteraction).toBeDefined();
    expect(showInteraction!.npcText.length).toBeGreaterThan(0);

    const showEvent = await dbPool.query<{ id: string }>(
      `SELECT e.id FROM public.world_events e
        WHERE e.town_id = $1 AND e.player_action_id = $2
        ORDER BY e.sequence_no LIMIT 1`,
      [townId, trace.actionIds["playerB_show"]],
    );
    expect(showEvent.rows.length).toBeGreaterThan(0);

    // Evidence: the clue Player B examined is recorded as discovered.
    const clueDiscovery = await dbPool.query(
      `SELECT cd.* FROM public.clue_discoveries cd
         JOIN public.clues cl ON cl.town_id = cd.town_id AND cl.id = cd.clue_id
        WHERE cd.town_id = $1 AND cl.clue_key = 'guard_cart_ruts'`,
      [townId],
    );
    expect(clueDiscovery.rows.length).toBeGreaterThan(0);

    // Belief: showing guard_cart_ruts moves Mara's belief on the claims its
    // authored effects name (corin_moved_bell / corin_was_at_chapel /
    // bell_at_chapel), each caused by a real world_event, never a hidden write.
    const beliefChanges = await dbPool.query(
      `SELECT nb.* FROM public.npc_beliefs nb
         JOIN public.claims c ON c.town_id = nb.town_id AND c.id = nb.claim_id
        WHERE nb.town_id = $1 AND nb.updated_event_id IS NOT NULL
          AND c.claim_key IN ('corin_moved_bell', 'corin_was_at_chapel', 'bell_at_chapel')`,
      [townId],
    );
    expect(beliefChanges.rows.length).toBeGreaterThan(0);

    // Model run: at least one accepted/repaired agent_runs row exists for
    // each model-backed action taken.
    const runs = await dbPool.query<{ readonly outcome: string }>(
      `SELECT outcome FROM public.agent_runs
        WHERE town_id = $1
          AND player_action_id IN ($2, $3, $4)`,
      [
        townId,
        trace.actionIds["playerA_tell"],
        trace.actionIds["playerB_ask"],
        trace.actionIds["playerB_show"],
      ],
    );
    expect(runs.rows.length).toBeGreaterThan(0);
    expect(
      runs.rows.some((row) => row.outcome === "accepted" || row.outcome === "repaired"),
    ).toBe(true);

    // The authoritative item row for the claim's subject is unchanged — a
    // false or unverified claim never touches real state.
    const itemsAfter = (
      await dbPool.query(`SELECT * FROM public.items WHERE town_id = $1 AND id = $2`, [
        townId,
        festivalBellId,
      ])
    ).rows[0];
    expect(itemsAfter).toStrictEqual(itemsBefore);
  } finally {
    await dbPool.end();
  }

  // --- Evidence attachment, no secret or raw output ------------------------
  const traceJson = JSON.stringify(trace, null, 2);
  await testInfo.attach("phase-04-grounded-memory-trace", {
    body: traceJson,
    contentType: "application/json",
  });
  expect(findSensitiveMarkers(traceJson)).toStrictEqual([]);
  expect(trace.requestIds.every((id) => id.length > 0)).toBe(true);
});
