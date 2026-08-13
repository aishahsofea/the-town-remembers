#!/usr/bin/env node

/**
 * Fails the build when `packages/content`'s authored asset keys and
 * `apps/web`'s manifest disagree.
 *
 * The two lists cannot share an import: `packages/content` depends on
 * `packages/serialization`, which imports `node:crypto`, and
 * `scripts/check-bundle-safety.mjs` forbids both substrings in the browser
 * bundle (`D3-K`, Phase 3 execution detail §9.5). This scans each file's own
 * source text for the shared literal shape rather than importing either
 * package, so it needs no build and runs the same way `test:tooling` does.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ASSET_KEY_PATTERN = /["'`](bell-mystery-v1\/[a-z0-9-]+\/[a-z0-9-]+)["'`]/g;

export const CONTENT_PRESENTATION_PATH = "packages/content/src/presentation.ts";
export const WEB_MANIFEST_PATH = "apps/web/src/assets/manifest.ts";

function extractAssetKeys(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const keys = new Set();
  for (const match of source.matchAll(ASSET_KEY_PATTERN)) keys.add(match[1]);
  return keys;
}

/**
 * Returns the keys each side has that the other lacks. Both empty means the
 * two lists agree exactly.
 */
export function findAssetKeyDrift(rootDir) {
  const contentKeys = extractAssetKeys(path.join(rootDir, CONTENT_PRESENTATION_PATH));
  const webKeys = extractAssetKeys(path.join(rootDir, WEB_MANIFEST_PATH));

  return {
    missingFromWeb: [...contentKeys].filter((key) => !webKeys.has(key)).toSorted(),
    missingFromContent: [...webKeys].filter((key) => !contentKeys.has(key)).toSorted(),
  };
}

function runCli() {
  const rootDir = process.argv[2] ?? process.cwd();
  const drift = findAssetKeyDrift(rootDir);

  if (drift.missingFromWeb.length === 0 && drift.missingFromContent.length === 0) {
    console.log("Content and web asset keys agree.");
    return;
  }

  console.error("Asset key drift detected:");
  for (const key of drift.missingFromWeb) {
    console.error(
      `- ${key} is authored in ${CONTENT_PRESENTATION_PATH} but missing from ${WEB_MANIFEST_PATH}.`,
    );
  }
  for (const key of drift.missingFromContent) {
    console.error(
      `- ${key} is listed in ${WEB_MANIFEST_PATH} but missing from ${CONTENT_PRESENTATION_PATH}.`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runCli();
}
