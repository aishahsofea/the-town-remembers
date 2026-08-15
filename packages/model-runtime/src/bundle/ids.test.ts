import { describe, expect, it } from "vitest";

import {
  assignDisclosureIds,
  assignEpisodeIds,
  assignOutcomeIds,
  assignRenderingIds,
  assignSequentialBundleIds,
  DuplicateBundleKeyError,
} from "./ids.js";

describe("assignSequentialBundleIds", () => {
  it("assigns sequential prefixed ids in sorted key order, not input order", () => {
    const assignment = assignSequentialBundleIds(
      ["claim_c", "claim_a", "claim_b"],
      "d",
    );
    expect(assignment.orderedIds).toStrictEqual(["d1", "d2", "d3"]);
    expect(assignment.idByKey.get("claim_a")).toBe("d1");
    expect(assignment.idByKey.get("claim_b")).toBe("d2");
    expect(assignment.idByKey.get("claim_c")).toBe("d3");
  });

  it("builds an exact reverse map", () => {
    const assignment = assignSequentialBundleIds(["x", "y"], "o");
    expect(assignment.keyById.get("o1")).toBe("x");
    expect(assignment.keyById.get("o2")).toBe("y");
  });

  it("is identical across two calls with the same keys", () => {
    const first = assignSequentialBundleIds(["b", "a"], "e");
    const second = assignSequentialBundleIds(["a", "b"], "e");
    expect(first.orderedIds).toStrictEqual(second.orderedIds);
    expect([...first.idByKey.entries()]).toStrictEqual([...second.idByKey.entries()]);
  });

  it("changes when the key set changes", () => {
    const first = assignSequentialBundleIds(["a", "b"], "e");
    const second = assignSequentialBundleIds(["a", "b", "c"], "e");
    expect(first.idByKey.get("b")).toBe("e2");
    expect(second.idByKey.get("b")).toBe("e2");
    expect(second.orderedIds).toHaveLength(3);
    expect(first.orderedIds).toHaveLength(2);
  });

  it("returns empty maps for an empty key set", () => {
    const assignment = assignSequentialBundleIds([], "r");
    expect(assignment.orderedIds).toStrictEqual([]);
    expect(assignment.idByKey.size).toBe(0);
  });

  it("throws on a duplicate key", () => {
    expect(() => assignSequentialBundleIds(["a", "a"], "d")).toThrow(
      DuplicateBundleKeyError,
    );
  });
});

describe("the four typed allocators", () => {
  it("use their own distinct prefixes", () => {
    expect(assignDisclosureIds(["x"]).orderedIds).toStrictEqual(["d1"]);
    expect(assignOutcomeIds(["x"]).orderedIds).toStrictEqual(["o1"]);
    expect(assignEpisodeIds(["x"]).orderedIds).toStrictEqual(["e1"]);
    expect(assignRenderingIds(["x"]).orderedIds).toStrictEqual(["r1"]);
  });
});
