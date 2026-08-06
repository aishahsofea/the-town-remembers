/**
 * The typed player action endpoint accepted by Decision 006.
 *
 * One request union, one completed-response union, and one processing shape.
 * A gameplay refusal is a completed action with `outcome: "denied"`, never an
 * HTTP error, so the client renders a saved terminal result either way.
 */

import { z } from "zod";

import {
  AskQuestionSchema,
  ClaimTextSchema,
  IdSchema,
  IsoTimeSchema,
  NoteTextSchema,
  ProseTextSchema,
} from "./primitives.js";
import {
  ActivePromiseViewSchema,
  CaseAttemptViewSchema,
  CaseBoardNoteEntryViewSchema,
  DiscoveredClueViewSchema,
  PROMISE_KINDS,
  PromiseSubjectViewSchema,
  PublicActorSchema,
  RESOLUTION_CHOICES,
  ResolutionViewSchema,
  ResolvedResolutionViewSchema,
  RevealedItemViewSchema,
} from "./player-view.js";

export const ACTION_KINDS = [
  "start_visit",
  "travel",
  "inspect",
  "ask",
  "normalize_claim",
  "tell",
  "show",
  "give",
  "accept_promise",
  "add_note",
  "leave",
  "accuse",
  "resolve",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/**
 * The action class charged against the model-backed rate-limit buckets. The
 * remaining kinds are deterministic and are not charged.
 */
export const MODEL_BACKED_ACTION_KINDS = [
  "ask",
  "normalize_claim",
  "tell",
  "show",
  "give",
  "accept_promise",
] as const satisfies readonly ActionKind[];

export const EvidenceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("clue"), clueId: IdSchema }),
  z.strictObject({ kind: z.literal("item"), itemId: IdSchema }),
]);

export const ActionRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("start_visit") }),
  z.strictObject({ kind: z.literal("travel"), destinationLocationId: IdSchema }),
  z.strictObject({ kind: z.literal("inspect"), inspectableId: IdSchema }),
  z.strictObject({
    kind: z.literal("ask"),
    npcId: IdSchema,
    question: AskQuestionSchema,
  }),
  z.strictObject({
    kind: z.literal("normalize_claim"),
    npcId: IdSchema,
    text: ClaimTextSchema,
  }),
  z.strictObject({ kind: z.literal("tell"), claimDraftId: IdSchema }),
  z.strictObject({
    kind: z.literal("show"),
    npcId: IdSchema,
    evidenceRef: EvidenceRefSchema,
  }),
  z.strictObject({ kind: z.literal("give"), npcId: IdSchema, itemId: IdSchema }),
  z.strictObject({ kind: z.literal("accept_promise"), offerId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("add_note"), text: NoteTextSchema }),
  z.strictObject({ kind: z.literal("leave") }),
  z.strictObject({
    kind: z.literal("accuse"),
    suspectId: IdSchema,
    motiveId: IdSchema,
    locationId: IdSchema,
  }),
  z.strictObject({ kind: z.literal("resolve"), choice: z.enum(RESOLUTION_CHOICES) }),
]);

/**
 * `responseMode` records how the utterance was produced. The client must not
 * stigmatize a fallback, so this is presentation metadata only.
 */
export const NpcDialogueSchema = z.strictObject({
  npcId: IdSchema,
  text: ProseTextSchema,
  responseMode: z.enum(["selected", "repaired", "fallback", "authored"]),
});

export const PromiseOfferViewSchema = z.strictObject({
  offerId: z.string().min(1),
  sourceActionId: IdSchema,
  ordinal: z.int().nonnegative(),
  npcId: IdSchema,
  kind: z.enum(PROMISE_KINDS),
  termsVersion: z.string().min(1),
  summary: ProseTextSchema,
  subject: PromiseSubjectViewSchema,
});

export const DeniedActionResultSchema = z.strictObject({
  type: z.literal("denied"),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  message: ProseTextSchema,
  dialogue: NpcDialogueSchema.optional(),
});

const promiseOffers = z.array(PromiseOfferViewSchema);

