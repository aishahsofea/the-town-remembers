import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGeneratedBlock,
  checkAdapterContent,
  computeChecksum,
  extractCoreBlock,
  syncAdapterContent,
} from "./sync-agent-test-policy.mjs";

const POLICY_FIXTURE = [
  "# Title",
  "",
  "intro prose",
  "",
  "<!-- test-policy:core:start -->",
  "1. rule one",
  "2. rule two",
  "<!-- test-policy:core:end -->",
  "",
  "more prose",
].join("\n");

test("extractCoreBlock returns the trimmed content between markers", () => {
  assert.equal(extractCoreBlock(POLICY_FIXTURE), "1. rule one\n2. rule two");
});

test("extractCoreBlock throws when markers are missing", () => {
  assert.throws(() => extractCoreBlock("# no markers here"), /missing matching/);
});

test("computeChecksum is deterministic and sensitive to content changes", () => {
  const a = computeChecksum("1. rule one");
  const b = computeChecksum("1. rule one");
  const c = computeChecksum("1. rule two");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{12}$/);
});

test("buildGeneratedBlock embeds the checksum and core text between stable markers", () => {
  const block = buildGeneratedBlock("1. rule one", "abcdef123456");
  assert.match(block, /^<!-- test-policy:start checksum=abcdef123456 -->/);
  assert.match(block, /<!-- test-policy:end -->$/);
  assert.ok(block.includes("1. rule one"));
});

test("syncAdapterContent inserts the block after the first heading when absent", () => {
  const original = "# My Adapter\n\nSome existing instructions.\n";
  const block = buildGeneratedBlock("core text", "abcdef123456");
  const result = syncAdapterContent(original, block);
  assert.ok(result.startsWith("# My Adapter\n\n<!-- test-policy:start"));
  assert.ok(result.includes("Some existing instructions."));
});

test("syncAdapterContent replaces only the existing block, preserving surrounding content", () => {
  const oldBlock = buildGeneratedBlock("old core text", "111111111111");
  const original = `# Adapter\n\nbefore\n\n${oldBlock}\n\nafter\n`;
  const newBlock = buildGeneratedBlock("new core text", "222222222222");
  const result = syncAdapterContent(original, newBlock);
  assert.ok(result.includes("before"));
  assert.ok(result.includes("after"));
  assert.ok(result.includes("new core text"));
  assert.ok(!result.includes("old core text"));
});

test("checkAdapterContent fails when no block is present", () => {
  const result = checkAdapterContent(
    "# Adapter\n\nnothing generated here\n",
    "irrelevant",
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /no generated test-policy block/);
});

test("checkAdapterContent fails when the block has drifted", () => {
  const block = buildGeneratedBlock("core text", "abcdef123456");
  const handEdited = block.replace("core text", "hand-edited text");
  const content = `# Adapter\n\n${handEdited}\n`;
  const result = checkAdapterContent(content, block);
  assert.equal(result.ok, false);
  assert.match(result.reason, /drifted/);
});

test("checkAdapterContent passes when the block matches exactly", () => {
  const block = buildGeneratedBlock("core text", "abcdef123456");
  const content = `# Adapter\n\n${block}\n`;
  const result = checkAdapterContent(content, block);
  assert.deepEqual(result, { ok: true });
});
