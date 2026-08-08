import { describe, expect, it } from "vitest";

import {
  SEED_EVIDENCE,
  SEED_TRANSMISSIONS,
  seedBeliefs,
} from "@the-town-remembers/content";
import { beliefLabelFor } from "@the-town-remembers/database/domains";

import { sumEventContributions } from "../kernel/numeric.js";
import {
  corroborationWeight,
  DIRECT_OBSERVATION_WEIGHT,
  isRepeatContribution,
  npcTestimonyBase,
  PHYSICAL_CLUE_MAGNITUDE,
  planCorroborationAdjustment,
  planImmediateContradictionMirrors,
  planSourceDiscreditedReversal,
  playerTestimonyBase,
  testimonyWeight,
  type ActiveContribution,
} from "./evidence.js";

describe("testimony base formulas", () => {
  it.each([
    [-100, 25],
    [-1, 34],
    [0, 35],
    [1, 35],
    [100, 45],
  ])("clamps player_base for trust %i to %i", (trust, expected) => {
    expect(playerTestimonyBase(trust)).toBe(expected);
  });

  it.each([
    [-100, 30],
    [-1, 39],
    [0, 40],
    [20, 42],
    [100, 50],
  ])("clamps npc_base for trust %i to %i", (trust, expected) => {
    expect(npcTestimonyBase(trust)).toBe(expected);
  });

  it("negative trust exercises the ruleFloor regression, not truncation", () => {
    // floor(-25 / 10) === -3, not -2: player_base(-25) = 35 + (-3) = 32.
    expect(playerTestimonyBase(-25)).toBe(32);
  });
});

describe("testimonyWeight", () => {
  it("subtracts 10 per hop and floors at 10", () => {
    expect(testimonyWeight(44, 0)).toBe(44);
    expect(testimonyWeight(44, 1)).toBe(34);
    expect(testimonyWeight(44, 3)).toBe(14);
    expect(testimonyWeight(44, 10)).toBe(10);
  });
});

describe("corroborationWeight", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 15],
    [3, 30],
    [4, 30],
    [10, 30],
  ])("weighs %i independent sources as %i", (count, expected) => {
    expect(corroborationWeight(count)).toBe(expected);
  });
});

describe("evidence weights reproduce the seeded fixtures", () => {
  it.each(SEED_TRANSMISSIONS.map((t) => [t.transmissionKey, t] as const))(
    "reproduces %s's testimony weight from its trust snapshot at hop 0",
    (_key, transmission) => {
      const base = npcTestimonyBase(transmission.trustSnapshot);
      expect(testimonyWeight(base, 0)).toBe(transmission.testimonyWeight);
    },
  );

  it("reproduces every seeded contradiction mirror's weight as the exact negation of its primary", () => {
    const byNpcClaim = new Map(
      SEED_EVIDENCE.map((evidence) => [
        `${evidence.npcKey} ${evidence.claimKey}`,
        evidence,
      ]),
    );
    const mirrors = SEED_EVIDENCE.filter(
      (evidence) => evidence.evidenceKind === "contradiction",
    );
    expect(mirrors.length).toBeGreaterThan(0);

    for (const mirror of mirrors) {
      const primary = byNpcClaim.get(
        `${mirror.mirrorsEvidenceOf!.npcKey} ${mirror.mirrorsEvidenceOf!.claimKey}`,
      );
      expect(primary).toBeDefined();
      expect(mirror.signedWeight).toBe(-primary!.signedWeight);
    }
  });

  it("reproduces seedBeliefs()'s scores and labels by summing SEED_EVIDENCE", () => {
    const totals = sumEventContributions(
      SEED_EVIDENCE,
      (evidence) => `${evidence.npcKey} ${evidence.claimKey}`,
      (evidence) => evidence.signedWeight,
    );

    for (const belief of seedBeliefs()) {
      const total = totals.get(`${belief.npcKey} ${belief.claimKey}`);
      expect(total).toBe(belief.score);
      expect(beliefLabelFor(total!)).toBe(belief.label);
    }
  });

  it("names the direct observation and physical clue magnitudes Decision 008 fixes", () => {
    expect(DIRECT_OBSERVATION_WEIGHT).toBe(80);
    expect(PHYSICAL_CLUE_MAGNITUDE).toBe(70);
  });
});

