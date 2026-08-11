/**
 * Route table, path-template matching, and the uniform failure boundary.
 *
 * Every one of `ROUTE_TEMPLATES`'s seven entries is registered here, so a
 * request's `routeTemplate` is always identifiable for logging even before a
 * later task gives it a real handler. An unbuilt route's handler throws the
 * same `RESOURCE_NOT_FOUND` a truly unmatched path returns — Decision 006's
 * own problem contract names `RESOURCE_NOT_FOUND` as the code every missing,
 * hidden, inaccessible, cross-town, *and not-yet-implemented* route returns,
 * so a prober cannot distinguish "wrong path" from "not built yet".
 */

import {
  CompletedActionResponseSchema,
  InvitePreviewResponseSchema,
  JoinAttemptSecretSchema,
  JoinRequestSchema,
  JoinResponseSchema,
  PROBLEM_CODES,
  PlayerViewSchema,
  ProcessingActionResponseSchema,
  ROUTE_TEMPLATES,
  TownCreationRequestSchema,
  TownCreationResponseSchema,
  type ProblemStatus,
  type RouteTemplate,
} from "@the-town-remembers/http-contracts";
import type { SecurityConfig } from "@the-town-remembers/runtime-config/security";
import type { Pool } from "pg";

import type { LoggableRouteTemplate } from "../observability/events.js";
import { logEvent } from "../observability/events.js";
import { findTownByInviteToken, previewInvite } from "../application/invite-preview.js";
import { join } from "../application/join.js";
import { buildPlayerView } from "../application/player-view/build.js";
import {
  computePlayerViewVersion,
  finalizePlayerView,
  ifNoneMatchSatisfies,
} from "../application/player-view/etag.js";
import { createTown } from "../application/town-creation.js";
import {
  POLL_AFTER_MS,
  readActionForPlayer,
  retryAfterSecondsFrom,
  type StoredProblemBody,
} from "../persistence/actions.js";
import {
  checkRateLimit,
  RATE_LIMIT_BUCKETS,
  rateScopeKey,
} from "../persistence/rate-limits.js";
import {
  authenticate,
  confirmBootstrap,
  reissueIfDue,
} from "../persistence/sessions.js";
import { sessionTokenHash } from "../security/session-token.js";
import { AppError, internalError, rateLimited, toProblemResponse } from "./errors.js";
import { buildSessionCookie, sessionCookieName } from "./cookies.js";
import {
  etagHeader,
  locationHeader,
  noStoreHeaders,
  privateNoCacheHeaders,
  retryAfter,
} from "./headers.js";
import {
  parseJsonBody,
  requireExactOrigin,
  requireIdempotencyKey,
  requireJsonContentType,
} from "./negotiate.js";
import { parseCookies, readHeader } from "./request.js";
import { buildHealthResponse } from "./routes/health.js";
import type { HttpRequest, HttpResponse } from "./types.js";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

/** Generous for one guarded `UPDATE`; this check never shares a transaction. */
const RATE_LIMIT_CHECK_DEADLINE_MS = 5_000;

export interface RouterConfig {
  readonly buildId: string;
  readonly appOrigin: string;
  readonly now: () => Date;
  readonly pool: Pool;
  readonly securityConfig: SecurityConfig;
}

export interface RouteHandlerContext {
  readonly request: HttpRequest;
  readonly params: Readonly<Record<string, string>>;
  readonly config: RouterConfig;
}

type CacheKind = "no-store" | "private-no-cache";

interface RouteDefinition {
  readonly method: string;
  readonly template: RouteTemplate;
  readonly cacheKind: CacheKind;
  readonly handle: (
    context: RouteHandlerContext,
  ) => HttpResponse | Promise<HttpResponse>;
}

function notYetImplemented(): never {
  throw new AppError({
    status: 404,
    code: PROBLEM_CODES.resourceNotFound,
    title: "Not found",
    detail: "No resource is available at this address.",
  });
}

async function handleCreateTown(context: RouteHandlerContext): Promise<HttpResponse> {
  const { headers } = context.request;
  requireExactOrigin(headers, context.config.appOrigin);
  requireJsonContentType(headers);
  const idempotencyKey = requireIdempotencyKey(headers);
  parseJsonBody(TownCreationRequestSchema, context.request.body);

  const result = await createTown(
    {
      pool: context.config.pool,
      securityConfig: context.config.securityConfig,
      appOrigin: context.config.appOrigin,
      now: context.config.now,
    },
    {
      authorizationHeader: readHeader(headers, "authorization"),
      idempotencyKey,
      sourceIp: context.request.sourceIp,
    },
  );

  return {
    status: 201,
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify(TownCreationResponseSchema.parse(result)),
    cookies: [],
  };
}

