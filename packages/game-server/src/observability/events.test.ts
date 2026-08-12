/**
 * A source scan over `events.ts`'s own interface declarations (`P3-18`
 * acceptance 1): no `*LogEvent` field is typed a bare `string` unless it is
 * one of the two accepted escape hatches — an ID-shaped branded type
 * (`Uuid`) or the closed route-template union (`LoggableRouteTemplate`) —
 * or the one reviewed exemption, `requestId` (`request-id.ts` generates it
 * server-side from `randomUUID()`; it is never read from the request, so it
 * can never carry player-authored text even though its format is not a raw
 * UUID and so cannot honestly wear the `Uuid` brand).
 *
 * A source scan rather than real type-level introspection: TypeScript
 * interfaces have no runtime representation to inspect, and a textual scan
 * of the declaration itself is the direct way to assert "this field's type
 * literal is exactly one of these three shapes" without building a
 * type-checker plugin.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.resolve(HERE, "./events.ts");

interface FieldDeclaration {
  readonly interfaceName: string;
  readonly fieldName: string;
  readonly typeText: string;
}

/** Every `readonly <name>: <type>;` field inside each `export interface ...LogEvent { ... }` block. */
function logEventFields(source: string): FieldDeclaration[] {
  const fields: FieldDeclaration[] = [];
  const interfaceStarts = source.matchAll(/export interface (\w*LogEvent) \{/g);
  for (const match of interfaceStarts) {
    const interfaceName = match[1]!;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = source.indexOf("\n}", bodyStart);
    const body = source.slice(bodyStart, bodyEnd);
    for (const fieldMatch of body.matchAll(/readonly\s+(\w+)\??:\s*([^;]+);/g)) {
      fields.push({
        interfaceName,
        fieldName: fieldMatch[1]!,
        typeText: fieldMatch[2]!.trim(),
      });
    }
  }
  return fields;
}

/** Field names known to be server-generated identifiers, never player text, despite being typed `string`. */
const EXEMPT_FIELD_NAMES = new Set(["requestId"]);

describe("game-server LogEvent fields carry no unrestricted string (P3-18 acceptance 1)", () => {
  it("every non-enumerated string field is Uuid, LoggableRouteTemplate, or an exempted requestId", () => {
    const fields = logEventFields(readFileSync(EVENTS_FILE, "utf8"));
    const offenders = fields.filter(
      (field) =>
        field.typeText === "string" && !EXEMPT_FIELD_NAMES.has(field.fieldName),
    );
    expect(offenders).toStrictEqual([]);
  });

  it("the scan itself is not vacuous", () => {
    const fields = logEventFields(readFileSync(EVENTS_FILE, "utf8"));
    expect(fields.length).toBeGreaterThan(10);
  });
});
