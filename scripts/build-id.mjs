#!/usr/bin/env node

/**
 * Resolves the build identity injected into the health route and the browser
 * bundle. It reads no secret and reaches no network. Resolution order is the
 * explicit environment value, then the short Git revision, then `unknown`.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import path from "node:path";

const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const UNKNOWN_BUILD_ID = "unknown";

export function resolveBuildId(env = process.env, readGitRevision = gitRevision) {
  const configured = env["TTR_BUILD_ID"]?.trim();
  if (configured && BUILD_ID_PATTERN.test(configured)) return configured;

  const revision = readGitRevision();
  if (revision && BUILD_ID_PATTERN.test(revision)) return revision;

  return UNKNOWN_BUILD_ID;
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  process.stdout.write(`${resolveBuildId()}\n`);
}
