import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { findArtifactViolations } from "./check-artifact-safety.mjs";

const temporaryDirectories = [];

function makeArtifacts(files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-artifact-"));
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

test("accepts an ordinary report bundle", () => {
  const rootDir = makeArtifacts({
    "index.html": "<html><body>6 passed</body></html>",
    "results.json": JSON.stringify({ status: "passed" }),
    "trace.zip": "binary",
  });
  assert.deepEqual(findArtifactViolations([rootDir]), []);
});

for (const name of [".env", ".env.production", "server.pem", "id_ed25519"]) {
  test(`refuses to publish ${name}`, () => {
    const rootDir = makeArtifacts({ [name]: "value" });
    const violations = findArtifactViolations([rootDir]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, "forbidden_file");
  });
}

for (const name of [".env.example", ".env.defaults"]) {
  test(`allows the documented ${name}`, () => {
    assert.deepEqual(
      findArtifactViolations([makeArtifacts({ [name]: "TTR_ENV=local" })]),
      [],
    );
  });
}

for (const [label, contents] of [
  ["a private key", "-----BEGIN RSA PRIVATE KEY-----\nabc\n"],
  ["an access key id", "key AKIAIOSFODNN7EXAMPLE here"],
  ["a database URL with a password", "postgresql://admin:hunter2@db.example:26257/x"],
  ["a bearer token", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"],
]) {
  test(`refuses to publish a report containing ${label}`, () => {
    const rootDir = makeArtifacts({ "report/index.html": contents });
    const violations = findArtifactViolations([rootDir]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].code, "forbidden_content");
  });
}

test("never repeats the matched secret in its own output", () => {
  const rootDir = makeArtifacts({ "log.txt": "postgresql://admin:hunter2@host/db" });
  const violations = findArtifactViolations([rootDir]);
  assert.doesNotMatch(JSON.stringify(violations), /hunter2/);
});

test("ignores a directory that does not exist", () => {
  assert.deepEqual(findArtifactViolations(["definitely-not-a-directory"]), []);
});
