import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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
 * `P3-19`: the single ordered Phase 3 acceptance journey — create town
 * (idempotently, twice) -> open invite -> preview -> join -> resume after
 * reload -> player-view -> travel -> inspect -> refresh -> replay one
 * action with the same key -> leave -> away -> start visit — against a
 * real running API, a real browser, and the one disposable database
 * `playwright.config.ts` created for this run. Never `page.route()`
 * mocking: `health.spec.ts`/`join.spec.ts` already prove the client in
 * isolation that way; this is the one place the whole stack runs together
 * end to end, the way a real player and a real judge would see it.
 */

applyLocalDefaults();

const { apiBaseUrl, webBaseUrl } = loadTestConfig(process.env);
// The same constant `playwright.config.ts` started the API server with, not
// a `process.env` read: an ignored `.env` holding a different judge code
// would otherwise make every creation request here a 401.
const JUDGE_CODE = E2E_JUDGE_CODE;

function readDisposableDbState(): DisposableDbState {
  return JSON.parse(
    readFileSync(DISPOSABLE_DB_STATE_FILE, "utf8"),
  ) as DisposableDbState;
}

interface TraceEvidence {
  townId: string;
  readonly requestIds: string[];
  readonly actionIds: string[];
  readonly worldEventIds: string[];
}

