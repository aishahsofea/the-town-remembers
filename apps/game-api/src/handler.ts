/**
 * AWS Lambda entry point for the Game API.
 *
 * The adapter reads only the method and the path from the event. The raw
 * event, its headers, its cookies, and its body never leave this function, and
 * the router cannot receive them.
 */

import process from "node:process";

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { loadGameConfig } from "@the-town-remembers/runtime-config/game";

import { handleRequest, type RouterContext } from "./http/router.js";

let cachedContext: RouterContext | undefined;

function routerContext(): RouterContext {
  cachedContext ??= {
    config: loadGameConfig(process.env),
    now: () => new Date(),
    monotonicMs: () => performance.now(),
  };
  return cachedContext;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const { response } = handleRequest(
    {
      method: event.requestContext.http.method,
      path: event.requestContext.http.path,
    },
    routerContext(),
  );

  return await Promise.resolve({
    statusCode: response.status,
    headers: { ...response.headers },
    body: response.body,
  });
}

/** Test seam so a suite can force configuration to be re-read. */
export function resetHandlerContextForTest(): void {
  cachedContext = undefined;
}
