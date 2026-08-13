import { DATABASE, PLAYER_API_TIMING } from "@the-town-remembers/runtime-config/game";
import { describe, expect, it } from "vitest";

import {
  applicationDeadlineAt,
  commitStatementTimeoutMs,
  preCommitDeadline,
  startOperationDeadline,
} from "./deadline.js";

const STARTED_AT = new Date("2026-01-01T00:00:00.000Z");

describe("startOperationDeadline", () => {
  it("carries the accepted timing constants unchanged", () => {
    const deadline = startOperationDeadline(STARTED_AT);
    expect(deadline.startedAtMs).toBe(STARTED_AT.getTime());
    expect(deadline.applicationBudgetMs).toBe(PLAYER_API_TIMING.applicationBudgetMs);
    expect(deadline.reservedCommitWindowMs).toBe(
      PLAYER_API_TIMING.reservedCommitWindowMs,
    );
    expect(deadline.responseSerializationReserveMs).toBe(
      PLAYER_API_TIMING.responseSerializationReserveMs,
    );
  });
});

describe("applicationDeadlineAt / preCommitDeadline", () => {
  it("reserves the final commit window ahead of the hard deadline", () => {
    const deadline = startOperationDeadline(STARTED_AT);
    const hardDeadline = applicationDeadlineAt(deadline);
    expect(hardDeadline).toBe(
      STARTED_AT.getTime() + PLAYER_API_TIMING.applicationBudgetMs,
    );
    expect(preCommitDeadline(deadline)).toBe(
      hardDeadline - PLAYER_API_TIMING.reservedCommitWindowMs,
    );
  });
});

describe("commitStatementTimeoutMs", () => {
  it("never exceeds the accepted database ceiling", () => {
    const deadline = startOperationDeadline(STARTED_AT);
    const timeout = commitStatementTimeoutMs(deadline, STARTED_AT);
    expect(timeout).toBeLessThanOrEqual(DATABASE.maximumStatementTimeoutMs);
  });

  it("shrinks to the remaining application budget when that is smaller", () => {
    const deadline = startOperationDeadline(STARTED_AT);
    const almostOut = new Date(
      applicationDeadlineAt(deadline) - deadline.responseSerializationReserveMs - 800,
    );
    expect(commitStatementTimeoutMs(deadline, almostOut)).toBe(800);
  });

  it("never returns a non-positive timeout past its own deadline", () => {
    const deadline = startOperationDeadline(STARTED_AT);
    const wayPastDeadline = new Date(applicationDeadlineAt(deadline) + 10_000);
    expect(commitStatementTimeoutMs(deadline, wayPastDeadline)).toBe(1);
  });
});
