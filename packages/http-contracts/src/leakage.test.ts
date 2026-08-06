import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ActionResultSchemaByKind, CompletedActionResponseSchema } from "./actions.js";
import { HealthResponseSchema } from "./health.js";
import { PlayerViewSchema } from "./player-view.js";
import { ProblemResponseSchema } from "./problem.js";
import {
  InvitePreviewResponseSchema,
  JoinResponseSchema,
  TownCreationResponseSchema,
} from "./town.js";

/**
 * Names that would carry hidden state, an exact score, objective truth, a
 * credential, or a raw database row into a player-facing body. The check is on
 * the schema shape rather than on one fixture, so a future field cannot pass
 * merely because no fixture exercises it.
 */
const FORBIDDEN_PROPERTY_PATTERNS: readonly RegExp[] = [
  /^revision$/i,
  /revision$/i,
  /score$/i,
  /^belief/i,
  /^trust/i,
  /^suspicion/i,
  /objectivetruth/i,
  /^truth$/i,
  /token/i,
  /cookie/i,
  /secret/i,
  /password/i,
  /credential/i,
  /session/i,
  /^sql$/i,
  /^query$/i,
  /^stack$/i,
  /^rawrow$/i,
  /^row$/i,
  /prompt/i,
  /embedding/i,
  /modeloutput/i,
  /apikey/i,
];

/** Property names that read like a hit but are accepted contract fields. */
const ALLOWED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  // `contentVersion`, `termsVersion`, and `viewVersion` are frozen public
  // identifiers, never the canonical town revision.
  "contentVersion",
  "termsVersion",
  "viewVersion",
]);

function collectPropertyNames(
  schema: z.core.$ZodType,
  seen = new Set<unknown>(),
): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const definition = schema._zod.def as unknown as Record<string, unknown>;
  const names: string[] = [];

  const shape = definition["shape"] as Record<string, z.core.$ZodType> | undefined;
  if (shape) {
    for (const [key, child] of Object.entries(shape)) {
      names.push(key, ...collectPropertyNames(child, seen));
    }
  }

  for (const key of ["element", "innerType", "valueType", "keyType"]) {
    const child = definition[key] as z.core.$ZodType | undefined;
    if (child?._zod) names.push(...collectPropertyNames(child, seen));
  }

  const options = definition["options"] as z.core.$ZodType[] | undefined;
  for (const option of options ?? []) names.push(...collectPropertyNames(option, seen));

  return names;
}

const PLAYER_FACING_SCHEMAS: Record<string, z.core.$ZodType> = {
  playerView: PlayerViewSchema,
  completedAction: CompletedActionResponseSchema,
  problem: ProblemResponseSchema,
  health: HealthResponseSchema,
  townCreation: TownCreationResponseSchema,
  invitePreview: InvitePreviewResponseSchema,
  join: JoinResponseSchema,
  ...Object.fromEntries(
    Object.entries(ActionResultSchemaByKind).map(([kind, schema]) => [
      `actionResult.${kind}`,
      schema as z.core.$ZodType,
    ]),
  ),
};

describe("player-safe leakage", () => {
  it.each(Object.keys(PLAYER_FACING_SCHEMAS))(
    "keeps hidden state out of the %s schema",
    (name) => {
      const properties = collectPropertyNames(PLAYER_FACING_SCHEMAS[name]!);
      expect(properties.length).toBeGreaterThan(0);

      const offenders = properties.filter(
        (property) =>
          !ALLOWED_PROPERTY_NAMES.has(property) &&
          FORBIDDEN_PROPERTY_PATTERNS.some((pattern) => pattern.test(property)),
      );
      expect(offenders).toStrictEqual([]);
    },
  );

  it("would catch a hidden field added to a player-facing schema", () => {
    const leaky = PlayerViewSchema.extend({ beliefScore: z.number() });
    const offenders = collectPropertyNames(leaky).filter((property) =>
      FORBIDDEN_PROPERTY_PATTERNS.some((pattern) => pattern.test(property)),
    );
    expect(offenders).toContain("beliefScore");
  });

  it("walks into arrays and unions rather than stopping at the top level", () => {
    const names = collectPropertyNames(PlayerViewSchema);
    expect(names).toContain("provenancePath");
    expect(names).toContain("epilogue");
    expect(names).toContain("inspectionState");
  });

  it("never exposes the canonical town revision", () => {
    const names = collectPropertyNames(PlayerViewSchema);
    expect(names).not.toContain("revision");
    expect(names).not.toContain("townRevision");
  });
});
