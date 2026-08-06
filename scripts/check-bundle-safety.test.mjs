import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { findBundleViolations } from "./check-bundle-safety.mjs";

const temporaryDirectories = [];

function makeBundle(files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-bundle-"));
  temporaryDirectories.push(rootDir);
  for (const [name, contents] of Object.entries(files)) {
    const filePath = path.join(rootDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }
  return rootDir;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("accepts a bundle carrying only public configuration", () => {
  const rootDir = makeBundle({
    "index.html": "<html></html>",
    "assets/index-abc.js": 'const environment="local";const build="a1b2c3d";',
    "assets/index-abc.css": "body{margin:0}",
  });
  assert.deepEqual(findBundleViolations(rootDir), []);
});

test("fails when there is no built output to inspect", () => {
  const violations = findBundleViolations(path.join(os.tmpdir(), "definitely-absent"));
  assert.equal(violations.length, 1);
  assert.equal(violations[0].code, "missing_bundle");
});

for (const forbidden of [
  "TTR_MIGRATION_DATABASE_URL",
  "TTR_APP_ORIGIN",
  "postgresql://user@host/db",
  "node:crypto",
  "@the-town-remembers/runtime-config",
  "aws-lambda",
]) {
  test(`rejects a bundle mentioning ${forbidden}`, () => {
    const rootDir = makeBundle({ "assets/index.js": `import "${forbidden}";` });
    const violations = findBundleViolations(rootDir);
    assert.ok(violations.some((violation) => violation.code === "server_concern"));
  });
}

for (const [label, contents] of [
  ["a judge code", "const JUDGE_CODE='x';"],
  ["a signing key", "const SIGNING_KEY='x';"],
  ["a private key", "-----BEGIN RSA PRIVATE KEY-----"],
  ["an access key id", "AKIAIOSFODNN7EXAMPLE"],
]) {
  test(`rejects a bundle containing ${label}`, () => {
    const rootDir = makeBundle({ "assets/index.js": contents });
    const violations = findBundleViolations(rootDir);
    assert.ok(violations.some((violation) => violation.code === "credential_shaped"));
  });
}

test("rejects a browser variable outside the two public names", () => {
  const rootDir = makeBundle({ "assets/index.js": "const x=VITE_TTR_JUDGE_CODE;" });
  const violations = findBundleViolations(rootDir);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].code, "unexpected_public_variable");
  assert.equal(violations[0].detail, "VITE_TTR_JUDGE_CODE");
});

test("allows the two documented public variable names", () => {
  const rootDir = makeBundle({
    "assets/index.js": "VITE_TTR_ENV;VITE_TTR_BUILD_ID;",
  });
  assert.deepEqual(findBundleViolations(rootDir), []);
});

test("never repeats a matched credential in its own output", () => {
  const rootDir = makeBundle({ "assets/index.js": "AKIAIOSFODNN7EXAMPLE" });
  assert.doesNotMatch(
    JSON.stringify(findBundleViolations(rootDir)),
    /AKIAIOSFODNN7EXAMPLE/,
  );
});

test("ignores files that are not part of the shipped bundle", () => {
  const rootDir = makeBundle({ "assets/index.js.map": "postgresql://user@host/db" });
  assert.equal(findBundleViolations(rootDir)[0].code, "missing_bundle");
});
