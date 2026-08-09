import { describe, expect, it } from "vitest";

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";

import {
  canResolve,
  caseAttemptOutcome,
  computeEndingRumourCount,
  isConfrontationGateOpen,
  isCorrectSolution,
  isEligibleToResolveAfterExpiry,
  isResolutionReservationActive,
  planWinningResolution,
  resolutionReservationExpiresAt,
} from "./case.js";

describe("isConfrontationGateOpen", () => {
  it("opens only with the bell revealed and every required clue discovered", () => {
    expect(
      isConfrontationGateOpen({
        bellRevealed: true,
        requiredDiscoveredCount: 3,
        requiredTotalCount: 3,
      }),
    ).toBe(true);
  });

  it("stays locked without the bell revealed", () => {
    expect(
      isConfrontationGateOpen({
        bellRevealed: false,
        requiredDiscoveredCount: 3,
        requiredTotalCount: 3,
      }),
    ).toBe(false);
  });

  it("stays locked with a partial clue count", () => {
    expect(
      isConfrontationGateOpen({
        bellRevealed: true,
        requiredDiscoveredCount: 2,
        requiredTotalCount: 3,
      }),
    ).toBe(false);
  });

  it("uses content's real required-clue count of exactly three", () => {
    expect(BELL_MYSTERY_V1.requiredClueKeys).toHaveLength(3);
    expect(
      isConfrontationGateOpen({
        bellRevealed: true,
        requiredDiscoveredCount: BELL_MYSTERY_V1.requiredClueKeys.length,
        requiredTotalCount: BELL_MYSTERY_V1.requiredClueKeys.length,
      }),
    ).toBe(true);
  });
});

describe("solution comparison reuses content#CASE_SOLUTION directly", () => {
  const solution = {
    culpritKey: BELL_MYSTERY_V1.caseSolution.culpritKey,
    motiveKey: BELL_MYSTERY_V1.caseSolution.motiveKey,
    locationKey: BELL_MYSTERY_V1.caseSolution.locationKey,
  };

  it("accepts the exact authored solution", () => {
    expect(
      isCorrectSolution(
        { suspectId: "corin_hale", motiveId: "protect_lark", locationId: "old_chapel" },
        solution,
      ),
    ).toBe(true);
  });

  it("gives no partial credit for two-of-three correct", () => {
    expect(
      isCorrectSolution(
        {
          suspectId: "corin_hale",
          motiveId: "protect_lark",
          locationId: "reeds_garden",
        },
        solution,
      ),
    ).toBe(false);
  });

  it("an incorrect attempt is classified incorrect, not silently ignored", () => {
    expect(
      caseAttemptOutcome(
        {
          suspectId: "mara_venn",
          motiveId: "personal_profit",
          locationId: "festival_square",
        },
        solution,
      ),
    ).toBe("incorrect");
  });

  it("caseAttemptOutcome matches isCorrectSolution for the true solution", () => {
    expect(
      caseAttemptOutcome(
        { suspectId: "corin_hale", motiveId: "protect_lark", locationId: "old_chapel" },
        solution,
      ),
    ).toBe("correct");
  });
});

describe("resolution reservation", () => {
  it("is exactly ten minutes", () => {
    const won = new Date("2026-01-01T00:00:00.000Z");
    expect(resolutionReservationExpiresAt(won).toISOString()).toBe(
      "2026-01-01T00:10:00.000Z",
    );
  });

  it("is active before expiry and inactive after", () => {
    const won = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = resolutionReservationExpiresAt(won);
    expect(
      isResolutionReservationActive(new Date("2026-01-01T00:09:59.000Z"), expiresAt),
    ).toBe(true);
    expect(
      isResolutionReservationActive(new Date("2026-01-01T00:10:00.000Z"), expiresAt),
    ).toBe(false);
  });

  it("post-expiry eligibility requires a visit that began no later than the winning attempt", () => {
    const winningAttemptEventAt = new Date("2026-01-01T00:00:00.000Z");
    expect(
      isEligibleToResolveAfterExpiry(
        new Date("2025-12-31T23:00:00.000Z"),
        winningAttemptEventAt,
      ),
    ).toBe(true);
    expect(
      isEligibleToResolveAfterExpiry(
        new Date("2026-01-01T00:00:00.000Z"),
        winningAttemptEventAt,
      ),
    ).toBe(true);
    expect(
      isEligibleToResolveAfterExpiry(
        new Date("2026-01-01T00:00:01.000Z"),
        winningAttemptEventAt,
      ),
    ).toBe(false);
  });

  it("canResolve: only the owner may resolve while the reservation is active", () => {
    const won = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = resolutionReservationExpiresAt(won);
    const now = new Date("2026-01-01T00:05:00.000Z");
    expect(canResolve("owner", "owner", now, expiresAt, won, won)).toBe(true);
    expect(canResolve("someone-else", "owner", now, expiresAt, won, won)).toBe(false);
  });

  it("canResolve: after expiry, an eligible non-owner may resolve", () => {
    const won = new Date("2026-01-01T00:00:00.000Z");
    const expiresAt = resolutionReservationExpiresAt(won);
    const now = new Date("2026-01-01T00:11:00.000Z");
    expect(canResolve("someone-else", "owner", now, expiresAt, won, won)).toBe(true);
  });
});

