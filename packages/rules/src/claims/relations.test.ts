import { describe, expect, it } from "vitest";

import { CLAIM_RELATIONS } from "@the-town-remembers/content";

import {
  deterministicClaimRelation,
  hasMirroredRelation,
  mirrorWeightFor,
  planContradictionMirrorBackfill,
  type ClaimRelationRow,
} from "./relations.js";

describe("deterministicClaimRelation", () => {
  const claim = {
    subjectEntityId: "bell",
    predicate: "is_at",
    objectEntityId: "chapel",
    polarity: "positive",
    contextKey: "current",
  };

  it("relates exact positive/negative opposites", () => {
    expect(deterministicClaimRelation(claim, { ...claim, polarity: "negative" })).toBe(
      "contradicts",
    );
  });

  it("relates mutually exclusive positive locations in the same context", () => {
    expect(
      deterministicClaimRelation(claim, { ...claim, objectEntityId: "garden" }),
    ).toBe("contradicts");
  });

  it("does not generalize location exclusivity across contexts or negative claims", () => {
    expect(
      deterministicClaimRelation(claim, {
        ...claim,
        objectEntityId: "garden",
        contextKey: "festival_night",
      }),
    ).toBeUndefined();
    expect(
      deterministicClaimRelation(
        { ...claim, polarity: "negative" },
        { ...claim, objectEntityId: "garden" },
      ),
    ).toBeUndefined();
  });
});

const AUTHORED_RELATIONS: readonly ClaimRelationRow[] = CLAIM_RELATIONS.map(
  (relation) => ({
    claimAId: relation.claimAKey,
    claimBId: relation.claimBKey,
    relationKind: relation.relationKind,
  }),
);

describe("hasMirroredRelation", () => {
  it("finds the stored mirror for every one of the three authored contradicts pairs", () => {
    for (const relation of AUTHORED_RELATIONS) {
      expect(
        hasMirroredRelation(
          AUTHORED_RELATIONS,
          relation.claimAId,
          relation.claimBId,
          relation.relationKind,
        ),
      ).toBe(true);
    }
  });

  it("reports a missing mirror as false", () => {
    expect(
      hasMirroredRelation(
        AUTHORED_RELATIONS,
        "some_claim",
        "another_claim",
        "contradicts",
      ),
    ).toBe(false);
  });
});

describe("mirrorWeightFor", () => {
  it("negates the primary weight for a contradicts mirror", () => {
    expect(mirrorWeightFor("contradicts", 70)).toBe(-70);
    expect(mirrorWeightFor("contradicts", -44)).toBe(44);
  });

  it("propagates zero weight for an entails mirror (D2-Q), regardless of the primary weight", () => {
    // Synthetic fixture: bell-mystery-v1 ships zero `entails` rows, so this
    // exercises the defensive branch no shipped content ever reaches.
    expect(mirrorWeightFor("entails", 80)).toBe(0);
    expect(mirrorWeightFor("entails", -80)).toBe(0);
  });
});

describe("planContradictionMirrorBackfill", () => {
  it("backfills unreversed support from both claims onto the other, skipping what is already mirrored", () => {
    const plan = planContradictionMirrorBackfill(
      "claim-a",
      "claim-b",
      [
        { evidenceId: "ev-1", npcId: "npc-1", claimId: "claim-a", signedWeight: 70 },
        { evidenceId: "ev-2", npcId: "npc-2", claimId: "claim-a", signedWeight: 44 },
        { evidenceId: "ev-3", npcId: "npc-1", claimId: "claim-b", signedWeight: 80 },
        // Support on an unrelated claim must never appear in the plan.
        { evidenceId: "ev-4", npcId: "npc-1", claimId: "claim-c", signedWeight: 50 },
      ],
      [{ claimId: "claim-b", mirrorsEvidenceId: "ev-2" }],
      "event-1",
    );

    expect(plan).toStrictEqual([
      {
        npcId: "npc-1",
        claimId: "claim-a",
        mirrorsEvidenceId: "ev-3",
        signedWeight: -80,
        causalEventId: "event-1",
      },
      {
        npcId: "npc-1",
        claimId: "claim-b",
        mirrorsEvidenceId: "ev-1",
        signedWeight: -70,
        causalEventId: "event-1",
      },
    ]);
  });

  it("returns an empty plan when every mirror already exists", () => {
    const plan = planContradictionMirrorBackfill(
      "claim-a",
      "claim-b",
      [{ evidenceId: "ev-1", npcId: "npc-1", claimId: "claim-a", signedWeight: 70 }],
      [{ claimId: "claim-b", mirrorsEvidenceId: "ev-1" }],
      "event-1",
    );
    expect(plan).toStrictEqual([]);
  });
});
