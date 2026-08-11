/**
 * `history.pushState`/`replaceState` plus the one custom event that lets
 * `<Router>` notice a same-tab navigation — `pushState`/`replaceState`
 * themselves never fire `popstate` (D3-T).
 */

export const NAVIGATION_EVENT = "ttr:navigation";

export function navigate(
  path: string,
  options: { readonly replace?: boolean } = {},
): void {
  if (options.replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}
