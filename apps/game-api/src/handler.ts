/**
 * AWS Lambda entry point for the Game API.
 *
 * The event's raw headers and cookies are filtered through
 * `HEADER_ALLOWLIST` before they reach `HttpRequest`; anything not on that
 * list never leaves this function.
 */

import process from "node:process";

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  createProductionAcceptPromiseActionHandler,
  createProductionAskActionHandler,
  createProductionGiveActionHandler,
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

let cachedContext: RouterContext | undefined;

function routerContext(): RouterContext {
  if (cachedContext === undefined) {
    const config = loadGameConfig(process.env);
    const pool = createRuntimePool(process.env);
    const now = (): Date => new Date();
    cachedContext = {
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
            giveActionHandler: createProductionGiveActionHandler({
              pool,
              modelConfig: loadModelConfig(process.env),
              now,
            }),
            acceptPromiseActionHandler: createProductionAcceptPromiseActionHandler({
              pool,
              modelConfig: loadModelConfig(process.env),
              now,
            }),
          }
        : {}),
    };
  }
  return cachedContext;
}

function requestBody(event: APIGatewayProxyEventV2): string | undefined {
  if (event.body === undefined) return undefined;
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

/** API Gateway V2 delivers cookies pre-split; a single header reconstructs them. */
function* rawHeaderEntries(
  event: APIGatewayProxyEventV2,
): Generator<readonly [string, string | undefined]> {
  yield* Object.entries(event.headers);
  if (event.cookies !== undefined) yield ["cookie", event.cookies.join("; ")];
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const { response } = await handleRequest(
    {
      method: event.requestContext.http.method,
      path: event.requestContext.http.path,
      headers: filterAllowlistedHeaders(rawHeaderEntries(event)),
      body: requestBody(event),
      sourceIp: event.requestContext.http.sourceIp,
    },
    routerContext(),
  );

  return {
    statusCode: response.status,
    headers: { ...response.headers },
    cookies: [...response.cookies],
    body: response.body,
  };
}

/** Test seam so a suite can force configuration to be re-read. */
export function resetHandlerContextForTest(): void {
  cachedContext = undefined;
}
