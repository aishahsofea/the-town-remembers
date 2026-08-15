import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * `pnpm validate` no longer runs `pnpm test:model` separately (`VPR-03`) —
 * it relies on `pnpm test` already covering the `model-runtime` project. If
 * a future config edit ever drops that project from `vitest.config.ts`,
 * nothing else in the gate would notice the missing coverage, so this test
 * is the one thing standing between that edit and a silent gap.
 */
test("model-runtime remains a member of the full vitest project list", async () => {
  const config = (await import("../vitest.config.ts")).default;
  const names = config.test.projects.map((project) =>
    typeof project === "string" ? project : project.test?.name,
  );
  assert.ok(
    names.includes("model-runtime"),
    `expected "model-runtime" among the default projects, got: ${JSON.stringify(names)}`,
  );
});
