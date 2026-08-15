import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { formatTable, runProfile, writeSummary } from "./validate-profile.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fakeTicker(startMs = 0) {
  let elapsedMs = startMs;
  return () => {
    elapsedMs += 10;
    return BigInt(elapsedMs) * 1_000_000n;
  };
}

test("runs every stage and reports a passing summary", () => {
  const stages = [
    { name: "one", script: "one" },
    { name: "two", script: "two" },
  ];
  const calledScripts = [];
  const { summary, exitCode } = runProfile({
    stages,
    spawnFn: (script) => {
      calledScripts.push(script);
      return { status: 0 };
    },
    now: fakeTicker(),
  });

  assert.equal(exitCode, 0);
  assert.equal(summary.ok, true);
  assert.deepEqual(calledScripts, ["one", "two"]);
  assert.equal(summary.stages.length, 2);
  assert.equal(summary.stages[0].status, "passed");
  assert.ok(summary.stages[0].durationMs > 0);
});

test("stops at the first failing stage and does not run later ones", () => {
  const stages = [
    { name: "one", script: "one" },
    { name: "two", script: "two" },
    { name: "three", script: "three" },
  ];
  const calledScripts = [];
  const { summary, exitCode } = runProfile({
    stages,
    spawnFn: (script) => {
      calledScripts.push(script);
      return { status: script === "two" ? 3 : 0 };
    },
    now: fakeTicker(),
  });

  assert.equal(exitCode, 3);
  assert.equal(summary.ok, false);
  assert.deepEqual(calledScripts, ["one", "two"]);
  assert.equal(summary.stages.length, 2);
  assert.equal(summary.stages[1].status, "failed");
  assert.equal(summary.stages[1].exitCode, 3);
});

test("returns the first failing stage's exit status, not a generic 1", () => {
  const stages = [{ name: "one", script: "one" }];
  const { exitCode } = runProfile({
    stages,
    spawnFn: () => ({ status: 42 }),
    now: fakeTicker(),
  });
  assert.equal(exitCode, 42);
});

test("treats a signal-terminated stage as failed", () => {
  const stages = [{ name: "one", script: "one" }];
  const { summary, exitCode } = runProfile({
    stages,
    spawnFn: () => ({ status: null, signal: "SIGKILL" }),
    now: fakeTicker(),
  });
  assert.equal(summary.stages[0].status, "failed");
  assert.equal(exitCode, 1);
});

test("checks for an active database owner before a database-touching stage and blocks without running it", () => {
  const stages = [
    { name: "test", script: "test", touchesDatabase: true },
    { name: "later", script: "later" },
  ];
  const calledScripts = [];
  const { summary, exitCode } = runProfile({
    stages,
    spawnFn: (script) => {
      calledScripts.push(script);
      return { status: 0 };
    },
    checkNoActiveOwner: () => {
      throw new Error("Another database suite is already running: test:db (pid 123)");
    },
    now: fakeTicker(),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calledScripts, []);
  assert.equal(summary.stages[0].status, "blocked");
  assert.match(summary.stages[0].message, /test:db/);
});

test("does not check ownership before a stage that does not touch the database", () => {
  const stages = [{ name: "lint", script: "lint" }];
  let checked = false;
  runProfile({
    stages,
    spawnFn: () => ({ status: 0 }),
    checkNoActiveOwner: () => {
      checked = true;
    },
    now: fakeTicker(),
  });
  assert.equal(checked, false);
});

test("passes stage-specific env on top of the base env without mutating it", () => {
  const baseEnv = { PATH: "/usr/bin" };
  let seenEnv;
  runProfile({
    stages: [{ name: "test", script: "test", env: { TTR_REQUIRE_DB_TESTS: "1" } }],
    env: baseEnv,
    spawnFn: (_script, env) => {
      seenEnv = env;
      return { status: 0 };
    },
    now: fakeTicker(),
  });
  assert.equal(seenEnv.TTR_REQUIRE_DB_TESTS, "1");
  assert.equal(seenEnv.PATH, "/usr/bin");
  assert.equal(baseEnv.TTR_REQUIRE_DB_TESTS, undefined);
});

test("summary JSON names every stage's duration and status and carries no env values", () => {
  const { summary } = runProfile({
    stages: [{ name: "one", script: "one", env: { SECRET_TOKEN: "shh" } }],
    env: { SECRET_TOKEN: "shh" },
    spawnFn: () => ({ status: 0 }),
    now: fakeTicker(),
  });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /shh/);
  assert.ok(Number.isFinite(summary.stages[0].durationMs));
  assert.equal(summary.stages[0].status, "passed");
});

test("formatTable lists every stage with its duration", () => {
  const { summary } = runProfile({
    stages: [
      { name: "one", script: "one" },
      { name: "two", script: "two" },
    ],
    spawnFn: () => ({ status: 0 }),
    now: fakeTicker(),
  });
  const table = formatTable(summary);
  assert.match(table, /one/);
  assert.match(table, /two/);
  assert.match(table, /total/);
});

test("writeSummary writes a JSON file that round-trips the summary", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-validate-profile-"));
  temporaryDirectories.push(outDir);

  const { summary } = runProfile({
    stages: [{ name: "one", script: "one" }],
    spawnFn: () => ({ status: 0 }),
    now: fakeTicker(),
  });
  const filePath = writeSummary(summary, { outDir, label: "cold" });

  assert.ok(fs.existsSync(filePath));
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(parsed.label, "cold");
  assert.equal(parsed.stages.length, 1);
});
