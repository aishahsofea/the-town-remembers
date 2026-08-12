/**
 * `game-server/observability/events.ts`'s structured-log event field names,
 * checked against `FORBIDDEN_LOG_PROPERTIES` (`P3-17` acceptance 6). The
 * matching check for `apps/game-api/src/observability/log.ts` lives in
 * `apps/game-api/src/local-server.test.ts`, alongside that file's "a real
 * journey never leaks a marker" tests — the two live in their own packages
 * rather than one test reaching across a workspace boundary to read the
 * other's source.
 *
 * A source scan rather than a runtime object check: every `*LogEvent`
 * interface is a closed, field-name-only type with no runtime
 * representation, and scanning the interface declaration directly means a
 * field `P3-18` adds later (`action_lifecycle`, `rate_limit_decision`) is
 * checked automatically, with no separate list to remember to update.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FORBIDDEN_LOG_PROPERTIES } from "@the-town-remembers/test-support";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.resolve(HERE, "../observability/events.ts");

/** Every `readonly <name>:` field declared inside an `export interface ...LogEvent { ... }` block. */
function logEventFieldNames(source: string): string[] {
  const names: string[] = [];
  const interfaceStarts = source.matchAll(/export interface \w*LogEvent \{/g);
  for (const match of interfaceStarts) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = source.indexOf("}", bodyStart);
    const body = source.slice(bodyStart, bodyEnd);
    for (const fieldMatch of body.matchAll(/readonly\s+(\w+)\s*:/g)) {
      names.push(fieldMatch[1]!);
    }
  }
  return names;
}

describe("game-server LogEvent field names never shadow a forbidden log property (P3-17 acceptance 6)", () => {
  it("carries no forbidden field name", () => {
    const forbidden = new Set(FORBIDDEN_LOG_PROPERTIES);
    const names = logEventFieldNames(readFileSync(EVENTS_FILE, "utf8"));
    const offenders = names.filter((name) => forbidden.has(name));
    expect(offenders).toStrictEqual([]);
  });

  it("the scan itself is not vacuous", () => {
    const names = logEventFieldNames(readFileSync(EVENTS_FILE, "utf8"));
    expect(names.length).toBeGreaterThan(1);
  });
});
