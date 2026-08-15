import { expect, test } from "@playwright/test";

/**
 * The Phase 0 user-visible proof: a real browser loads the local page, reaches
 * the API through the same `/api/v1/health` path shape the deployed
 * application serves, and degrades safely when the API does not answer.
 *
 * Layer ownership (`VPR-13`): consolidated to one healthy/wiring case and
 * one outage/recovery case. Two cases were removed outright, each already
 * proved more directly one layer down:
 *   - "sends the accepted transport headers on the API response" -- a pure
 *     HTTP round-trip with no browser rendering involved at all;
 *     `packages/game-server/src/http/headers.test.ts` and `router.test.ts`
 *     already unit-test the header-building functions this endpoint uses.
 *   - "claims no database, model, or queue readiness on the page" --
 *     `apps/web/src/health/HealthPanel.test.tsx` already asserts the exact
 *     same rendered strings at the component level.
 */

const HEALTH_PATH = "/api/v1/health";

test.describe("health journey", () => {
  test("renders API liveness and build identity, calling only same-origin health", async ({
    page,
  }) => {
    const apiRequests: string[] = [];
    const origins = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) {
        apiRequests.push(url.pathname);
        origins.add(url.origin);
      }
    });

    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "The Town Remembers" }),
    ).toBeVisible();
    await expect(page.getByText("Responding")).toBeVisible();
    await expect(page.getByText("Server build")).toBeVisible();
    await expect(page.getByText("Server time")).toBeVisible();

    // React StrictMode double-invokes effects in development, so the count is
    // not stable. What must hold is that the health path is the only API path
    // the page ever requests, and it's requested same-origin.
    expect(apiRequests.length).toBeGreaterThan(0);
    expect([...new Set(apiRequests)]).toStrictEqual([HEALTH_PATH]);
    expect([...origins]).toStrictEqual([new URL(page.url()).origin]);
  });

  test("shows a safe outage state, then recovers once the API answers again", async ({
    page,
  }) => {
    let apiAvailable = false;
    await page.route(`**${HEALTH_PATH}`, async (route) => {
      if (apiAvailable) {
        await route.continue();
        return;
      }
      await route.abort("connectionrefused");
    });

    await page.goto("/");

    const status = page.getByRole("status");
    await expect(status).toContainText("The API did not answer");
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();

    const rendered = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of ["econnrefused", "typeerror", "127.0.0.1", "stack"]) {
      expect(rendered).not.toContain(leak);
    }

    apiAvailable = true;
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByText("Responding")).toBeVisible();
  });
});
