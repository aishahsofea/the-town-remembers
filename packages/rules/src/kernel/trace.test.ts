import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { CompletedActionResponseSchema } from "@the-town-remembers/http-contracts";
import { PlayerViewSchema } from "@the-town-remembers/http-contracts";

import { ruleTrace } from "./trace.js";

/**
 * A local copy of `packages/http-contracts/src/leakage.test.ts`'s walker,
 * per that file's own note ("the pattern to follow, not import") — `rules`
 * cannot depend on `http-contracts`'s test-only code, and importing its test
 * file would pull vitest fixtures into this package's dependency graph.
 */
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

describe("RuleTrace player-safety", () => {
  it("shares no field name with PlayerView or a completed action response", () => {
    const trace = ruleTrace({
      rulesVersion: "mvp-rules-v1",
      ruleName: "example_rule",
      matchedStableKeys: ["lark_damaged_bell"],
      matchedReasonCode: "OK",
      evaluatedInputs: { listenerTrustInSpeaker: 42 },
    });

    const traceFieldNames = new Set([
      ...Object.keys(trace),
      ...Object.keys(trace.evaluatedInputs),
    ]);
    const playerFacingNames = new Set([
      ...collectPropertyNames(PlayerViewSchema),
      ...collectPropertyNames(CompletedActionResponseSchema),
    ]);

    const collisions = [...traceFieldNames].filter((name) =>
      playerFacingNames.has(name),
    );
    expect(collisions).toStrictEqual([]);
  });

  it("defaults evaluatedInputs to an empty object", () => {
    const trace = ruleTrace({
      rulesVersion: "mvp-rules-v1",
      ruleName: "example_rule",
      matchedStableKeys: [],
      matchedReasonCode: "OK",
    });
    expect(trace.evaluatedInputs).toStrictEqual({});
  });
});
