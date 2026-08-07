#!/usr/bin/env node

/**
 * Local CockroachDB lifecycle for tests and operator commands.
 *
 * Phase 1 promises schema, constraint, grant, vector, and serialization
 * behavior verified against real CockroachDB. This script owns the disposable
 * instance those checks run against: it downloads one pinned build into an
 * ignored directory, starts a single insecure node bound to the loopback
 * interface, and stops it again.
 *
 * A pinned build matters more than a convenient one. `VECTOR(256)`, predicated
 * vector indexes, and transactional DDL all depend on the version, so the
 * capability probe in `db-doctor.mjs` refuses to run against an unrecognized
 * build rather than discovering the gap inside a migration.
 *
 * Docker is deliberately not used. The daemon is not reliably running on a
 * development machine, and a single node satisfies every check this phase
 * makes.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { REPOSITORY_ROOT, applyLocalDefaults } from "./local-env.mjs";

/** The build every command in this repository runs against. */
export const COCKROACH_VERSION = "v25.4.3";

export const DEFAULT_SQL_PORT = 26257;
export const DEFAULT_HTTP_PORT = 8081;

const DOWNLOAD_ORIGIN = "https://binaries.cockroachdb.com";
const INSTALL_DIRECTORY = path.join(REPOSITORY_ROOT, ".cockroach");
const BINARY_PATH = path.join(INSTALL_DIRECTORY, "bin", "cockroach");
const STORE_PATH = path.join(INSTALL_DIRECTORY, "data");
const PID_PATH = path.join(INSTALL_DIRECTORY, "cockroach.pid");
const LOG_PATH = path.join(INSTALL_DIRECTORY, "start.log");

/**
 * CockroachDB publishes one asset per platform and its names are not uniform:
 * macOS carries a minimum OS version in the name and uses `arm64`, not the
 * `aarch64` spelling the Go toolchain would suggest.
 */
export function assetNameFor(platform, architecture) {
  const suffix = {
    "darwin:arm64": "darwin-11.0-arm64",
    "darwin:x64": "darwin-10.9-amd64",
    "linux:arm64": "linux-arm64",
    "linux:x64": "linux-amd64",
  }[`${platform}:${architecture}`];

  if (suffix === undefined) {
    throw new Error(
      `CockroachDB ${COCKROACH_VERSION} has no published build for ${platform}/${architecture}.`,
    );
  }
  return `cockroach-${COCKROACH_VERSION}.${suffix}`;
}

export function downloadUrlFor(platform, architecture) {
  return `${DOWNLOAD_ORIGIN}/${assetNameFor(platform, architecture)}.tgz`;
}

/** `cockroach version` prints a key/value block; only the build tag matters. */
export function parseBuildTag(versionOutput) {
  const match = versionOutput.match(/^Build Tag:\s+(\S+)/m);
  return match?.[1];
}

export function binaryPath() {
  return BINARY_PATH;
}

function sqlPort(env) {
  const configured = Number.parseInt(env.TTR_TEST_DB_PORT ?? "", 10);
  return Number.isInteger(configured) ? configured : DEFAULT_SQL_PORT;
}

function httpPort(env) {
  const configured = Number.parseInt(env.TTR_TEST_DB_HTTP_PORT ?? "", 10);
  return Number.isInteger(configured) ? configured : DEFAULT_HTTP_PORT;
}

export function adminUrlFor(port = DEFAULT_SQL_PORT) {
  return `postgresql://root@127.0.0.1:${port}/defaultdb?sslmode=disable`;
}

/**
 * A listening port is the only reliable readiness signal here: the node
 * daemonizes itself, so process existence says nothing about whether SQL is
 * accepting connections.
 */
export function isPortOpen(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
    socket.connect(port, host);
  });
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export function isInstalled() {
  if (!fs.existsSync(BINARY_PATH)) return false;
  try {
    const output = execFileSync(BINARY_PATH, ["version"], { encoding: "utf8" });
    return parseBuildTag(output) === COCKROACH_VERSION;
  } catch {
    return false;
  }
}