describe("isRepeatContribution: source independence and repeat protection", () => {
  it("rejects a repeat by the same player source", () => {
    const existing = [
      {
        npcId: "npc-1",
        claimId: "claim-1",
        evidenceKind: "player_testimony" as const,
        independentSourceActorId: "player-1",
      },
    ];
    expect(
      isRepeatContribution(existing, {
        npcId: "npc-1",
        claimId: "claim-1",
        evidenceKind: "player_testimony",
        independentSourceActorId: "player-1",
      }),
    ).toBe(true);
  });

  it("rejects a descendant hearsay transmission that shares the same root speaker", () => {
    const existing = [
      {
        npcId: "npc-2",
        claimId: "claim-1",
        evidenceKind: "npc_testimony" as const,
        independentSourceActorId: "npc-root",
      },
    ];
    // A different (deeper) transmission of the same claim, still rooted at
    // the same original speaker, must not add weight again.
    expect(
      isRepeatContribution(existing, {
        npcId: "npc-2",
        claimId: "claim-1",
        evidenceKind: "npc_testimony",
        independentSourceActorId: "npc-root",
      }),
    ).toBe(true);
  });

  it("rejects an API replay of an identical candidate", () => {
    const candidate = {
      npcId: "npc-1",
      claimId: "claim-1",
      evidenceKind: "physical_clue" as const,
      clueId: "clue-1",
    };
    expect(isRepeatContribution([candidate], candidate)).toBe(true);
  });

  it("does not reject a genuinely new independent source", () => {
    const existing = [
      {
        npcId: "npc-1",
        claimId: "claim-1",
        evidenceKind: "npc_testimony" as const,
        independentSourceActorId: "npc-a",
      },
    ];
    expect(
      isRepeatContribution(existing, {
        npcId: "npc-1",
        claimId: "claim-1",
        evidenceKind: "npc_testimony",
        independentSourceActorId: "npc-b",
      }),
    ).toBe(false);
  });

  it("repeated Show attempts of the same clue never accumulate weight (grinding is a no-op)", () => {
    const candidate = {
      npcId: "npc-1",
      claimId: "claim-1",
      evidenceKind: "physical_clue" as const,
      clueId: "clue-1",
    };
    const active = [candidate];
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(isRepeatContribution(active, candidate)).toBe(true);
      // A denied attempt never appends, so `active` never grows.
    }
    expect(active).toStrictEqual([candidate]);
  });
});

describe("planCorroborationAdjustment", () => {
  it("adds no bonus for the first source", () => {
    expect(
      planCorroborationAdjustment("npc-1", "claim-1", 0, 1, "event-1"),
    ).toBeUndefined();
  });

  it("adds +15 crossing from one to two independent sources", () => {
    expect(
      planCorroborationAdjustment("npc-1", "claim-1", 1, 2, "event-1"),
    ).toStrictEqual({
      npcId: "npc-1",
      claimId: "claim-1",
      evidenceKind: "corroboration",
      signedWeight: 15,
      causalEventId: "event-1",
    });
  });

  it("pulls back -15 when a source is reversed and the count drops back to one", () => {
    expect(
      planCorroborationAdjustment("npc-1", "claim-1", 2, 1, "event-2"),
    ).toStrictEqual({
      npcId: "npc-1",
      claimId: "claim-1",
      evidenceKind: "corroboration",
      signedWeight: -15,
      causalEventId: "event-2",
    });
  });

  it("adds another +15 recrossing the same threshold afterward", () => {
    expect(
      planCorroborationAdjustment("npc-1", "claim-1", 1, 2, "event-3"),
    ).toStrictEqual({
      npcId: "npc-1",
      claimId: "claim-1",
      evidenceKind: "corroboration",
      signedWeight: 15,
      causalEventId: "event-3",
    });
  });

  it("caps additional bonus at two extra sources", () => {
    expect(
      planCorroborationAdjustment("npc-1", "claim-1", 3, 4, "event-4"),
    ).toBeUndefined();
  });
});

