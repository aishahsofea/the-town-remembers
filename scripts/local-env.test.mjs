import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  REPOSITORY_ROOT,
  applyLocalDefaults,
  parseEnvFile,
  readLocalDefaults,
} from "./local-env.mjs";

const temporaryDirectories = [];

function makeRoot(files) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-local-env-"));
  temporaryDirectories.push(rootDir);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(rootDir, name), contents);
  }
  return rootDir;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("parses assignments and ignores comments and blank lines", () => {
  assert.deepEqual(
    parseEnvFile("# comment\n\nTTR_ENV=local\n  SPACED = value \nNO_SEPARATOR\n"),
    { TTR_ENV: "local", SPACED: "value" },
  );
});

test("keeps a value containing an equals sign intact", () => {
  assert.deepEqual(parseEnvFile("URL=postgresql://user:pass@host/db?a=b"), {
    URL: "postgresql://user:pass@host/db?a=b",
  });
});

test("lets an ignored .env override the committed defaults", () => {
  const rootDir = makeRoot({
    ".env.defaults": "TTR_ENV=local\nTTR_LOG_LEVEL=info\n",
    ".env": "TTR_LOG_LEVEL=debug\n",
  });
  assert.deepEqual(readLocalDefaults(rootDir), {
    TTR_ENV: "local",
    TTR_LOG_LEVEL: "debug",
  });
});

test("never overwrites a value the caller already set", () => {
  const rootDir = makeRoot({
    ".env.defaults": "TTR_ENV=local\nTTR_BUILD_ID=unknown\n",
  });
  const env = { TTR_ENV: "production" };
  applyLocalDefaults(env, rootDir);
  assert.deepEqual(env, { TTR_ENV: "production", TTR_BUILD_ID: "unknown" });
});

test("treats an empty value as unset", () => {
  const rootDir = makeRoot({ ".env.defaults": "TTR_ENV=local\n" });
  const env = { TTR_ENV: "" };
  applyLocalDefaults(env, rootDir);
  assert.equal(env.TTR_ENV, "local");
});

test("returns an empty set when no file exists", () => {
  assert.deepEqual(readLocalDefaults(makeRoot({})), {});
});

test("the committed defaults carry no credential", () => {
  const defaults = parseEnvFile(
    fs.readFileSync(path.join(REPOSITORY_ROOT, ".env.defaults"), "utf8"),
  );
  for (const [name, value] of Object.entries(defaults)) {
    assert.doesNotMatch(
      name,
      /SECRET|TOKEN|PASSWORD|CREDENTIAL|KEY|JUDGE|DATABASE_URL/i,
    );
    assert.doesNotMatch(value, /:\/\/|AKIA|-----BEGIN/);
  }
  assert.deepEqual(Object.keys(defaults).toSorted(), ["TTR_ENV", "VITE_TTR_ENV"]);
});
