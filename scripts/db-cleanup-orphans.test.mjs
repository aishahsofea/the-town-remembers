import assert from "node:assert/strict";
import test from "node:test";

import {
  dropOrphanDatabases,
  isOrphanDatabaseName,
  listDatabaseNames,
  selectOrphanNames,
} from "./db-cleanup-orphans.mjs";

test("recognizes every scratch/disposable prefix this repo generates", () => {
  assert.equal(isOrphanDatabaseName("ttr_test_ab12cd34ef56"), true);
  assert.equal(isOrphanDatabaseName("ttr_doctor_1a2b3c"), true);
  assert.equal(isOrphanDatabaseName("ttr_explain_check_1786629398514"), true);
});

test("never matches a real, non-scratch database name", () => {
  for (const name of [
    "defaultdb",
    "postgres",
    "system",
    "ttr_production",
    "ttr_test",
  ]) {
    assert.equal(isOrphanDatabaseName(name), false, name);
  }
});

test("selectOrphanNames filters and sorts", () => {
  const names = [
    "postgres",
    "ttr_test_zzzzzzzzzzzz",
    "system",
    "ttr_test_aaaaaaaaaaaa",
  ];
  assert.deepEqual(selectOrphanNames(names), [
    "ttr_test_aaaaaaaaaaaa",
    "ttr_test_zzzzzzzzzzzz",
  ]);
});

test("listDatabaseNames reads database_name off SHOW DATABASES rows", async () => {
  const calls = [];
  const fakePool = {
    query: async (sql) => {
      calls.push(sql);
      return {
        rows: [
          { database_name: "defaultdb" },
          { database_name: "ttr_test_ab12cd34ef56" },
        ],
      };
    },
  };
  const names = await listDatabaseNames(fakePool);
  assert.deepEqual(names, ["defaultdb", "ttr_test_ab12cd34ef56"]);
  assert.deepEqual(calls, ["SHOW DATABASES"]);
});

test("dropOrphanDatabases only issues DROP DATABASE for orphan-shaped names", async () => {
  const dropped = [];
  const fakePool = {
    query: async (sql) => {
      dropped.push(sql);
      return { rows: [] };
    },
  };
  const result = await dropOrphanDatabases(fakePool, [
    "ttr_test_ab12cd34ef56",
    "postgres",
  ]);
  assert.deepEqual(result.dropped, ["ttr_test_ab12cd34ef56"]);
  assert.deepEqual(result.skipped, ["postgres"]);
  assert.deepEqual(dropped, [
    'DROP DATABASE IF EXISTS "ttr_test_ab12cd34ef56" CASCADE',
  ]);
});

test("dropOrphanDatabases never issues a query for a non-orphan name", async () => {
  let queried = false;
  const fakePool = {
    query: async () => {
      queried = true;
      return { rows: [] };
    },
  };
  await dropOrphanDatabases(fakePool, ["defaultdb", "system", "postgres"]);
  assert.equal(queried, false);
});
