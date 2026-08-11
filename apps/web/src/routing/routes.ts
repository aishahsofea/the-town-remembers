/**
 * The eight browser routes (Decision 011 §"Information architecture").
 *
 * `:param`-style templates, matched the same segment-by-segment way
 * `packages/game-server/src/http/router.ts#matchTemplate` matches the API's
 * own `{param}` templates — no regex built at the call site, and an empty
 * segment (a doubled slash) never satisfies a `:param` hole.
 */

export const WEB_ROUTES = {
  joinBootstrap: "/join/:inviteToken",
  join: "/join",
  map: "/town/:townId/map",
  location: "/town/:townId/location/:locationId",
  encounter: "/town/:townId/encounter/:npcId",
  board: "/town/:townId/board",
  betweenVisits: "/town/:townId/between-visits",
  resolution: "/town/:townId/resolution",
} as const;

export type WebRouteName = keyof typeof WEB_ROUTES;

export function buildWebPath(
  name: WebRouteName,
  params: Readonly<Record<string, string>> = {},
): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    WEB_ROUTES[name] as string,
  );
}

export interface RouteMatch {
  readonly name: WebRouteName;
  readonly params: Readonly<Record<string, string>>;
}

function matchTemplate(
  path: string,
  template: string,
): Readonly<Record<string, string>> | undefined {
  const pathParts = path.split("/");
  const templateParts = template.split("/");
  if (pathParts.length !== templateParts.length) return undefined;

  const params: Record<string, string> = {};
  for (const [index, templatePart] of templateParts.entries()) {
    const pathPart = pathParts[index]!;
    if (templatePart.startsWith(":")) {
      if (pathPart === "") return undefined;
      params[templatePart.slice(1)] = decodeURIComponent(pathPart);
    } else if (templatePart !== pathPart) {
      return undefined;
    }
  }
  return params;
}

/** Trailing slashes normalize to the bare path, matching the API router's own rule. */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function matchWebRoute(path: string): RouteMatch | undefined {
  const normalized = normalizePath(path);
  for (const [name, template] of Object.entries(WEB_ROUTES) as [
    WebRouteName,
    string,
  ][]) {
    const params = matchTemplate(normalized, template);
    if (params) return { name, params };
  }
  return undefined;
}
