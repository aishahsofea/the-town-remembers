import { expect, test, type Page } from "@playwright/test";

/**
 * `P3-13` acceptance suite. Every API response is mocked via `page.route` —
 * the same pattern `health.spec.ts` already uses — so this proves the
 * *client's* bootstrap, storage, and rendering behavior against a real
 * browser, independent of a live backend or database. Server-side join
 * correctness already has its own extensive suite in
 * `packages/game-server/src/http/actions.db.test.ts` and friends.
 *
 * Layer ownership (`VPR-13`), checked against `screens/Join.test.tsx`
 * (component, jsdom + mocked fetch):
 *   - "shows the tokenless /join..." and "refreshing /join before
 *     authentication...": a real address bar and a real page reload —
 *     jsdom has neither. Browser-only, kept.
 *   - "an existing session shows Return as..." and "a closed town shows no
 *     name field": removed. Both assert component logic
 *     (`Join.test.tsx`'s "Join — existing session" and "Join — closed
 *     town" describe blocks already cover the identical behavior) with no
 *     address-bar, storage, focus, or navigation-lifecycle assertion this
 *     spec adds on top.
 *   - "a server-side name conflict...": kept for its real
 *     `document.activeElement`/`selectionStart` check — jsdom's selection
 *     APIs are not a reliable stand-in for a real browser's.
 *   - "the join attempt secret is never present...": kept, but repaired
 *     the same way `Join.test.tsx`'s equivalent case was (`VPR-11`) — it
 *     checked the DOM before the secret was ever allocated (fill, not
 *     submit), which cannot fail no matter what the client does with a
 *     real secret.
 */

const TOKEN = "secret-invite-token-abc123";

const PREVIEW_BODY = {
  townId: "town_1",
  mysteryTitle: "The Missing Festival Bell",
  tagline: "The bell is gone.",
  description: "Visit a shared town, question its residents.",
  townStatus: "active",
  joinMode: "play",
};

function problemBody(status: number, code: string, detail: string) {
  return {
    type: `https://the-town-remembers/errors/${code.toLowerCase().replaceAll("_", "-")}`,
    status,
    code,
    title: code,
    detail,
    requestId: "req_1",
    fieldErrors: [],
  };
}

async function mockPreview(page: Page, body: unknown) {
  await page.route("**/api/v1/invites/*", async (route) => {
    if (route.request().url().includes("/join")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockNoExistingSession(page: Page) {
  await page.route("**/api/v1/towns/*/player-view", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify(problemBody(401, "INVALID_SESSION", "no session")),
    });
  });
}

test.describe("invite bootstrap", () => {
  /**
   * The exact relative ordering of `history.replaceState` before the first
   * effect-driven fetch is guaranteed by React's own execution model
   * (`JoinBootstrap`'s synchronous component-body call always finishes
   * before any effect can run) and is proved with a reliable same-process
   * call-order assertion in `screens/JoinBootstrap.test.tsx`. Racing two
   * different clocks (the browser's and Playwright's) to re-prove the same
   * ordering here would be strictly less reliable, not more. This spec's own
   * job is what only a real browser can prove: the address bar and every
   * storage surface after bootstrap.
   */
  test("shows the tokenless /join in the address bar, and the token never leaks into storage, cookies, the console, or the DOM", async ({
    page,
  }) => {
    const previewRequests: string[] = [];
    const consoleTexts: string[] = [];
    page.on("console", (message) => consoleTexts.push(message.text()));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.startsWith("/api/v1/invites/") &&
        !url.pathname.endsWith("/join")
      ) {
        previewRequests.push(url.pathname);
      }
    });

    await mockPreview(page, PREVIEW_BODY);
    await mockNoExistingSession(page);

    await page.goto(`/join/${TOKEN}`);
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByText(PREVIEW_BODY.mysteryTitle)).toBeVisible();

    expect(new URL(page.url()).pathname).toBe("/join");
    // The invite-preview request legitimately carries the token to the
    // server — that is how the server knows which town to preview. Only the
    // address bar and every storage surface must stay tokenless.
    expect(previewRequests.some((path) => path.includes(TOKEN))).toBe(true);

    const html = await page.content();
    const localStorageDump = await page.evaluate(() => JSON.stringify(localStorage));
    const sessionStorageDump = await page.evaluate(() =>
      JSON.stringify(sessionStorage),
    );
    const cookies = await page.context().cookies();

    for (const haystack of [
      html,
      localStorageDump,
      sessionStorageDump,
      JSON.stringify(cookies),
      consoleTexts.join("\n"),
    ]) {
      expect(haystack).not.toContain(TOKEN);
    }
  });

  test("refreshing /join before authentication shows the reopen message and issues no preview request", async ({
    page,
  }) => {
    const previewRequests: string[] = [];
    await page.route("**/api/v1/invites/*", (route) => {
      previewRequests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(PREVIEW_BODY),
      });
    });

    await page.goto("/join");

    await expect(page.getByText("Reopen the invite link to continue.")).toBeVisible();
    expect(previewRequests).toHaveLength(0);
  });
});

test.describe("join screen", () => {
  test("a server-side name conflict keeps the field, selects its text, and shows the conflict copy without a second POST", async ({
    page,
  }) => {
    await mockPreview(page, PREVIEW_BODY);
    await mockNoExistingSession(page);
    let joinPostCount = 0;
    await page.route("**/api/v1/invites/*/join", async (route) => {
      joinPostCount += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problemBody(409, "DISPLAY_NAME_TAKEN", "That name is already in use."),
        ),
      });
    });

    await page.goto(`/join/${TOKEN}`);
    const nameField = page.getByLabel("Your name");
    await nameField.fill("Aishah Sofea");
    await page.getByRole("button", { name: "Enter the town" }).click();

    await expect(
      page.getByText("That name is already in use in this town."),
    ).toBeVisible();
    await expect(nameField).toHaveValue("Aishah Sofea");
    expect(joinPostCount).toBe(1);

    const selection = await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null;
      if (!active || active.selectionStart === null) return null;
      return active.value.slice(active.selectionStart, active.selectionEnd ?? 0);
    });
    expect(selection).toBe("Aishah Sofea");
  });

  test("never exposes a live join secret to the rendered DOM", async ({ page }) => {
    await mockPreview(page, PREVIEW_BODY);
    await mockNoExistingSession(page);

    // Holds the /join response open so the assertion below runs while the
    // secret genuinely exists (`ttr.join-session` is written synchronously
    // at submit time, before the request settles) -- checking before
    // submission, as this case used to, cannot fail no matter what the
    // client does with a real secret (VPR-11's equivalent repair in
    // Join.test.tsx).
    let releaseJoinResponse!: () => void;
    const joinRequestHeld = new Promise<void>((resolve) => {
      releaseJoinResponse = resolve;
    });
    await page.route("**/api/v1/invites/*/join", async (route) => {
      await joinRequestHeld;
      await route.fulfill({ status: 500, body: "{}" });
    });

    await page.goto(`/join/${TOKEN}`);
    await page.getByLabel("Your name").fill("Aishah Sofea");
    await page.getByRole("button", { name: "Enter the town" }).click();

    const secret = await page.waitForFunction(() => {
      const raw = sessionStorage.getItem("ttr.join-session");
      if (!raw) return null;
      return (JSON.parse(raw) as { joinAttemptSecret: string }).joinAttemptSecret;
    });
    const secretValue = (await secret.jsonValue()) as string;
    expect(secretValue.length).toBeGreaterThan(0);

    const html = await page.content();
    expect(html).not.toContain(secretValue);

    releaseJoinResponse();
  });
});