describe("planWinningResolution (D2-P)", () => {
  it("relocates the bell only when it is still at old_chapel at commit time", () => {
    expect(planWinningResolution("expose_cover_up", true)).toStrictEqual({
      choice: "expose_cover_up",
      relocatesFestivalBell: true,
    });
    expect(planWinningResolution("expose_cover_up", false)).toStrictEqual({
      choice: "expose_cover_up",
      relocatesFestivalBell: false,
    });
  });

  it("a concurrent or replayed loser (bell already relocated) produces no second relocation", () => {
    // First winner relocates the bell; a second, concurrent/replayed
    // "winner" sees the bell already gone and relocates nothing.
    const firstWin = planWinningResolution("restore_bell_quietly", true);
    expect(firstWin.relocatesFestivalBell).toBe(true);
    const secondAttempt = planWinningResolution("restore_bell_quietly", false);
    expect(secondAttempt.relocatesFestivalBell).toBe(false);
  });
});

describe("computeEndingRumourCount", () => {
  const endingFalseClaimKeys = BELL_MYSTERY_V1.claims
    .filter((claim) => !claim.objectivelyTrueAtSeed)
    .map((claim) => claim.claimKey);

  it("counts distinct ending-false claims transmitted ambiently before resolution", () => {
    const count = computeEndingRumourCount(
      [
        {
          claimKey: endingFalseClaimKeys[0]!,
          originKind: "ambient_job",
          eventSequence: 10,
        },
        {
          claimKey: endingFalseClaimKeys[1]!,
          originKind: "ambient_job",
          eventSequence: 11,
        },
      ],
      endingFalseClaimKeys,
      20,
    );
    expect(count).toBe(2);
  });

  it("counts a claim only once across multiple hops", () => {
    const count = computeEndingRumourCount(
      [
        {
          claimKey: endingFalseClaimKeys[0]!,
          originKind: "ambient_job",
          eventSequence: 10,
        },
        {
          claimKey: endingFalseClaimKeys[0]!,
          originKind: "ambient_job",
          eventSequence: 12,
        },
      ],
      endingFalseClaimKeys,
      20,
    );
    expect(count).toBe(1);
  });

  it("excludes seed and player-origin transmissions", () => {
    const count = computeEndingRumourCount(
      [
        {
          claimKey: endingFalseClaimKeys[0]!,
          originKind: "system_seed",
          eventSequence: 1,
        },
        {
          claimKey: endingFalseClaimKeys[1]!,
          originKind: "player_action",
          eventSequence: 5,
        },
      ],
      endingFalseClaimKeys,
      20,
    );
    expect(count).toBe(0);
  });

  it("excludes post-resolution transmissions", () => {
    const count = computeEndingRumourCount(
      [
        {
          claimKey: endingFalseClaimKeys[0]!,
          originKind: "ambient_job",
          eventSequence: 25,
        },
      ],
      endingFalseClaimKeys,
      20,
    );
    expect(count).toBe(0);
  });

  it("excludes an event at exactly the resolution sequence (strictly before, not at)", () => {
    const count = computeEndingRumourCount(
      [
        {
          claimKey: endingFalseClaimKeys[0]!,
          originKind: "ambient_job",
          eventSequence: 20,
        },
      ],
      endingFalseClaimKeys,
      20,
    );
    expect(count).toBe(0);
  });
});