describe("planSourceDiscreditedReversal", () => {
  const activeContributions: readonly ActiveContribution[] = [
    {
      evidenceId: "ev-1",
      npcId: "npc-1",
      claimId: "claim-1",
      signedWeight: 32,
      independentSourceActorId: "npc-liar",
    },
    {
      evidenceId: "ev-2",
      npcId: "npc-2",
      claimId: "claim-2",
      signedWeight: 40,
      independentSourceActorId: "npc-liar",
    },
    {
      evidenceId: "ev-3",
      npcId: "npc-3",
      claimId: "claim-3",
      signedWeight: 80,
      independentSourceActorId: "npc-honest",
    },
  ];

  it("reverses every active contribution from the discredited source with the exact opposite weight", () => {
    const plan = planSourceDiscreditedReversal(
      activeContributions,
      "npc-liar",
      new Set(),
      "event-1",
    );
    expect(plan).toStrictEqual([
      {
        npcId: "npc-1",
        claimId: "claim-1",
        evidenceKind: "source_reversal",
        signedWeight: -32,
        reversesEvidenceId: "ev-1",
        causalEventId: "event-1",
      },
      {
        npcId: "npc-2",
        claimId: "claim-2",
        evidenceKind: "source_reversal",
        signedWeight: -40,
        reversesEvidenceId: "ev-2",
        causalEventId: "event-1",
      },
    ]);
  });

  it("never reverses the same evidence row twice", () => {
    const plan = planSourceDiscreditedReversal(
      activeContributions,
      "npc-liar",
      new Set(["ev-1", "ev-2"]),
      "event-2",
    );
    expect(plan).toStrictEqual([]);
  });

  it("leaves an unrelated source untouched", () => {
    const plan = planSourceDiscreditedReversal(
      activeContributions,
      "npc-honest",
      new Set(),
      "e",
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]!.reversesEvidenceId).toBe("ev-3");
  });
});

describe("planImmediateContradictionMirrors", () => {
  it("mirrors a contradicts relation with the exact opposite weight, one row per related claim", () => {
    const plan = planImmediateContradictionMirrors(
      "npc-1",
      "ev-primary",
      70,
      [{ claimId: "claim-b", relationKind: "contradicts" }],
      "event-1",
    );
    expect(plan).toStrictEqual([
      {
        npcId: "npc-1",
        claimId: "claim-b",
        evidenceKind: "contradiction",
        signedWeight: -70,
        mirrorsEvidenceId: "ev-primary",
        causalEventId: "event-1",
      },
    ]);
  });

  it("propagates zero weight for an entails relation (D2-Q) rather than rejecting it", () => {
    const plan = planImmediateContradictionMirrors(
      "npc-1",
      "ev-primary",
      80,
      [{ claimId: "claim-b", relationKind: "entails" }],
      "event-1",
    );
    expect(plan[0]!.signedWeight).toBe(0);
  });

  it("mirrors are one level deep: the caller's own repeat protection rejects a second mirror of the same primary", () => {
    const [mirror] = planImmediateContradictionMirrors(
      "npc-1",
      "ev-primary",
      70,
      [{ claimId: "claim-b", relationKind: "contradicts" }],
      "event-1",
    );
    const active = [
      {
        npcId: mirror!.npcId,
        claimId: mirror!.claimId,
        evidenceKind: mirror!.evidenceKind,
        mirrorsEvidenceId: mirror!.mirrorsEvidenceId,
      },
    ];
    expect(
      isRepeatContribution(active, {
        npcId: mirror!.npcId,
        claimId: mirror!.claimId,
        evidenceKind: mirror!.evidenceKind,
        mirrorsEvidenceId: mirror!.mirrorsEvidenceId,
      }),
    ).toBe(true);
  });
});

describe("worked example: one clue overturns one neutral testimony", () => {
  it("a -70 contradicting clue flips a +32 hop-1 testimony's sign", () => {
    const testimony = testimonyWeight(npcTestimonyBase(20), 1); // 42 - 10 = 32
    expect(testimony).toBe(32);

    const total = sumEventContributions(
      [
        { target: "npc-1 claim-1", delta: testimony },
        { target: "npc-1 claim-1", delta: -PHYSICAL_CLUE_MAGNITUDE },
      ],
      (contribution) => contribution.target,
      (contribution) => contribution.delta,
    );

    expect(total.get("npc-1 claim-1")).toBe(-38);
  });
});