async function handleInvitePreview(
  context: RouteHandlerContext,
): Promise<HttpResponse> {
  const inviteToken = context.params["inviteToken"];
  if (inviteToken === undefined) throw internalError();

  const result = await previewInvite(context.config.pool, inviteToken);
  return {
    status: 200,
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify(InvitePreviewResponseSchema.parse(result)),
    cookies: [],
  };
}

function requireJoinAttemptSecret(headers: ReadonlyMap<string, string>): string {
  const parsed = JoinAttemptSecretSchema.safeParse(headers.get("join-attempt-secret"));
  if (parsed.success) return parsed.data;

  throw new AppError({
    status: 400,
    code: "JOIN_ATTEMPT_SECRET_REQUIRED",
    title: "Join attempt secret required",
    detail: "The Join-Attempt-Secret header must be 256 bits of base64url.",
  });
}

async function handleInviteJoin(context: RouteHandlerContext): Promise<HttpResponse> {
  const { headers } = context.request;
  const inviteToken = context.params["inviteToken"];
  if (inviteToken === undefined) throw internalError();

  requireExactOrigin(headers, context.config.appOrigin);
  requireJsonContentType(headers);
  const idempotencyKey = requireIdempotencyKey(headers);
  const joinAttemptSecret = requireJoinAttemptSecret(headers);
  const { displayName } = parseJsonBody(JoinRequestSchema, context.request.body);

  const town = await findTownByInviteToken(context.config.pool, inviteToken);
  if (!town) {
    throw new AppError({
      status: 404,
      code: PROBLEM_CODES.resourceNotFound,
      title: "Not found",
      detail: "No resource is available at this address.",
    });
  }
  if (town.status === "retired") {
    throw new AppError({
      status: 410,
      code: "TOWN_RETIRED",
      title: "Town retired",
      detail: "This town is no longer accepting new players.",
    });
  }

  const result = await join(
    {
      pool: context.config.pool,
      sessionTokenPepper: context.config.securityConfig.sessionTokenPepper,
      ipHashSecret: context.config.securityConfig.ipHashSecret,
      now: context.config.now,
    },
    {
      townId: town.id,
      townActive: town.status === "active",
      townStatus: town.status,
      idempotencyKey,
      joinAttemptSecret,
      displayName,
      sourceIp: context.request.sourceIp,
    },
  );

  return {
    status: 201,
    headers: { "content-type": JSON_CONTENT_TYPE },
    body: JSON.stringify(
      JoinResponseSchema.parse({
        townId: result.townId,
        townStatus: result.townStatus,
        player: result.player,
        initialVisit: result.initialVisit,
      }),
    ),
    cookies: [buildSessionCookie(town.id, result.sessionToken)],
  };
}

function invalidSession(): never {
  throw new AppError({
    status: 401,
    code: "INVALID_SESSION",
    title: "Invalid session",
    detail: "The request carries no valid town session.",
  });
}

function townRetired(): never {
  throw new AppError({
    status: 410,
    code: "TOWN_RETIRED",
    title: "Town retired",
    detail: "This town is no longer accepting play.",
  });
}

/**
 * `GET /api/v1/towns/{townId}/player-view` (`P3-06`). Bootstrap confirmation
 * runs before the `If-None-Match` short-circuit (`D3-S`): a poll that lands
 * exactly on a matching ETag must still close the join replay window, the
 * same way a `200` would.
 */
async function handlePlayerView(context: RouteHandlerContext): Promise<HttpResponse> {
  const townId = context.params["townId"];
  if (townId === undefined) throw internalError();

  const { headers } = context.request;
  const cookies = parseCookies(readHeader(headers, "cookie"));
  const token = cookies.get(sessionCookieName(townId));
  if (token === undefined) invalidSession();

  const tokenHash = sessionTokenHash(
    context.config.securityConfig.sessionTokenPepper,
    token,
  );
  const outcome = await authenticate(context.config.pool, townId, tokenHash);
  if (outcome.outcome === "invalid_session") invalidSession();
  if (outcome.outcome === "town_retired") townRetired();

  const now = context.config.now();
  const admission = await checkRateLimit(
    context.config.pool,
    now.getTime() + RATE_LIMIT_CHECK_DEADLINE_MS,
    RATE_LIMIT_BUCKETS.playerView,
    rateScopeKey("player", townId, outcome.session.playerId),
    now,
  );
  if (!admission.admitted) throw rateLimited(admission.retryAfterSeconds);

  await confirmBootstrap(
    context.config.pool,
    townId,
    outcome.session.joinRequestId,
    now,
  );
  const reissued = await reissueIfDue(
    context.config.pool,
    townId,
    outcome.session.sessionId,
    now,
  );
  const cookiesOut = reissued ? [buildSessionCookie(townId, token)] : [];

  const draft = await buildPlayerView(context.config.pool, {
    townId,
    playerId: outcome.session.playerId,
  });
  const viewVersion = computePlayerViewVersion(draft);
  const ifNoneMatch = readHeader(headers, "if-none-match");

  if (ifNoneMatchSatisfies(ifNoneMatch, viewVersion)) {
    return {
      status: 304,
      headers: etagHeader(viewVersion),
      body: "",
      cookies: cookiesOut,
    };
  }

  const view = finalizePlayerView(draft, viewVersion);
  return {
    status: 200,
    headers: { "content-type": JSON_CONTENT_TYPE, ...etagHeader(viewVersion) },
    body: JSON.stringify(PlayerViewSchema.parse(view)),
    cookies: cookiesOut,
  };
}

