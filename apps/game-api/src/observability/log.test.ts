import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HEADER_ALLOWLIST } from "@the-town-remembers/game-server";
import { describe, expect, it } from "vitest";

/**
 * `GameApiLogEvent`'s field names, read directly from this module's own
 * source rather than duplicated by hand: a future field added to the closed
 * union is covered by this scan without anyone remembering to update it.
 */
function loggedFieldNames(): readonly string[] {
  const source = readFileSync(
    fileURLToPath(new URL("./log.ts", import.meta.url)),
    "utf8",
  );
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^\s*readonly\s+([A-Za-z][A-Za-z0-9]*)\s*[:?]/gm,
  )) {
    names.add(match[1]!);
  }
  return [...names];
}

describe("allowlisted headers versus logged fields", () => {
  it("share no name: no allowlisted header has a log field to travel in", () => {
    const logged = new Set(loggedFieldNames());
    const overlap = HEADER_ALLOWLIST.filter((name) => logged.has(name));
    expect(overlap).toStrictEqual([]);
  });

  it("found at least one field, proving the scan itself is not vacuous", () => {
    expect(loggedFieldNames().length).toBeGreaterThan(0);
  });
});
