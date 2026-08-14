/**
 * Local `node:http` adapter used by the Vite proxy and the browser journey.
 *
 * It translates to the same internal request and response objects the Lambda
 * handler uses, so the local journey exercises the same routing, the same
 * header allowlist, and the same `Set-Cookie` handling the deployed
 * application will serve.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import process from "node:process";

import {
  createProductionAskActionHandler,
  createProductionNormalizeClaimActionHandler,
  createProductionShowActionHandler,
  createProductionTellActionHandler,
  createRuntimePool,
  filterAllowlistedHeaders,
} from "@the-town-remembers/game-server";
import { loadGameConfig } from "@the-town-remembers/runtime-config/game";
import { loadModelConfig } from "@the-town-remembers/runtime-config/model";
import { loadSecurityConfig } from "@the-town-remembers/runtime-config/security";

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

function* rawHeaderEntries(
  request: IncomingMessage,
): Generator<readonly [string, string | undefined]> {
  for (const [name, value] of Object.entries(request.headers)) {
    yield [name, Array.isArray(value) ? value[0] : value];
  }
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      resolve(chunks.length === 0 ? undefined : Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

export function createLocalServer(options: LocalServerOptions): Server {
  return createServer((request, response) => {
    void (async () => {
      const body = await readBody(request);
      const { response: handled } = await handleRequest(
        {
          method: request.method ?? "GET",
          path: pathOf(request.url),
          headers: filterAllowlistedHeaders(rawHeaderEntries(request)),
          body,
          sourceIp: request.socket.remoteAddress ?? undefined,
        },
        options.context,
      );

      if (handled.cookies.length > 0) {
        response.setHeader("set-cookie", [...handled.cookies]);
      }
      response.writeHead(handled.status, handled.headers);
      response.end(handled.body);
    })();
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
  const pool = createRuntimePool(process.env);
  const now = (): Date => new Date();
  const context: RouterContext = {
    config,
    securityConfig: loadSecurityConfig(process.env),
    pool,
    now,
    monotonicMs: () => performance.now(),
    ...(config.enableNpcMutations
      ? {
          askActionHandler: createProductionAskActionHandler({
            pool,
            modelConfig: loadModelConfig(process.env),
            now,
          }),
          normalizeClaimActionHandler: createProductionNormalizeClaimActionHandler({
            pool,
            modelConfig: loadModelConfig(process.env),
            now,
          }),
          tellActionHandler: createProductionTellActionHandler({
            pool,
            modelConfig: loadModelConfig(process.env),
            now,
          }),
          showActionHandler: createProductionShowActionHandler({
            pool,
            modelConfig: loadModelConfig(process.env),
            now,
          }),
        }
      : {}),
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
