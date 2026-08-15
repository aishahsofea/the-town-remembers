import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G22: `packages/rules/README.md` and the `CONTRIBUTING.md` addition exist,
 * and a Phase 3 reader can follow the handoff examples without reading rule
 * source. This is a structural proof (the required sections are present),
 * not a claim that the prose itself is good — that's for a human reviewer.
 */

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

describe("packages/rules/README.md", () => {
  const readmePath = path.join(PACKAGE_ROOT, "README.md");
  const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";

  it("exists", () => {
    expect(fs.existsSync(readmePath)).toBe(true);
  });

  it("documents every section a Phase 3/4/5 handoff reader needs (G22)", () => {
    const requiredHeadings = [
      "Authority boundary and the pure-input/effect-plan pattern",
      "Adding a new rules or content version",
      "The five-step action order",
      "Stable-ordering catalog",
      "External-selection seam catalog",
      "Trace-field catalog",
      "Handoff examples for Phase 3/4/5",
    ];
    const missing = requiredHeadings.filter((heading) => !readme.includes(heading));
    expect(missing).toEqual([]);
  });
});

describe("CONTRIBUTING.md", () => {
  const contributingPath = path.join(REPO_ROOT, "CONTRIBUTING.md");
  const contents = fs.existsSync(contributingPath)
    ? fs.readFileSync(contributingPath, "utf8")
    : "";

  it("has a Rules package section pointing at packages/rules/README.md", () => {
    expect(contents).toContain("## Rules package");
    expect(contents).toContain("packages/rules/README.md");
  });
});
