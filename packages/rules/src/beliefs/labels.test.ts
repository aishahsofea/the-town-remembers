import { describe, expect, it } from "vitest";

import { BELL_MYSTERY_V1 } from "@the-town-remembers/content";

import {
  beliefLabelFor,
  contestationLead,
  dialogueStanceFor,
  isAuthoredCoverStory,
  isSelectedBelief,
} from "./labels.js";

describe("beliefLabelFor (D2-C re-export)", () => {
  it.each([
    [19, "doubtful"],
    [20, "leaning"],
    [59, "leaning"],
    [60, "convinced"],
  ])("labels score %i as %s", (score, label) => {
    expect(beliefLabelFor(score)).toBe(label);
  });
});

describe("dialogueStanceFor", () => {
  it.each([
    [100, "confident"],
    [60, "confident"],
    [59, "tentative"],
    [20, "tentative"],
    [19, "uncertain_or_reported"],
    [0, "uncertain_or_reported"],
    [-19, "uncertain_or_reported"],
    [-20, "explicit_reject"],
    [-100, "explicit_reject"],
  ])("maps score %i to %s", (score, stance) => {
    expect(dialogueStanceFor(score)).toBe(stance);
  });

  it("splits the shared 'doubtful' label across two different stances", () => {
    expect(beliefLabelFor(-19)).toBe("doubtful");
    expect(beliefLabelFor(-20)).toBe("doubtful");
    expect(dialogueStanceFor(-19)).not.toBe(dialogueStanceFor(-20));
  });
});

describe("contestationLead", () => {
  it("uses 0 as the second-highest score when nothing contradicts", () => {
    expect(contestationLead(45, [])).toBe(45);
  });

  it("uses the single contradicting claim's score", () => {
    expect(contestationLead(45, [10])).toBe(35);
  });

  it("uses the highest of two-or-more contradicting claims", () => {
    expect(contestationLead(45, [10, 30, -5])).toBe(15);
  });

  it("can be negative when a contradictor is ahead", () => {
    expect(contestationLead(20, [50])).toBe(-30);
  });
});

describe("isSelectedBelief", () => {
  it("requires both score >= 20 and lead >= 20", () => {
    expect(isSelectedBelief(20, [])).toBe(true);
    expect(isSelectedBelief(19, [])).toBe(false);
    expect(isSelectedBelief(40, [21])).toBe(false); // lead only 19
    expect(isSelectedBelief(40, [20])).toBe(true); // lead exactly 20
  });

  it("an uncontested set with no scored contradictor unlocks on score alone", () => {
    expect(isSelectedBelief(25, [])).toBe(true);
  });
});

describe("isAuthoredCoverStory", () => {
  it("identifies Corin's public-safety cover-story claim from the registry", () => {
    expect(isAuthoredCoverStory("corin_acted_for_safety", BELL_MYSTERY_V1)).toBe(true);
  });

  it("never flags a true claim as the cover-story exception, regardless of belief", () => {
    for (const claim of BELL_MYSTERY_V1.claims) {
      if (claim.objectivelyTrueAtSeed) {
        expect(isAuthoredCoverStory(claim.claimKey, BELL_MYSTERY_V1)).toBe(false);
      }
    }
  });

  it("returns false for an unknown claim key rather than throwing", () => {
    expect(isAuthoredCoverStory("no_such_claim", BELL_MYSTERY_V1)).toBe(false);
  });
});
