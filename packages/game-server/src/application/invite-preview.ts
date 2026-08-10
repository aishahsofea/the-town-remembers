/**
 * Invite preview (Decision 006 `GET /api/v1/invites/{inviteToken}`).
 *
 * Hash-only lookup: the plaintext token is hashed and compared against
 * `towns.invite_token_hash`, never the other way around. The response is
 * exactly six fields — no player, case, or hidden state, because a preview is
 * reachable by anyone who holds the link.
 */

import {
  MYSTERY_TITLE,
  SPOILER_SAFE_DESCRIPTION,
  TAGLINE,
} from "@the-town-remembers/content";
import type { JoinMode, TownStatus } from "@the-town-remembers/http-contracts";
import type { Pool } from "pg";

import { AppError } from "../http/errors.js";
import { inviteTokenHash } from "../security/invite.js";

export interface InvitePreviewResult {
  readonly townId: string;
  readonly mysteryTitle: string;
  readonly tagline: string;
  readonly description: string;
  readonly townStatus: TownStatus;
  readonly joinMode: JoinMode;
}

type RawTownStatus = "active" | "awaiting_resolution" | "resolved" | "retired";

function joinModeForStatus(status: RawTownStatus): JoinMode {
  if (status === "active") return "play";
  if (status === "retired") return "closed";
  return "read_only";
}

/**
 * `InvitePreviewResponseSchema#townStatus` has no `retired` member — the
 * lifecycle only reaches retirement after resolution, so a retired town's
 * preview reports the last player-meaningful status it held.
 */
function previewTownStatus(status: RawTownStatus): TownStatus {
  return status === "retired" ? "resolved" : status;
}

function notFound(): never {
  throw new AppError({
    status: 404,
    code: "RESOURCE_NOT_FOUND",
    title: "Not found",
    detail: "No resource is available at this address.",
  });
}

export async function previewInvite(
  pool: Pool,
  inviteToken: string,
): Promise<InvitePreviewResult> {
  const hash = inviteTokenHash(inviteToken);
  const result = await pool.query<{ id: string; status: RawTownStatus }>(
    "SELECT id, status FROM public.towns WHERE invite_token_hash = $1",
    [hash],
  );
  const town = result.rows[0];
  if (!town) notFound();

  return {
    townId: town.id,
    mysteryTitle: MYSTERY_TITLE,
    tagline: TAGLINE,
    description: SPOILER_SAFE_DESCRIPTION,
    townStatus: previewTownStatus(town.status),
    joinMode: joinModeForStatus(town.status),
  };
}
