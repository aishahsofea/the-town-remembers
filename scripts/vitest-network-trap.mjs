/**
 * Vitest `setupFiles` entry: blocks any non-loopback `fetch()` call
 * (`D4-U`, `P4-06` acceptance 2 — "`pnpm test` never contacts the
 * network").
 *
 * Loopback stays allowed because several existing tests (`apps/game-api`'s
 * `local-server.test.ts` and its siblings) start a real local HTTP server
 * and fetch against it — that is a fast, self-contained test, not a network
 * dependency. Only a request whose host is not `127.0.0.1`/`localhost`/`::1`
 * is refused.
 */

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isLoopback(url) {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = requestUrl(input);
  if (!isLoopback(url)) {
    throw new Error(
      `Network access is blocked in this test project: fetch(${JSON.stringify(url)}) is not a loopback address. ` +
        `A test that genuinely needs real network access belongs in the opt-in "model-live" project, not here.`,
    );
  }
  return realFetch(input, init);
};
