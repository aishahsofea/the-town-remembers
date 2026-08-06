/**
 * Local `node:http` adapter used by the Vite proxy and the browser journey.
 *
 * It translates to the same internal request and response objects the Lambda
 * handler uses, so the local health journey exercises the same routing and the
 * same `/api/v1/health` path shape the deployed application will serve.
 */

import { createServer, type Server } from "node:http";
import process from "node:process";

import { loadGameConfig } from "@the-town-remembers/runtime-config/game";

import { handleRequest, type RouterContext } from "./http/router.js";
import { logEvent } from "./observability/log.js";

export interface LocalServerOptions {
  readonly port: number;
  readonly context: RouterContext;
}

/** Strips the query string before the path can reach the router or a log. */
function pathOf(rawUrl: string | undefined): string {
  const url = rawUrl ?? "/";
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

export function createLocalServer(options: LocalServerOptions): Server {
  return createServer((request, response) => {
    const { response: handled } = handleRequest(
      { method: request.method ?? "GET", path: pathOf(request.url) },
      options.context,
    );

    response.writeHead(handled.status, handled.headers);
    response.end(handled.body);
    request.resume();
  });
}

export async function startLocalServer(options: LocalServerOptions): Promise<Server> {
  const server = createLocalServer(options);
  await new Promise<void>((resolve) => {
    server.listen(options.port, "127.0.0.1", resolve);
  });
  return server;
}

/** Entry point for `pnpm dev`. */
export async function main(): Promise<void> {
  const config = loadGameConfig(process.env);
  const apiPort = config.apiPort;
  const context: RouterContext = {
    config,
    now: () => new Date(),
    monotonicMs: () => performance.now(),
  };

  const server = await startLocalServer({ port: apiPort, context });
  logEvent({
    event: "server_started",
    build: config.buildId,
    environment: config.environment,
    port: apiPort,
  });

  const stop = (): void => {
    server.close(() => {
      logEvent({
        event: "server_stopped",
        build: config.buildId,
        environment: config.environment,
        port: apiPort,
      });
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
