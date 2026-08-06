/**
 * The player-safe read model accepted by Decision 006.
 *
 * Nothing in this file may carry the canonical town revision, an exact belief,
 * trust, or suspicion score, objective truth, a session token, or a raw
 * database row. `packages/http-contracts/src/leakage.test.ts` enforces that
 * rule structurally so a future field cannot smuggle hidden state through.
 */

import { z } from "zod";

import {
  AssetKeySchema,
  ContentVersionSchema,
  DisplayNameSchema,
  DisplayTextSchema,
  IdSchema,
  IsoTimeSchema,
  NoteTextSchema,
  ProseTextSchema,
  ViewVersionSchema,
} from "./primitives.js";

export const ACTOR_TYPES = ["player", "npc"] as const;

export const TOWN_STATUSES = ["active", "awaiting_resolution", "resolved"] as const;

export const NPC_STANCES = ["suspicious", "trusting", "wary", "neutral"] as const;

/** Enum order is part of the contract: it fixes `availableActionKinds` order. */
export const ENCOUNTER_ACTION_KINDS = [
  "ask",
  "normalize_claim",
  "tell",
  "show",
  "give",
  "accept_promise",
] as const;

export const PROMISE_KINDS = ["keep_secret", "return_item"] as const;

export const RESOLUTION_CHOICES = ["expose_cover_up", "restore_bell_quietly"] as const;

export const PublicActorSchema = z.strictObject({
  id: IdSchema,
  actorType: z.enum(ACTOR_TYPES),
  displayName: DisplayNameSchema,
});

export const PublicPlayerActorSchema = z.strictObject({
  id: IdSchema,
  actorType: z.literal("player"),
  displayName: DisplayNameSchema,
});

export const PublicNpcActorSchema = z.strictObject({
  id: IdSchema,
  actorType: z.literal("npc"),
  displayName: DisplayNameSchema,
});

export const LocationAccessSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("open") }),
  z.strictObject({ state: z.literal("locked"), message: DisplayTextSchema }),
]);

export const LocationViewSchema = z.strictObject({
  id: IdSchema,
  displayName: DisplayTextSchema,
  description: ProseTextSchema,
  sceneKey: AssetKeySchema,
  mapOrder: z.int().nonnegative(),
  access: LocationAccessSchema,
});

export const InspectableViewSchema = z.strictObject({
  id: IdSchema,
  displayName: DisplayTextSchema,
  inspectionState: z.enum(["available", "already_inspected"]),
});

export const EncounterViewSchema = z.strictObject({
  npc: PublicNpcActorSchema,
  roleLabel: DisplayTextSchema,
  portraitKey: AssetKeySchema,
  openingLine: ProseTextSchema,
  stance: z.enum(NPC_STANCES),
  availableActionKinds: z.array(z.enum(ENCOUNTER_ACTION_KINDS)),
});

export const InventoryItemViewSchema = z.strictObject({
  itemId: IdSchema,
  displayName: DisplayTextSchema,
  description: ProseTextSchema,
});

export const RevealedItemViewSchema = z.strictObject({
  itemId: IdSchema,
  displayName: DisplayTextSchema,
  description: ProseTextSchema,
  custody: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("player_inventory") }),
    z.strictObject({ kind: z.literal("location"), locationId: IdSchema }),
  ]),
});

export const DiscoveredClueViewSchema = z.strictObject({
  clueId: IdSchema,
  title: DisplayTextSchema,
  description: ProseTextSchema,
  firstContributor: PublicPlayerActorSchema,
  contributors: z.array(PublicPlayerActorSchema),
});

export const PromiseSubjectViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("claim"),
    claimId: IdSchema,
    text: ProseTextSchema,
  }),
  z.strictObject({
    kind: z.literal("item"),
    itemId: IdSchema,
    displayName: DisplayTextSchema,
  }),
]);

export const ActivePromiseViewSchema = z.strictObject({
  promiseId: IdSchema,
  npc: PublicNpcActorSchema,
  kind: z.enum(PROMISE_KINDS),
  summary: ProseTextSchema,
  subject: PromiseSubjectViewSchema,
  acceptedAt: IsoTimeSchema,
});

const boardEntryBase = {
  entryId: IdSchema,
  contributedBy: PublicPlayerActorSchema,
  createdAt: IsoTimeSchema,
};

const attributedClaimEntry = {
  ...boardEntryBase,
  claim: z.strictObject({ claimId: IdSchema, text: ProseTextSchema }),
  speaker: PublicActorSchema,
  allegedSource: PublicActorSchema.optional(),
  provenancePath: z.array(PublicActorSchema),
};

export const CaseBoardEntryViewSchema = z.discriminatedUnion("entryKind", [
  z.strictObject({
    ...boardEntryBase,
    entryKind: z.literal("verified_evidence"),
    verificationStatus: z.literal("verified_physical"),
    clue: z.strictObject({
      clueId: IdSchema,
      title: DisplayTextSchema,
      description: ProseTextSchema,
    }),
  }),
  z.strictObject({
    ...attributedClaimEntry,
    entryKind: z.literal("testimony"),
    verificationStatus: z.literal("attributed_testimony"),
  }),
  z.strictObject({
    ...attributedClaimEntry,
    entryKind: z.literal("hearsay"),
    verificationStatus: z.literal("attributed_hearsay"),
  }),
  z.strictObject({
    ...boardEntryBase,
    entryKind: z.literal("note"),
    verificationStatus: z.literal("unverified_player_note"),
    text: NoteTextSchema,
  }),
]);

