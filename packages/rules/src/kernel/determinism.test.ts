import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `packages/rules` must be reproducible from its inputs alone (`D2-G`) and
 * must never smuggle a real database client past its type-only surface
 * (`D2-A`). Both properties are structural, so they are enforced here by
 * scanning source text rather than by convention.
 */

const SRC_ROOT = path.resolve(import.meta.dirname, "..");

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
    if (path.relative(SRC_ROOT, entryPath).startsWith(`testing${path.sep}`)) continue;
    files.push(entryPath);
  }
  return files;
}

const NON_TEST_SOURCE_FILES = walkSourceFiles(SRC_ROOT);
const FORBIDDEN_CALL_PATTERNS: readonly RegExp[] = [
  /\bDate\.now\s*\(/,
  /\bcrypto\.randomUUID\s*\(/,
  /\bprocess\.env\b/,
];
const FORBIDDEN_DATABASE_SPECIFIERS: readonly RegExp[] = [
  /["']@the-town-remembers\/database["']/,
  /["']@the-town-remembers\/database\/client["']/,
  /["']@the-town-remembers\/database\/transaction["']/,
  /["']@the-town-remembers\/database\/errors["']/,
];

describe("determinism: no ambient reads and no real database client import", () => {
  it("scanned at least one non-test source file", () => {
    expect(NON_TEST_SOURCE_FILES.length).toBeGreaterThan(0);
  });

  it("keeps every non-test source file free of ambient calls and database client imports", () => {
    const offenders: string[] = [];
    for (const filePath of NON_TEST_SOURCE_FILES) {
      const contents = fs.readFileSync(filePath, "utf8");
      const relativePath = path.relative(SRC_ROOT, filePath);
      for (const pattern of FORBIDDEN_CALL_PATTERNS) {
        if (pattern.test(contents)) {
          offenders.push(`${relativePath}: ambient call matching ${pattern}`);
        }
      }
      for (const pattern of FORBIDDEN_DATABASE_SPECIFIERS) {
        if (pattern.test(contents)) {
          offenders.push(`${relativePath}: database client import matching ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
