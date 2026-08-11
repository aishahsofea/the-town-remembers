/**
 * `/join/:inviteToken` — captures the token into page memory and shows the
 * tokenless `/join` URL before anything else runs (Decision 011, `D3-T`).
 *
 * The capture and the `history.replaceState` both happen in the component
 * body, synchronously, before any effect — a Playwright test asserts the
 * first history entry after navigation has no token and precedes the first
 * `/api/` request in time (`P3-13` acceptance 1). Placing this in an effect
 * would let a render slip in (or a network request start) before the
 * replacement, which is exactly the ordering this must never allow.
 */

import { setCapturedInviteToken } from "../routing/inviteToken.js";
import { Join } from "./Join.js";

export interface JoinBootstrapProps {
  readonly inviteToken: string;
}

export function JoinBootstrap({ inviteToken }: JoinBootstrapProps) {
  setCapturedInviteToken(inviteToken);
  if (window.location.pathname !== "/join") {
    window.history.replaceState(null, "", "/join");
  }

  return <Join />;
}