function actionStatusPath(townId: string, actionId: string): string {
  return ROUTE_TEMPLATES.actionStatus
    .replace("{townId}", townId)
    .replace("{actionId}", actionId);
}

function resourceNotFound(): never {
  throw new AppError({
    status: 404,
    code: PROBLEM_CODES.resourceNotFound,
    title: "Not found",
    detail: "No resource is available at this address.",
  });
}

/**
 * `GET /api/v1/towns/{townId}/actions/{actionId}` (`P3-08`). Ownership is the
 * entire access check: a wrong player and a nonexistent action ID are
 * `404` identically. Reading never claims, retries, or otherwise starts
 * work, so this handler only ever branches on the row it finds.
 */
async function handleActionStatus(context: RouteHandlerContext): Promise<HttpResponse> {
  const townId = context.params["townId"];
  const actionId = context.params["actionId"];
  if (townId === undefined || actionId === undefined) throw internalError();

  const { headers } = context.request;
  const cookies = parseCookies(readHeader(headers, "cookie"));
  const token = cookies.get(sessionCookieName(townId));
  if (token === undefined) invalidSession();

  const tokenHash = sessionTokenHash(
    context.config.securityConfig.sessionTokenPepper,
    token,
  );
  const outcome = await authenticate(context.config.pool, townId, tokenHash);
  if (outcome.outcome === "invalid_session") invalidSession();
  if (outcome.outcome === "town_retired") townRetired();

  const row = await readActionForPlayer(
    context.config.pool,
    townId,
    outcome.session.playerId,
    actionId,
  );
  if (row === undefined) resourceNotFound();

  if (row.status === "processing") {
    return {
      status: 202,
      headers: {
        "content-type": JSON_CONTENT_TYPE,
        ...retryAfter(2),
        ...locationHeader(actionStatusPath(townId, row.id)),
      },
      body: JSON.stringify(
        ProcessingActionResponseSchema.parse({
          actionId: row.id,
          status: "processing",
          pollAfterMs: POLL_AFTER_MS,
        }),
      ),
      cookies: [],
    };
  }

  if (row.status === "completed") {
    // `ck_player_actions__state_fields` guarantees `response_status` is set
    // for every `completed` row; there is no fallback branch to test.
    return {
      status: row.responseStatus!,
      headers: { "content-type": JSON_CONTENT_TYPE },
      body: JSON.stringify(CompletedActionResponseSchema.parse(row.responsePayload)),
      cookies: [],
    };
  }

  // `retryable` or `failed`: rebuild the saved problem body, attaching the
  // *current* request's identity. `requestId` and `actionId` name the
  // request asking right now, not the one that first wrote the row, so
  // `persistence/actions.ts` deliberately stores neither — this is the one
  // place they are attached, via the uniform `AppError` -> `ProblemResponse`
  // boundary every other route already shares. The same schema constraint
  // guarantees `response_status` for both statuses, and `retry_after_at` for
  // `retryable` specifically, so neither read needs a fallback.
  const stored = row.responsePayload as StoredProblemBody;
  throw new AppError({
    status: row.responseStatus! as ProblemStatus,
    code: stored.code,
    title: stored.title,
    detail: stored.detail,
    fieldErrors: stored.fieldErrors,
    actionId: row.id,
    ...(row.status === "retryable"
      ? {
          headers: retryAfter(
            retryAfterSecondsFrom(row.retryAfterAt, context.config.now())!,
          ),
        }
      : {}),
  });
}

