/**
 * Route identity for the public HTTP surface accepted by Decision 006.
 *
 * The API version participates in every request fingerprint, so it is exported
 * as a stable constant rather than rebuilt from string literals at call sites.
 * Route templates are the only path strings safe to place in a log event.
 */

export const API_VERSION = "v1" as const;

export const API_BASE_PATH = `/api/${API_VERSION}` as const;

export const ROUTE_TEMPLATES = {
  health: `${API_BASE_PATH}/health`,
  towns: `${API_BASE_PATH}/towns`,
  invitePreview: `${API_BASE_PATH}/invites/{inviteToken}`,
  inviteJoin: `${API_BASE_PATH}/invites/{inviteToken}/join`,
  playerView: `${API_BASE_PATH}/towns/{townId}/player-view`,
  actions: `${API_BASE_PATH}/towns/{townId}/actions`,
  actionStatus: `${API_BASE_PATH}/towns/{townId}/actions/{actionId}`,
} as const;

export type RouteName = keyof typeof ROUTE_TEMPLATES;

export type RouteTemplate = (typeof ROUTE_TEMPLATES)[RouteName];

/** Placeholder used in logs when no route template matched the request. */
export const UNMATCHED_ROUTE_TEMPLATE = "unmatched" as const;
