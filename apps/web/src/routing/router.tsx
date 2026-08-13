/**
 * The whole client router: eight routes, `history`-based, no library (D3-T).
 * `Join`'s own token-bearing route never mounts the router again after
 * bootstrap — `JoinBootstrap` renders `Join` directly rather than asking the
 * router to re-match a new path.
 */

import { useEffect, useState } from "react";

import { NAVIGATION_EVENT } from "./navigation.js";
import { matchWebRoute, type RouteMatch } from "./routes.js";

export interface RouterProps {
  readonly renderRoute: (match: RouteMatch) => React.ReactNode;
  readonly renderNotFound: () => React.ReactNode;
}

export function Router({ renderRoute, renderNotFound }: RouterProps) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onNavigate = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener(NAVIGATION_EVENT, onNavigate);
    return () => {
      window.removeEventListener("popstate", onNavigate);
      window.removeEventListener(NAVIGATION_EVENT, onNavigate);
    };
  }, []);

  const match = matchWebRoute(pathname);
  return match ? renderRoute(match) : renderNotFound();
}
