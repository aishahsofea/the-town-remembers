import { describe, expect, it } from "vitest";

import {
  ACTION_KINDS,
  BELIEF_LABEL_BANDS,
  BOARD_ENTRY_KINDS,
  BOARD_VERIFICATION_BY_KIND,
  BOARD_VERIFICATION_STATUSES,
  CLAIM_ENTITY_MATRIX,
  CLAIM_PREDICATES,
  EMBEDDING_AGENT_RUN_PURPOSES,
  AGENT_RUN_PURPOSES,
  EVENT_TYPES,
  STORY_ENTITY_TYPES,
  beliefLabelFor,
  sqlValueList,
} from "./domains.js";

describe("accepted domain inventories", () => {
  it("matches the counts Decision 005 enumerates", () => {
    expect(ACTION_KINDS).toHaveLength(13);
    expect(EVENT_TYPES).toHaveLength(20);
    expect(CLAIM_PREDICATES).toHaveLength(5);
    expect(STORY_ENTITY_TYPES).toHaveLength(4);
  });

  it("contains no duplicate value in any domain", () => {
    for (const values of [ACTION_KINDS, EVENT_TYPES, BOARD_ENTRY_KINDS]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("pairs every board entry kind with exactly one verification status", () => {
    expect(Object.keys(BOARD_VERIFICATION_BY_KIND).toSorted()).toStrictEqual(
      [...BOARD_ENTRY_KINDS].toSorted(),
    );
    expect(Object.values(BOARD_VERIFICATION_BY_KIND).toSorted()).toStrictEqual(
      [...BOARD_VERIFICATION_STATUSES].toSorted(),
    );
  });

  it("covers every predicate in the claim entity matrix", () => {
    expect(Object.keys(CLAIM_ENTITY_MATRIX).toSorted()).toStrictEqual(
      [...CLAIM_PREDICATES].toSorted(),
    );
    for (const roles of Object.values(CLAIM_ENTITY_MATRIX)) {
      expect(STORY_ENTITY_TYPES).toContain(roles.subject);
      expect(STORY_ENTITY_TYPES).toContain(roles.object);
    }
  });

  it("treats embedding purposes as a subset of agent-run purposes", () => {
    for (const purpose of EMBEDDING_AGENT_RUN_PURPOSES) {
      expect(AGENT_RUN_PURPOSES).toContain(purpose);
    }
    expect(EMBEDDING_AGENT_RUN_PURPOSES).toHaveLength(2);
  });
});

describe("belief labels", () => {
  it.each([
    [100, "convinced"],
    [60, "convinced"],
    [59, "leaning"],
    [20, "leaning"],
    [19, "doubtful"],
    [0, "doubtful"],
    [-100, "doubtful"],
  ])("labels score %i as %s", (score, label) => {
    expect(beliefLabelFor(score)).toBe(label);
  });

  it("declares bands in descending order so the first match wins", () => {
    const minimums = BELIEF_LABEL_BANDS.map((band) => band.minimum);
    expect(minimums).toStrictEqual([...minimums].toSorted((a, b) => b - a));
  });
});

describe("SQL rendering", () => {
  it("quotes values in declaration order", () => {
    expect(sqlValueList(["a", "b"])).toBe("'a', 'b'");
  });

  it("renders every domain value so a check cannot silently omit one", () => {
    const rendered = sqlValueList(ACTION_KINDS);
    for (const kind of ACTION_KINDS) expect(rendered).toContain(`'${kind}'`);
  });
});
