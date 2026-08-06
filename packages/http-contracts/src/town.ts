/**
 * Town creation, invite preview, and first-time join, as accepted by
 * Decision 006.
 *
 * The invite preview exposes no player names, evidence, contribution count,
 * case progress, or hidden state, and it never promises that a new invite
 * holder may take the final choice.
 */

import { z } from "zod";

import {
  DisplayNameSchema,
  DisplayTextSchema,
  IdSchema,
  ProseTextSchema,
} from "./primitives.js";
import { TOWN_STATUSES } from "./player-view.js";

/** The MVP has one server-selected mystery, so the body is exactly `{}`. */
export const TownCreationRequestSchema = z.strictObject({});

/**
 * `inviteUrl` is reconstructed from the creation key and recorded secret
 * version on every response and replay; it is never stored with the terminal
 * response body.
 */
export const TownCreationResponseSchema = z.strictObject({
  townId: IdSchema,
  status: z.literal("active"),
  inviteUrl: z.url(),
});

export const JOIN_MODES = ["play", "read_only", "closed"] as const;

export const InvitePreviewResponseSchema = z.strictObject({
  townId: IdSchema,
  mysteryTitle: DisplayTextSchema,
  tagline: ProseTextSchema,
  description: ProseTextSchema,
  townStatus: z.enum(TOWN_STATUSES),
  joinMode: z.enum(JOIN_MODES),
});

export const JoinRequestSchema = z.strictObject({
  displayName: DisplayNameSchema,
});

export const JoinResponseSchema = z.strictObject({
  townId: IdSchema,
  townStatus: z.enum(TOWN_STATUSES),
  player: z.strictObject({ id: IdSchema, displayName: DisplayNameSchema }),
  initialVisit: z.union([
    z.null(),
    z.strictObject({ visitId: IdSchema, locationId: IdSchema }),
  ]),
});

export type TownCreationRequest = z.infer<typeof TownCreationRequestSchema>;
export type TownCreationResponse = z.infer<typeof TownCreationResponseSchema>;
export type InvitePreviewResponse = z.infer<typeof InvitePreviewResponseSchema>;
export type JoinRequest = z.infer<typeof JoinRequestSchema>;
export type JoinResponse = z.infer<typeof JoinResponseSchema>;
export type JoinMode = (typeof JOIN_MODES)[number];
