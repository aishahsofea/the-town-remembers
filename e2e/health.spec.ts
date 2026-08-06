import { expect, test } from "@playwright/test";

/**
 * The Phase 0 user-visible proof: a real browser loads the local page, reaches
 * the API through the same `/api/v1/health` path shape the deployed
 * application serves, and degrades safely when the API does not answer.
 */

const HEALTH_PATH = "/api/v1/health";

test.describe("health journey", () => {
  test("renders API liveness and build identity", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
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
    // the page ever requests.
    expect(apiRequests.length).toBeGreaterThan(0);
    expect([...new Set(apiRequests)]).toStrictEqual([HEALTH_PATH]);
  });

  test("calls the API on the same origin as the page", async ({ page }) => {
    const origins = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) origins.add(url.origin);
    });

    await page.goto("/");
    await expect(page.getByText("Responding")).toBeVisible();

    expect([...origins]).toStrictEqual([new URL(page.url()).origin]);
  });

  test("shows a safe outage state when the API does not answer", async ({ page }) => {
    await page.route(`**${HEALTH_PATH}`, (route) => route.abort("connectionrefused"));
    await page.goto("/");

    const status = page.getByRole("status");
    await expect(status).toContainText("The API did not answer");
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();

    const rendered = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of ["econnrefused", "typeerror", "127.0.0.1", "stack"]) {
      expect(rendered).not.toContain(leak);
    }
  });

  test("recovers when the API answers again", async ({ page }) => {
    let apiAvailable = false;
    await page.route(`**${HEALTH_PATH}`, async (route) => {
      if (apiAvailable) {
        await route.continue();
        return;
      }
      await route.abort("connectionrefused");
    });

    await page.goto("/");
    await expect(page.getByText("The API did not answer")).toBeVisible();

    apiAvailable = true;
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByText("Responding")).toBeVisible();
  });

  test("claims no database, model, or queue readiness on the page", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Responding")).toBeVisible();

    const rendered = (await page.locator("body").innerText()).toLowerCase();
    expect(rendered).toContain("makes no claim about the database");
    for (const claim of ["cockroach", "bedrock", "sqs", "secrets manager"]) {
      expect(rendered).not.toContain(claim);
    }
  });

  test("sends the accepted transport headers on the API response", async ({
    request,
  }) => {
    const response = await request.get(HEALTH_PATH);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["x-request-id"]).toMatch(/^req_/);

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toStrictEqual(["build", "status", "time"]);
  });
});
