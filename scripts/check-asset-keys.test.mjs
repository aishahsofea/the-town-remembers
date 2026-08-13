import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  CONTENT_PRESENTATION_PATH,
  WEB_MANIFEST_PATH,
  findAssetKeyDrift,
} from "./check-asset-keys.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(contentKeys, webKeys) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "town-asset-keys-"));
  temporaryDirectories.push(rootDir);

  const write = (relativePath, keys) => {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const literalArray = keys.map((key) => `  "${key}",`).join("\n");
    fs.writeFileSync(filePath, `export const KEYS = [\n${literalArray}\n];\n`);
  };

  write(CONTENT_PRESENTATION_PATH, contentKeys);
  write(WEB_MANIFEST_PATH, webKeys);
  return rootDir;
}

test("reports no drift when both sides list the same keys", () => {
  const rootDir = createFixture(
    ["bell-mystery-v1/scenes/festival-square", "bell-mystery-v1/portraits/mara-venn"],
    ["bell-mystery-v1/portraits/mara-venn", "bell-mystery-v1/scenes/festival-square"],
  );

  assert.deepEqual(findAssetKeyDrift(rootDir), {
    missingFromWeb: [],
    missingFromContent: [],
  });
});

test("reports a key content authored but the web manifest lacks", () => {
  const rootDir = createFixture(
    ["bell-mystery-v1/scenes/festival-square", "bell-mystery-v1/scenes/old-chapel"],
    ["bell-mystery-v1/scenes/festival-square"],
  );

  assert.deepEqual(findAssetKeyDrift(rootDir), {
    missingFromWeb: ["bell-mystery-v1/scenes/old-chapel"],
    missingFromContent: [],
  });
});

test("reports a key the web manifest lists but content never authored", () => {
  const rootDir = createFixture(
    ["bell-mystery-v1/scenes/festival-square"],
    ["bell-mystery-v1/scenes/festival-square", "bell-mystery-v1/portraits/nessa-reed"],
  );

  assert.deepEqual(findAssetKeyDrift(rootDir), {
    missingFromWeb: [],
    missingFromContent: ["bell-mystery-v1/portraits/nessa-reed"],
  });
});

test("the real repository's two lists agree", () => {
  const rootDir = path.resolve(import.meta.dirname, "..");
  assert.deepEqual(findAssetKeyDrift(rootDir), {
    missingFromWeb: [],
    missingFromContent: [],
  });
});