test("the first playable journey: create, join, resume, travel, inspect, replay, leave, away, return", async ({
  page,
  request,
}, testInfo) => {
  const trace: TraceEvidence = {
    townId: "",
    requestIds: [],
    actionIds: [],
    worldEventIds: [],
  };

  const dbState = readDisposableDbState();
  const dbPool = new Pool({ connectionString: dbState.adminUrl, max: 2 });

  try {
    // --- 1. Create the town, idempotently, twice --------------------------
    const creationIdempotencyKey = randomUUID();
    async function createTown() {
      return request.post(`${apiBaseUrl}/api/v1/towns`, {
        headers: {
          origin: webBaseUrl,
          authorization: `Bearer ${JUDGE_CODE}`,
          "content-type": "application/json",
          "idempotency-key": creationIdempotencyKey,
        },
        data: {},
      });
    }

    const firstCreate = await createTown();
    expect(firstCreate.status()).toBe(201);
    trace.requestIds.push(firstCreate.headers()["x-request-id"] ?? "");
    const firstBody = (await firstCreate.json()) as {
      readonly townId: string;
      readonly inviteUrl: string;
    };

    const secondCreate = await createTown();
    trace.requestIds.push(secondCreate.headers()["x-request-id"] ?? "");
    const secondBody = await secondCreate.json();
    expect(secondBody).toStrictEqual(firstBody);

    trace.townId = firstBody.townId;
    const inviteToken = new URL(firstBody.inviteUrl).pathname.split("/").at(-1)!;

    // --- 2. Open invite -> preview -> join, through the real browser -----
    await page.goto(`/join/${inviteToken}`);
    await expect(
      page.getByRole("heading", { name: "The Missing Festival Bell" }),
    ).toBeVisible();

    await page.getByLabel("Your name").fill("Trace Player");
    const joinResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/join") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Enter the town" }).click();
    const joinResponse = await joinResponsePromise;
    trace.requestIds.push(joinResponse.headers()["x-request-id"] ?? "");

    await expect(page).toHaveURL(new RegExp(`/town/${trace.townId}/map`));
    await expect(page.getByRole("heading", { name: "Town map" })).toBeVisible();

    // --- 3. Resume after reload: the session survives, no re-join form ---
    await page.reload();
    await expect(page.getByRole("heading", { name: "Town map" })).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveCount(0);

    // player-view itself is already proven by every screen above rendering
    // real town data pulled from it; it gets no separate step.

    // --- 4. Travel to the Lantern Inn, through the real browser ----------
    const lanternInnCard = page.locator(".map-screen__location-card", {
      hasText: "The Lantern Inn",
    });
    const travelResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/actions") && response.request().method() === "POST",
    );
    await lanternInnCard.getByRole("button", { name: "Travel" }).click();
    const travelResponse = await travelResponsePromise;
    trace.requestIds.push(travelResponse.headers()["x-request-id"] ?? "");
    const travelBody = (await travelResponse.json()) as { readonly actionId: string };
    trace.actionIds.push(travelBody.actionId);

    await expect(lanternInnCard.getByText("You are here")).toBeVisible();

    // --- 5. Inspect something there, through the real browser ------------
    await lanternInnCard.getByRole("button", { name: "Open" }).click();
    await expect(page.getByRole("heading", { name: "The Lantern Inn" })).toBeVisible();

    const inspectResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/actions") && response.request().method() === "POST",
    );
    await page
      .locator("li", { hasText: "Ash in the Back Hearth" })
      .getByRole("button", { name: "Examine" })
      .click();
    const inspectResponse = await inspectResponsePromise;
    trace.requestIds.push(inspectResponse.headers()["x-request-id"] ?? "");
    const inspectBody = (await inspectResponse.json()) as { readonly actionId: string };
    trace.actionIds.push(inspectBody.actionId);

    // --- 6. Refresh ---------------------------------------------------------
    await page.reload();
    await expect(page.getByRole("heading", { name: "The Lantern Inn" })).toBeVisible();

    // --- 7. Replay one action with the same idempotency key, direct to the
    // API — the UI always mints a fresh key per submit, so only a direct
    // call proves replay. Travel to a not-yet-visited location (Reed's
    // Garden) so the first submission genuinely applies and writes exactly
    // one world_events row, and the replay returns that same saved answer
    // rather than writing a second one.
    const reedsGarden = await dbPool.query<{ readonly id: string }>(
      `SELECT id FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location' AND entity_key = 'reeds_garden'`,
      [trace.townId],
    );
    const reedsGardenId = reedsGarden.rows[0]!.id;

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name.startsWith("ttr_town_"));
    if (!sessionCookie) throw new Error("No session cookie found after join.");
    const cookieHeader = `${sessionCookie.name}=${sessionCookie.value}`;

    const replayIdempotencyKey = randomUUID();
    async function submitReplayableTravel() {
      return request.post(`${apiBaseUrl}/api/v1/towns/${trace.townId}/actions`, {
        headers: {
          origin: webBaseUrl,
          "content-type": "application/json",
          cookie: cookieHeader,
          "idempotency-key": replayIdempotencyKey,
        },
        data: { kind: "travel", destinationLocationId: reedsGardenId },
      });
    }

    const firstReplaySubmit = await submitReplayableTravel();
    expect(firstReplaySubmit.status()).toBe(200);
    trace.requestIds.push(firstReplaySubmit.headers()["x-request-id"] ?? "");
    const firstReplayBody = (await firstReplaySubmit.json()) as {
      readonly actionId: string;
      readonly outcome: string;
    };
    expect(firstReplayBody.outcome).toBe("applied");
    trace.actionIds.push(firstReplayBody.actionId);

    const secondReplaySubmit = await submitReplayableTravel();
    expect(secondReplaySubmit.status()).toBe(200);
    trace.requestIds.push(secondReplaySubmit.headers()["x-request-id"] ?? "");
    const secondReplayBody = await secondReplaySubmit.json();
    expect(secondReplayBody).toStrictEqual(firstReplayBody);

    const replayedEvents = await dbPool.query<{ readonly id: string }>(
      `SELECT id FROM public.world_events WHERE town_id = $1 AND player_action_id = $2`,
      [trace.townId, firstReplayBody.actionId],
    );
    expect(replayedEvents.rows).toHaveLength(1);
    trace.worldEventIds.push(...replayedEvents.rows.map((row) => row.id));

    // No reload needed here: `Leave town` (below) does not depend on the
    // page's displayed location, and every extra `player-view` poll this
    // journey issues in quick succession (each `page.reload()` and every
    // action's own post-completion refresh) draws down the same
    // `RATE_LIMIT_BUCKETS.playerView` burst (`D3-F`, `docs/007`) — a real
    // player's pacing never comes close to it, but this test's does, so
    // only the two reloads the acceptance list itself names ("resume after
    // reload", "refresh") are worth spending burst budget on.

    // --- 8. Leave, through the real browser ---------------------------------
    await page.getByRole("button", { name: "Leave town" }).click();
    await expect(page.getByRole("dialog", { name: "End this visit?" })).toBeVisible();
    const leaveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/actions") && response.request().method() === "POST",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Leave town" }).click();
    const leaveResponse = await leaveResponsePromise;
    trace.requestIds.push(leaveResponse.headers()["x-request-id"] ?? "");
    const leaveBody = (await leaveResponse.json()) as { readonly actionId: string };
    trace.actionIds.push(leaveBody.actionId);

    // --- 9. Away ---------------------------------------------------------
    await expect(
      page.getByRole("heading", { name: "Your visit is complete." }),
    ).toBeVisible();
    const returnButton = page.getByRole("button", {
      name: "Return to Festival Square",
    });
    await expect(returnButton).toBeEnabled();

    // --- 10. Start visit again, through the real browser --------------------
    const startVisitResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/actions") && response.request().method() === "POST",
    );
    await returnButton.click();
    const startVisitResponse = await startVisitResponsePromise;
    trace.requestIds.push(startVisitResponse.headers()["x-request-id"] ?? "");
    const startVisitBody = (await startVisitResponse.json()) as {
      readonly actionId: string;
    };
    trace.actionIds.push(startVisitBody.actionId);

    await expect(page.getByRole("heading", { name: "Town map" })).toBeVisible();
  } finally {
    await dbPool.end();
  }

  // --- Trace evidence, per acceptance 3 -----------------------------------
  const traceJson = JSON.stringify(trace, null, 2);
  await testInfo.attach("phase-03-first-playable-trace", {
    body: traceJson,
    contentType: "application/json",
  });
  expect(findSensitiveMarkers(traceJson)).toStrictEqual([]);
  expect(trace.requestIds.every((id) => id.length > 0)).toBe(true);
  expect(trace.actionIds.length).toBeGreaterThan(0);
  expect(trace.worldEventIds.length).toBeGreaterThan(0);
});
