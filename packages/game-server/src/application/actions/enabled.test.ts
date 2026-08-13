import { ACTION_KINDS, type ActionKind } from "@the-town-remembers/http-contracts";
import { describe, expect, it } from "vitest";

import { AppError } from "../../http/errors.js";
import {
  ENABLED_ACTION_KINDS,
  isEnabledActionKind,
  requireEnabledActionKind,
} from "./enabled.js";

const DISABLED_ACTION_KINDS = ACTION_KINDS.filter(
  (kind) => !(ENABLED_ACTION_KINDS as readonly ActionKind[]).includes(kind),
);

describe("requireEnabledActionKind", () => {
  it.each(ENABLED_ACTION_KINDS)("accepts %s without throwing", (kind) => {
    expect(() => requireEnabledActionKind(kind)).not.toThrow();
    expect(isEnabledActionKind(kind)).toBe(true);
  });

  it.each(DISABLED_ACTION_KINDS)(
    "rejects %s with a stable 422 and no idempotency-relevant side effect",
    (kind) => {
      expect(isEnabledActionKind(kind)).toBe(false);
      try {
        requireEnabledActionKind(kind);
        expect.unreachable("requireEnabledActionKind should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).status).toBe(422);
        expect((error as AppError).code).toBe("UNSUPPORTED_ACTION_KIND");
      }
    },
  );

  it("covers every ACTION_KIND exactly once between enabled and disabled", () => {
    expect(DISABLED_ACTION_KINDS.length + ENABLED_ACTION_KINDS.length).toBe(
      ACTION_KINDS.length,
    );
  });
});
