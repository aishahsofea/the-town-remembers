/**
 * `P3-09` acceptance 7: no network or dependency call occurs inside a
 * `runSerializable` transaction. Scoped to the *callback body* passed to
 * `runSerializable(...)`, not the whole file — several files in this
 * directory legitimately call `pool.query` outside a transaction (ambiguous
 * commit resolution, D3-O) and legitimately import `http-contracts`, whose
 * package name itself contains the substring "http".
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [
  path.resolve(import.meta.dirname, ".."),
  path.resolve(import.meta.dirname, "../..", "persistence"),
];

function walkSourceFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(entryPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    files.push(entryPath);
  }
  return files;
}

const SOURCE_FILES = ROOTS.flatMap((root) => walkSourceFiles(root));

/** Every balanced-bracket substring starting at each `runSerializable(` call. */
function extractSerializableCallbackBodies(contents: string): readonly string[] {
  const bodies: string[] = [];
  const marker = "runSerializable(";
  let searchFrom = 0;

  for (;;) {
    const start = contents.indexOf(marker, searchFrom);
    if (start === -1) break;

    let depth = 0;
    let end = start + marker.length - 1;
    for (; end < contents.length; end += 1) {
      const char = contents[end];
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(contents.slice(start, end + 1));
    searchFrom = end + 1;
  }

  return bodies;
}

const FORBIDDEN_PATTERNS: readonly RegExp[] = [/\bfetch\s*\(/, /\bawait\s+pool\s*\./];

describe("no network or dependency call inside a runSerializable transaction", () => {
  it("scanned at least one call site", () => {
    const total = SOURCE_FILES.flatMap((file) =>
      extractSerializableCallbackBodies(fs.readFileSync(file, "utf8")),
    );
    expect(total.length).toBeGreaterThan(0);
  });

  for (const file of SOURCE_FILES) {
    it(`keeps every runSerializable body in ${path.relative(process.cwd(), file)} free of network calls`, () => {
      const contents = fs.readFileSync(file, "utf8");
      const bodies = extractSerializableCallbackBodies(contents);
      for (const body of bodies) {
        for (const pattern of FORBIDDEN_PATTERNS) {
          expect(body).not.toMatch(pattern);
        }
      }
    });
  }
});
