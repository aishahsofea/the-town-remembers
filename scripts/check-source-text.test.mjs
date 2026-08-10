import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { checkSourceText, findControlBytes } from "./check-source-text.mjs";

/**
 * Every offending byte here is written as a textual escape and never as a
 * literal, so this file stays text itself — the last test below holds the
 * whole repository, including this one, to that rule.
 */
const NUL = "\u0000";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-source-text-"));
  temporaryDirectories.push(rootDir);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return rootDir;
}

test("accepts ordinary source, including tabs and CRLF line endings", () => {
  const rootDir = createFixture({
    "src/a.ts": "export const a = 1;\r\n\texport const b = 2;\n",
    "docs/notes.md": "# Title\n\nSome prose — with an em dash.\n",
  });
  assert.deepEqual(checkSourceText(rootDir), []);
});

test("reports a NUL byte with its line and column", () => {
  const rootDir = createFixture({
    "src/key.ts": `const key = "a${NUL}b";\n`,
  });
  const violations = checkSourceText(rootDir);
  assert.equal(violations.length, 1);
  assert.equal(path.relative(rootDir, violations[0].path), path.join("src", "key.ts"));
  assert.equal(violations[0].line, 1);
  assert.equal(violations[0].column, 15);
  assert.equal(violations[0].byte, 0x00);
});

test("counts lines from the newlines before the offending byte", () => {
  const findings = findControlBytes(Buffer.from(`one\ntwo\nth${NUL}ree\n`));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
  assert.equal(findings[0].column, 3);
});

test("ignores build output and dependencies", () => {
  const rootDir = createFixture({
    "dist/bundle.js": `const x = "${NUL}";\n`,
    "node_modules/pkg/index.js": `const y = "${NUL}";\n`,
    "coverage/report.json": `{"a":"${NUL}"}\n`,
  });
  assert.deepEqual(checkSourceText(rootDir), []);
});

test("ignores other git worktrees checked out under .claude", () => {
  const rootDir = createFixture({
    ".claude/worktrees/some-session/src/key.ts": `const key = "a${NUL}b";\n`,
  });
  assert.deepEqual(checkSourceText(rootDir), []);
});

test("ignores file types that are legitimately binary", () => {
  const rootDir = createFixture({
    "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
  });
  assert.deepEqual(checkSourceText(rootDir), []);
});

test("the repository itself is clean", () => {
  const rootDir = path.resolve(import.meta.dirname, "..");
  assert.deepEqual(checkSourceText(rootDir), []);
});
