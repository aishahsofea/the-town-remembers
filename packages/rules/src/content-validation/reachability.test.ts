import { describe, expect, it } from "vitest";

import {
  chapelRoutesOpenIndependently,
  cumulativeSuspicionAfterEvents,
  cumulativeTrustAfterEvents,
  isTrustGateReachableWithinEvents,
  WORKED_TRUST_GATE_WITNESS,
} from "./reachability.js";

describe("the worked trust-gate witness", () => {
  it("reaches trust +45, suspicion -30 in exactly three events", () => {
    expect(cumulativeTrustAfterEvents(WORKED_TRUST_GATE_WITNESS)).toBe(45);
    expect(cumulativeSuspicionAfterEvents(WORKED_TRUST_GATE_WITNESS)).toBe(-30);
    expect(WORKED_TRUST_GATE_WITNESS).toHaveLength(3);
  });

  it("reaches the trust-40 gate within the four-event bound", () => {
    expect(isTrustGateReachableWithinEvents(WORKED_TRUST_GATE_WITNESS, 4, 40)).toBe(
      true,
    );
  });
});

describe("isTrustGateReachableWithinEvents", () => {
  it("fails when more events are used than the bound allows", () => {
    const fiveEvents = [
      ...WORKED_TRUST_GATE_WITNESS,
      { reasonKinds: ["evidence_presented"] as const },
      { reasonKinds: ["evidence_presented"] as const },
    ];
    expect(isTrustGateReachableWithinEvents(fiveEvents, 4, 40)).toBe(false);
  });

  it("fails when the trust total never reaches the gate", () => {
    expect(
      isTrustGateReachableWithinEvents(
        [{ reasonKinds: ["evidence_presented"] }],
        4,
        40,
      ),
    ).toBe(false);
  });
});

describe("chapelRoutesOpenIndependently", () => {
  it("both Nessa's and Corin's routes open from the same trust-building witness", () => {
    expect(chapelRoutesOpenIndependently()).toBe(true);
  });
});
