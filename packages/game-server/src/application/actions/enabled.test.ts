import {
  ACTION_KINDS,
  MODEL_BACKED_ACTION_KINDS,
  type ActionKind,
} from "@the-town-remembers/http-contracts";
import { describe, expect, it } from "vitest";

import { AppError } from "../../http/errors.js";
import {
  ENABLED_ACTION_KINDS,
  isEnabledActionKind,
  requireEnabledActionKind,
} from "./enabled.js";

const MODEL_BACKED_SET = new Set<ActionKind>(MODEL_BACKED_ACTION_KINDS);
const NEVER_ENABLED_ACTION_KINDS = ACTION_KINDS.filter(
  (kind) =>
    !(ENABLED_ACTION_KINDS as readonly ActionKind[]).includes(kind) &&
    !MODEL_BACKED_SET.has(kind),
);

function expectUnsupported(kind: ActionKind, enableNpcMutations: boolean): void {
  expect(isEnabledActionKind(kind, enableNpcMutations)).toBe(false);
  try {
    requireEnabledActionKind(kind, enableNpcMutations);
    expect.unreachable("requireEnabledActionKind should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(422);
    expect((error as AppError).code).toBe("UNSUPPORTED_ACTION_KIND");
  }
}

describe("requireEnabledActionKind", () => {
  it.each(ENABLED_ACTION_KINDS)(
    "accepts %s without throwing regardless of enableNpcMutations",
    (kind) => {
      for (const enableNpcMutations of [false, true]) {
        expect(() => requireEnabledActionKind(kind, enableNpcMutations)).not.toThrow();
        expect(isEnabledActionKind(kind, enableNpcMutations)).toBe(true);
      }
    },
  );

  it.each(NEVER_ENABLED_ACTION_KINDS)(
    "rejects %s with a stable 422 regardless of enableNpcMutations",
    (kind) => {
      expectUnsupported(kind, false);
      expectUnsupported(kind, true);
    },
  );

  it.each(MODEL_BACKED_ACTION_KINDS)(
    "rejects the model-backed kind %s with the identical 422 while enableNpcMutations is false",
    (kind) => {
      expectUnsupported(kind, false);
    },
  );

  it.each(MODEL_BACKED_ACTION_KINDS)(
    "accepts the model-backed kind %s once enableNpcMutations is true",
    (kind) => {
      expect(() => requireEnabledActionKind(kind, true)).not.toThrow();
      expect(isEnabledActionKind(kind, true)).toBe(true);
    },
  );

  it("covers every ACTION_KIND exactly once across enabled, model-backed, and never-enabled", () => {
    expect(
      ENABLED_ACTION_KINDS.length +
        MODEL_BACKED_ACTION_KINDS.length +
        NEVER_ENABLED_ACTION_KINDS.length,
    ).toBe(ACTION_KINDS.length);
  });
});