export const ActionResultSchemaByKind = {
  start_visit: z.strictObject({
    disposition: z.enum(["started", "already_active"]),
    visitId: IdSchema,
    locationId: IdSchema,
  }),
  travel: z.strictObject({
    disposition: z.enum(["arrived", "already_there"]),
    locationId: IdSchema,
  }),
  inspect: z.strictObject({
    inspectableId: IdSchema,
    discovery: z.enum([
      "new_to_town",
      "new_to_player",
      "already_discovered_by_player",
      "none",
    ]),
    clue: DiscoveredClueViewSchema.optional(),
    revealedItem: RevealedItemViewSchema.optional(),
  }),
  ask: z.strictObject({ dialogue: NpcDialogueSchema, promiseOffers }),
  normalize_claim: z.union([
    z.strictObject({
      normalizationStatus: z.literal("drafted"),
      claimDraftId: IdSchema,
      canonicalText: ProseTextSchema,
      allegedSource: PublicActorSchema.optional(),
      expiresAt: IsoTimeSchema,
    }),
    z.strictObject({
      normalizationStatus: z.literal("needs_revision"),
      explanation: ProseTextSchema,
    }),
  ]),
  tell: z.strictObject({
    claimDraftId: IdSchema,
    claim: z.strictObject({ claimId: IdSchema, text: ProseTextSchema }),
    dialogue: NpcDialogueSchema,
    promiseOffers,
  }),
  show: z.strictObject({
    evidenceRef: EvidenceRefSchema,
    structuredEffect: z.enum(["applied", "none"]),
    appliedClueIds: z.array(IdSchema),
    dialogue: NpcDialogueSchema,
    promiseOffers,
  }),
  give: z.strictObject({
    itemId: IdSchema,
    custody: z.enum(["transferred", "unchanged"]),
    dialogue: NpcDialogueSchema,
    promiseOffers,
  }),
  accept_promise: z.strictObject({
    promise: ActivePromiseViewSchema,
    itemTransfer: z.union([
      z.null(),
      z.strictObject({
        itemId: IdSchema,
        fromActorId: IdSchema,
        toActorId: IdSchema,
      }),
    ]),
    dialogue: NpcDialogueSchema.optional(),
  }),
  add_note: z.strictObject({ entry: CaseBoardNoteEntryViewSchema }),
  leave: z.strictObject({
    visitId: IdSchema,
    transitionStatus: z.enum(["not_required", "waiting"]),
  }),
  accuse: z.strictObject({
    attempt: CaseAttemptViewSchema,
    resolution: ResolutionViewSchema,
  }),
  resolve: z.strictObject({
    disposition: z.enum(["resolved", "already_resolved"]),
    resolution: ResolvedResolutionViewSchema,
  }),
} as const satisfies Record<ActionKind, z.ZodType>;

/**
 * Builds the two legal envelopes for one action kind. A denied outcome always
 * carries `DeniedActionResult`; any other outcome always carries that kind's
 * own result, so a cross-kind or cross-outcome body cannot validate.
 */
function completedEnvelopeForKind<K extends ActionKind>(kind: K) {
  const envelope = {
    actionId: IdSchema,
    kind: z.literal(kind),
    status: z.literal("completed"),
  };
  return z.union([
    z.strictObject({
      ...envelope,
      outcome: z.enum(["applied", "no_change"]),
      result: ActionResultSchemaByKind[kind],
    }),
    z.strictObject({
      ...envelope,
      outcome: z.literal("denied"),
      result: DeniedActionResultSchema,
    }),
  ]);
}

/**
 * A plain union rather than a discriminated union: each kind contributes two
 * members that share the `kind` discriminator, which a discriminated union
 * cannot express.
 */
export const CompletedActionResponseSchema = z.union(
  ACTION_KINDS.map((kind) => completedEnvelopeForKind(kind)),
);

export const ProcessingActionResponseSchema = z.strictObject({
  actionId: IdSchema,
  status: z.literal("processing"),
  pollAfterMs: z.int().positive(),
});

export const ActionStatusResponseSchema = z.union([
  CompletedActionResponseSchema,
  ProcessingActionResponseSchema,
]);

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export type NpcDialogue = z.infer<typeof NpcDialogueSchema>;
export type PromiseOfferView = z.infer<typeof PromiseOfferViewSchema>;
export type DeniedActionResult = z.infer<typeof DeniedActionResultSchema>;
export type ActionResultByKind = {
  [K in ActionKind]: z.infer<(typeof ActionResultSchemaByKind)[K]>;
};
export type CompletedActionResponse = z.infer<typeof CompletedActionResponseSchema>;
export type ProcessingActionResponse = z.infer<typeof ProcessingActionResponseSchema>;
export type ActionStatusResponse = z.infer<typeof ActionStatusResponseSchema>;
