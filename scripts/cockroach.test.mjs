import assert from "node:assert/strict";
import test from "node:test";

import {
  COCKROACH_VERSION,
  assetNameFor,
  downloadUrlFor,
  isPortOpen,
  parseBuildTag,
} from "./cockroach.mjs";

test("asset names follow CockroachDB's per-platform spelling", () => {
  assert.equal(
    assetNameFor("darwin", "arm64"),
    `cockroach-${COCKROACH_VERSION}.darwin-11.0-arm64`,
  );
  assert.equal(
    assetNameFor("darwin", "x64"),
    `cockroach-${COCKROACH_VERSION}.darwin-10.9-amd64`,
  );
  assert.equal(
    assetNameFor("linux", "x64"),
    `cockroach-${COCKROACH_VERSION}.linux-amd64`,
  );
  assert.equal(
    assetNameFor("linux", "arm64"),
    `cockroach-${COCKROACH_VERSION}.linux-arm64`,
  );
});

test("an unpublished platform fails with its name rather than a 404 later", () => {
  assert.throws(() => assetNameFor("win32", "x64"), /win32\/x64/);
});

test("download URLs are pinned to one version and one origin", () => {
  const url = downloadUrlFor("darwin", "arm64");
  assert.ok(url.startsWith("https://binaries.cockroachdb.com/"));
  assert.ok(url.includes(COCKROACH_VERSION));
  assert.ok(url.endsWith(".tgz"));
});

test("build tags are read from the version block", () => {
  const output = [
    "Build Tag:        v25.4.3",
    "Build Time:       2026/01/07 18:33:34",
    "Distribution:     CCL",
    "Platform:         darwin arm64",
  ].join("\n");
  assert.equal(parseBuildTag(output), "v25.4.3");
});

test("output without a build tag reports absence instead of guessing", () => {
  assert.equal(parseBuildTag("Platform: darwin arm64"), undefined);
});

test("a closed port is reported closed rather than hanging", async () => {
  assert.equal(await isPortOpen(1, "127.0.0.1", 200), false);
});