const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  {
    method: "GET",
    template: ROUTE_TEMPLATES.health,
    cacheKind: "no-store",
    handle: (context) => ({
      status: 200,
      headers: { "content-type": JSON_CONTENT_TYPE },
      body: JSON.stringify(
        buildHealthResponse({
          buildId: context.config.buildId,
          now: context.config.now,
        }),
      ),
      cookies: [],
    }),
  },
  {
    method: "POST",
    template: ROUTE_TEMPLATES.towns,
    cacheKind: "no-store",
    handle: handleCreateTown,
  },
  {
    method: "GET",
    template: ROUTE_TEMPLATES.invitePreview,
    cacheKind: "no-store",
    handle: handleInvitePreview,
  },
  {
    method: "POST",
    template: ROUTE_TEMPLATES.inviteJoin,
    cacheKind: "no-store",
    handle: handleInviteJoin,
  },
  {
    method: "GET",
    template: ROUTE_TEMPLATES.playerView,
    cacheKind: "private-no-cache",
    handle: handlePlayerView,
  },
  {
    method: "POST",
    template: ROUTE_TEMPLATES.actions,
    cacheKind: "no-store",
    handle: notYetImplemented,
  },
  {
    method: "GET",
    template: ROUTE_TEMPLATES.actionStatus,
    cacheKind: "no-store",
    handle: handleActionStatus,
  },
];

/** Trailing slashes are normalized so `/health/` cannot become a second route. */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

interface TemplateMatch {
  readonly template: RouteTemplate;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Matches a normalized path against a route template's `{param}` segments.
 * Segment-by-segment comparison, never a regex built at the call site — an
 * empty segment (from a doubled slash) never satisfies a `{param}` hole, so
 * `/api/v1//health` cannot be mistaken for `/api/v1/health`.
 */
function matchTemplate(
  path: string,
  template: RouteTemplate,
): TemplateMatch | undefined {
  const pathParts = path.split("/");
  const templateParts = template.split("/");
  if (pathParts.length !== templateParts.length) return undefined;

  const params: Record<string, string> = {};
  for (const [index, templatePart] of templateParts.entries()) {
    const pathPart = pathParts[index]!;
    if (templatePart.startsWith("{") && templatePart.endsWith("}")) {
      if (pathPart === "") return undefined;
      params[templatePart.slice(1, -1)] = pathPart;
    } else if (templatePart !== pathPart) {
      return undefined;
    }
  }
  return { template, params };
}

function findTemplateMatch(path: string): TemplateMatch | undefined {
  for (const template of Object.values(ROUTE_TEMPLATES)) {
    const match = matchTemplate(path, template);
    if (match) return match;
  }
  return undefined;
}

function cacheHeaders(cacheKind: CacheKind): Record<string, string> {
  return cacheKind === "private-no-cache" ? privateNoCacheHeaders() : noStoreHeaders();
}

function problemHttpResponse(
  error: AppError,
  requestId: string,
  cacheKind: CacheKind,
): HttpResponse {
  return {
    status: error.status,
    headers: {
      ...cacheHeaders(cacheKind),
      ...error.headers,
      "content-type": PROBLEM_CONTENT_TYPE,
    },
    body: JSON.stringify(toProblemResponse(error, requestId)),
    cookies: [],
  };
}

export interface RoutedResponse {
  readonly response: HttpResponse;
  readonly routeTemplate: LoggableRouteTemplate;
}

/**
 * Dispatches one request to its route, or to the uniform `RESOURCE_NOT_FOUND`
 * fallback. Every thrown value becomes a `ProblemResponse`: an `AppError`
 * unchanged, anything else as an opaque `500` that carries no message, cause,
 * or stack — the single failure boundary every route shares.
 */
export async function routeRequest(
  request: HttpRequest,
  requestId: string,
  config: RouterConfig,
): Promise<RoutedResponse> {
  const path = normalizePath(request.path);
  const templateMatch = findTemplateMatch(path);
  const route = templateMatch
    ? ROUTE_DEFINITIONS.find(
        (candidate) =>
          candidate.template === templateMatch.template &&
          candidate.method === request.method,
      )
    : undefined;

  if (!route) {
    return {
      response: problemHttpResponse(
        new AppError({
          status: 404,
          code: PROBLEM_CODES.resourceNotFound,
          title: "Not found",
          detail: "No resource is available at this address.",
        }),
        requestId,
        "no-store",
      ),
      routeTemplate: templateMatch?.template ?? "unmatched",
    };
  }

  try {
    const handled = await route.handle({
      request,
      params: templateMatch!.params,
      config,
    });
    return {
      response: {
        ...handled,
        headers: { ...cacheHeaders(route.cacheKind), ...handled.headers },
      },
      routeTemplate: route.template,
    };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        response: problemHttpResponse(error, requestId, route.cacheKind),
        routeTemplate: route.template,
      };
    }

    logEvent({ event: "unexpected_error", requestId, routeTemplate: route.template });
    return {
      response: problemHttpResponse(internalError(), requestId, route.cacheKind),
      routeTemplate: route.template,
    };
  }
}

/** Route templates every request can reach, for documentation and tests. */
export const ROUTED_TEMPLATES: readonly RouteTemplate[] = ROUTE_DEFINITIONS.map(
  (route) => route.template,
);
