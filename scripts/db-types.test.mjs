import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { domainUnionFor, generate, readSnapshot, typeFor } from "./db-types.mjs";

const OUTPUT_PATH = new URL("../packages/database/src/schema.ts", import.meta.url);

test("the committed interface matches what the snapshot produces", async () => {
  // Regenerating and comparing, rather than regenerating and writing, is the
  // point: a hand edit to schema.ts fails here instead of silently disagreeing
  // with the migrated schema.
  const expected = generate(await readSnapshot());
  assert.equal(await readFile(OUTPUT_PATH, "utf8"), expected);
});

test("closed domains become literal unions", () => {
  assert.equal(
    domainUnionFor("status", {
      ck: "CHECK ((status IN ('active':::STRING, 'ended':::STRING)))",
    }),
    '"active" | "ended"',
  );
});

test("a column's widest IN list wins over a narrower case within it", () => {
  // agent_runs.purpose appears in its domain check and, more narrowly, inside
  // the contract-version check. The domain is the wider one.
  const union = domainUnionFor("purpose", {
    ck_domain: "CHECK ((purpose IN ('a':::STRING, 'b':::STRING, 'c':::STRING)))",
    ck_versions: "CHECK (CASE WHEN purpose IN ('b':::STRING) THEN true ELSE false END)",
  });
  assert.equal(union, '"a" | "b" | "c"');
});

test("a column with no closed domain stays a string", () => {
  assert.equal(
    domainUnionFor("display_name", { ck: "CHECK ((length(x) = 32))" }),
    undefined,
  );
  assert.equal(
    typeFor("display_name", { type: "text", nullable: false, default: null }, {}),
    "string",
  );
});

test("nullability is part of the column type", () => {
  assert.equal(
    typeFor("embedding", { type: "vector", nullable: true, default: null }, {}),
    "Vector256 | null",
  );
});

test("every wire type the schema uses has a mapping", async () => {
  const snapshot = await readSnapshot();
  for (const [table, details] of Object.entries(snapshot.tables)) {
    for (const [column, column_details] of Object.entries(details.columns)) {
      assert.notEqual(
        typeFor(column, column_details, details.constraints),
        "unknown",
        `${table}.${column} has no type mapping`,
      );
    }
  }
});

test("append-only tables expose no updatable column", async () => {
  const generated = await readFile(OUTPUT_PATH, "utf8");
  const block = /export interface WorldEventsTable \{([^}]*)\}/.exec(generated);
  assert.ok(block);
  for (const line of block[1].split("\n").filter((line) => line.trim() !== "")) {
    assert.match(line, /, never>;$/, `world_events column is updatable: ${line}`);
  }
});

test("episodes may update only its derived embedding columns", async () => {
  const generated = await readFile(OUTPUT_PATH, "utf8");
  const block = /export interface EpisodesTable \{([^}]*)\}/.exec(generated);
  assert.ok(block);
  const updatable = block[1]
    .split("\n")
    .filter((line) => line.includes(":") && !line.includes(", never>;"))
    .map((line) => line.trim().split(":")[0]);
  assert.deepEqual(updatable.toSorted(), ["embedding", "embedding_status"]);
});

test("every table and view is reachable through the Database interface", async () => {
  const snapshot = await readSnapshot();
  const generated = await readFile(OUTPUT_PATH, "utf8");
  for (const table of Object.keys(snapshot.tables)) {
    assert.ok(generated.includes(`"public.${table}":`), table);
  }
  for (const view of snapshot.views) {
    assert.ok(generated.includes(`"inspection.${view}":`), view);
  }
});