export async function ensureInstalled({ log = console.log } = {}) {
  if (isInstalled()) return BINARY_PATH;

  const url = downloadUrlFor(process.platform, os.arch());
  log(`Downloading CockroachDB ${COCKROACH_VERSION} from ${DOWNLOAD_ORIGIN}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status} for ${url}.`);
  }

  fs.mkdirSync(INSTALL_DIRECTORY, { recursive: true });
  const archivePath = path.join(INSTALL_DIRECTORY, "download.tgz");
  fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

  const extractDirectory = path.join(INSTALL_DIRECTORY, "extract");
  fs.rmSync(extractDirectory, { recursive: true, force: true });
  fs.mkdirSync(extractDirectory, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", extractDirectory]);

  const extracted = path.join(
    extractDirectory,
    assetNameFor(process.platform, os.arch()),
    "cockroach",
  );
  fs.mkdirSync(path.dirname(BINARY_PATH), { recursive: true });
  fs.copyFileSync(extracted, BINARY_PATH);
  fs.chmodSync(BINARY_PATH, 0o755);
  fs.rmSync(extractDirectory, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });

  if (!isInstalled()) {
    throw new Error(`Installed binary does not report build tag ${COCKROACH_VERSION}.`);
  }
  log(`Installed ${BINARY_PATH}`);
  return BINARY_PATH;
}

export async function start({ env = process.env, log = console.log } = {}) {
  const port = sqlPort(env);
  if (await isPortOpen(port)) {
    log(`CockroachDB is already listening on 127.0.0.1:${port}`);
    return { port, started: false };
  }

  await ensureInstalled({ log });
  fs.mkdirSync(STORE_PATH, { recursive: true });

  // `--background` daemonizes, and the daemon inherits whatever stdio it is
  // given. A pipe would therefore stay open after the direct child exits and
  // `spawnSync` would never return, so both streams go to a file instead.
  const logFile = fs.openSync(LOG_PATH, "a");
  let result;
  try {
    result = spawnSync(
      BINARY_PATH,
      [
        "start-single-node",
        "--insecure",
        `--listen-addr=127.0.0.1:${port}`,
        `--http-addr=127.0.0.1:${httpPort(env)}`,
        `--store=${STORE_PATH}`,
        `--pid-file=${PID_PATH}`,
        `--log-dir=${path.join(INSTALL_DIRECTORY, "logs")}`,
        "--background",
      ],
      { stdio: ["ignore", logFile, logFile] },
    );
  } finally {
    fs.closeSync(logFile);
  }

  if (result.status !== 0) {
    throw new Error(
      `CockroachDB failed to start; see ${path.relative(REPOSITORY_ROOT, LOG_PATH)}.`,
    );
  }

  if (!(await waitForPort(port))) {
    throw new Error(`CockroachDB did not accept connections on port ${port}.`);
  }

  log(`CockroachDB ${COCKROACH_VERSION} listening on 127.0.0.1:${port}`);
  return { port, started: true };
}

export async function stop({ env = process.env, log = console.log } = {}) {
  const port = sqlPort(env);
  if (!fs.existsSync(PID_PATH)) {
    log("No recorded CockroachDB process.");
    return { stopped: false };
  }

  const pid = Number.parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
  fs.rmSync(PID_PATH, { force: true });
  if (!Number.isInteger(pid)) return { stopped: false };

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    log("Recorded CockroachDB process was already gone.");
    return { stopped: false };
  }

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) {
      log("CockroachDB stopped.");
      return { stopped: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`CockroachDB did not stop within 20 seconds (pid ${pid}).`);
}

export async function status({ env = process.env, log = console.log } = {}) {
  const port = sqlPort(env);
  const running = await isPortOpen(port);
  log(
    running
      ? `CockroachDB is listening on 127.0.0.1:${port}`
      : `Nothing is listening on 127.0.0.1:${port}`,
  );
  return { running, port };
}

const COMMANDS = { ensure: ensureInstalled, start, stop, status };

async function runCli() {
  applyLocalDefaults();
  const name = process.argv[2] ?? "status";
  const command = COMMANDS[name];
  if (!command) {
    console.error(
      `Unknown command "${name}". Use: ${Object.keys(COMMANDS).join(", ")}.`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    await command({});
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  await runCli();
}