export const CaseBoardNoteEntryViewSchema = z.strictObject({
  ...boardEntryBase,
  entryKind: z.literal("note"),
  verificationStatus: z.literal("unverified_player_note"),
  text: NoteTextSchema,
});

/**
 * A pair means the two accounts conflict. It never means either is objectively
 * false, so no verdict field exists.
 */
export const CaseBoardContradictionViewSchema = z.strictObject({
  firstEntryId: IdSchema,
  secondEntryId: IdSchema,
});

export const CaseAttemptViewSchema = z.strictObject({
  attemptId: IdSchema,
  contributedBy: PublicPlayerActorSchema,
  suspect: z.strictObject({ id: IdSchema, displayName: DisplayTextSchema }),
  motive: z.strictObject({ id: IdSchema, displayName: DisplayTextSchema }),
  location: z.strictObject({ id: IdSchema, displayName: DisplayTextSchema }),
  outcome: z.enum(["incorrect", "correct"]),
  createdAt: IsoTimeSchema,
});

export const AccusationOptionViewSchema = z.strictObject({
  id: IdSchema,
  displayName: DisplayTextSchema,
});

/** A locked gate carries a generic message and never enumerates candidates. */
export const AccusationGateSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("open"),
    options: z.strictObject({
      suspects: z.array(AccusationOptionViewSchema),
      motives: z.array(AccusationOptionViewSchema),
      locations: z.array(AccusationOptionViewSchema),
    }),
  }),
  z.strictObject({ state: z.literal("locked"), message: DisplayTextSchema }),
]);

export const ResolvedResolutionViewSchema = z.strictObject({
  state: z.literal("resolved"),
  choice: z.enum(RESOLUTION_CHOICES),
  chosenBy: PublicPlayerActorSchema,
  resolvedAt: IsoTimeSchema,
  epilogue: ProseTextSchema,
});

export const ResolutionViewSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("investigating"),
    accusationGate: AccusationGateSchema,
  }),
  z.strictObject({
    state: z.literal("awaiting_choice"),
    owner: PublicPlayerActorSchema,
    reservationExpiresAt: IsoTimeSchema,
    canResolve: z.boolean(),
    choices: z.array(
      z.strictObject({
        value: z.enum(RESOLUTION_CHOICES),
        label: DisplayTextSchema,
      }),
    ),
  }),
  ResolvedResolutionViewSchema,
]);

export const PlayerVisitSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("away") }),
  z.strictObject({
    status: z.literal("active"),
    visitId: IdSchema,
    locationId: IdSchema,
  }),
  z.strictObject({
    status: z.literal("frozen"),
    visitId: IdSchema,
    locationId: IdSchema,
  }),
]);

export const AmbientTransitionViewSchema = z.strictObject({
  status: z.enum(["waiting", "processing", "complete"]),
  canStartVisit: z.boolean(),
});

export const PlayerViewSchema = z.strictObject({
  viewVersion: ViewVersionSchema,
  town: z.strictObject({
    id: IdSchema,
    mysteryTitle: DisplayTextSchema,
    contentVersion: ContentVersionSchema,
    tagline: ProseTextSchema,
    status: z.enum(TOWN_STATUSES),
  }),
  player: z.strictObject({
    id: IdSchema,
    displayName: DisplayNameSchema,
    visit: PlayerVisitSchema,
  }),
  map: z.array(LocationViewSchema),
  currentLocation: z.union([
    z.null(),
    z.strictObject({
      id: IdSchema,
      displayName: DisplayTextSchema,
      inspectables: z.array(InspectableViewSchema),
    }),
  ]),
  encounters: z.array(EncounterViewSchema),
  inventory: z.array(InventoryItemViewSchema),
  discoveredClues: z.array(DiscoveredClueViewSchema),
  activePromises: z.array(ActivePromiseViewSchema),
  caseBoard: z.array(CaseBoardEntryViewSchema),
  caseBoardContradictions: z.array(CaseBoardContradictionViewSchema),
  caseAttempts: z.array(CaseAttemptViewSchema),
  resolution: ResolutionViewSchema,
  ambientTransition: z.union([z.null(), AmbientTransitionViewSchema]),
});

export type PublicActor = z.infer<typeof PublicActorSchema>;
export type LocationView = z.infer<typeof LocationViewSchema>;
export type InspectableView = z.infer<typeof InspectableViewSchema>;
export type EncounterView = z.infer<typeof EncounterViewSchema>;
export type InventoryItemView = z.infer<typeof InventoryItemViewSchema>;
export type RevealedItemView = z.infer<typeof RevealedItemViewSchema>;
export type DiscoveredClueView = z.infer<typeof DiscoveredClueViewSchema>;
export type PromiseSubjectView = z.infer<typeof PromiseSubjectViewSchema>;
export type ActivePromiseView = z.infer<typeof ActivePromiseViewSchema>;
export type CaseBoardEntryView = z.infer<typeof CaseBoardEntryViewSchema>;
export type CaseBoardNoteEntryView = z.infer<typeof CaseBoardNoteEntryViewSchema>;
export type CaseBoardContradictionView = z.infer<
  typeof CaseBoardContradictionViewSchema
>;
export type CaseAttemptView = z.infer<typeof CaseAttemptViewSchema>;
export type AccusationOptionView = z.infer<typeof AccusationOptionViewSchema>;
export type ResolutionView = z.infer<typeof ResolutionViewSchema>;
export type ResolvedResolutionView = z.infer<typeof ResolvedResolutionViewSchema>;
export type PlayerView = z.infer<typeof PlayerViewSchema>;
export type TownStatus = (typeof TOWN_STATUSES)[number];
export type ContentVersion = z.infer<typeof ContentVersionSchema>;
