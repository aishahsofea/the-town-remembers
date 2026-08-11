/**
 * Invite preview, the existing-session probe, and first-time join.
 */

import type {
  InvitePreviewResponse,
  JoinResponse,
  PlayerView,
} from "@the-town-remembers/http-contracts";
import {
  InvitePreviewResponseSchema,
  JoinResponseSchema,
  PlayerViewSchema,
  ROUTE_TEMPLATES,
} from "@the-town-remembers/http-contracts";

import { apiRequest, buildPath, type ApiError } from "./client.js";

export async function fetchInvitePreview(
  inviteToken: string,
): Promise<InvitePreviewResponse> {
  const response = await apiRequest(
    buildPath(ROUTE_TEMPLATES.invitePreview, { inviteToken }),
  );
  return InvitePreviewResponseSchema.parse(response.body);
}

/**
 * Probes for an already-authenticated session by calling `player-view`
 * directly — the session cookie is `HttpOnly`, so this is the only way the
 * browser can learn whether one already exists. `undefined` means no
 * session (a `401`); any other failure propagates as {@link ApiError}.
 */
export async function probeExistingSession(
  townId: string,
): Promise<PlayerView | undefined> {
  try {
    const response = await apiRequest(
      buildPath(ROUTE_TEMPLATES.playerView, { townId }),
    );
    return PlayerViewSchema.parse(response.body);
  } catch (error) {
    if ((error as ApiError).status === 401) return undefined;
    throw error;
  }
}

export interface JoinParams {
  readonly inviteToken: string;
  readonly displayName: string;
  readonly idempotencyKey: string;
  readonly joinAttemptSecret: string;
}

export async function joinTown(params: JoinParams): Promise<JoinResponse> {
  const response = await apiRequest(
    buildPath(ROUTE_TEMPLATES.inviteJoin, { inviteToken: params.inviteToken }),
    {
      method: "POST",
      headers: {
        "idempotency-key": params.idempotencyKey,
        "join-attempt-secret": params.joinAttemptSecret,
      },
      body: { displayName: params.displayName },
    },
  );
  return JoinResponseSchema.parse(response.body);
}
