#!/usr/bin/env node

/**
 * Runs the local development pair: the Game API adapter and the Vite server.
 *
 * Both are started from one place so their ports cannot disagree, and so a
 * contributor's first command is the same one the browser journey uses.
 * Passing `--api-only` starts the API alone, which is what Playwright needs
 * when it manages the Vite server itself.
 */

import { spawn } from "node:child_process";
import process from "node:process";

import { applyLocalDefaults } from "./local-env.mjs";

applyLocalDefaults();

const apiOnly = process.argv.includes("--api-only");
const children = [];

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  child.on("exit", (code, signal) => {
    if (signal === "SIGINT" || signal === "SIGTERM") return;
    stopAll();
    process.exit(code ?? 1);
  });
  children.push({ name, child });
  return child;
}

function stopAll() {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

start("game-api", process.execPath, ["apps/game-api/dist/main.js"]);
if (!apiOnly) {
  // Vite resolves from the web workspace, not the repository root.
  start("web", process.execPath, [
    "apps/web/node_modules/vite/bin/vite.js",
    "--config",
    "apps/web/vite.config.ts",
  ]);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(0);
  });
}
