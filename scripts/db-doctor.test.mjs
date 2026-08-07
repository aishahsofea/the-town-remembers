import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITY_PROBES, runProbes, scratchDatabaseName } from "./db-doctor.mjs";

test("every required capability has a probe", () => {
  assert.deepEqual(CAPABILITY_PROBES.map((probe) => probe.name).toSorted(), [
    "discriminated-foreign-key",
    "partial-unique-index",
    "predicated-vector-index",
    "transactional-ddl",
    "vector-column",
  ]);
});

test("scratch databases are namespaced so cleanup can be recognized", () => {
  assert.match(
    scratchDatabaseName(() => 0.5),
    /^ttr_doctor_[a-z0-9]+$/,
  );
});

test("a supported capability reports success without a reason", async () => {
  const results = await runProbes({}, [
    { name: "ok-probe", detail: "detail", run: () => Promise.resolve() },
  ]);
  assert.deepEqual(results, [{ name: "ok-probe", detail: "detail", supported: true }]);
});

test("an unsupported capability is named rather than swallowed", async () => {
  const results = await runProbes({}, [
    {
      name: "vector-column",
      detail: "VECTOR(256) episode embeddings",
      run: () => Promise.reject(new Error("type VECTOR does not exist")),
    },
  ]);
  assert.equal(results[0].supported, false);
  assert.equal(results[0].name, "vector-column");
  assert.match(results[0].reason, /VECTOR/);
});

test("one failing probe does not stop the others from reporting", async () => {
  const results = await runProbes({}, [
    { name: "a", detail: "a", run: () => Promise.reject(new Error("no")) },
    { name: "b", detail: "b", run: () => Promise.resolve() },
  ]);
  assert.deepEqual(
    results.map((result) => result.supported),
    [false, true],
  );
});
