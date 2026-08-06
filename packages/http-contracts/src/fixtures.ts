/**
 * Documented-shape fixtures for every accepted transport union member.
 *
 * These are exported rather than kept in a test file because later phases must
 * be able to prove that a handler, a projection builder, or a browser renderer
 * still accepts the same shapes the contract tests accept.
 */

import type {
  ActionKind,
  ActionRequest,
  CompletedActionResponse,
  NpcDialogue,
} from "./actions.js";
import type {
  ActivePromiseView,
  CaseAttemptView,
  CaseBoardEntryView,
  CaseBoardNoteEntryView,
  DiscoveredClueView,
  PlayerView,
  PublicActor,
  ResolutionView,
} from "./player-view.js";
import type { ProblemResponse } from "./problem.js";

const NOW = "2026-08-02T00:00:00.000Z";

export const playerActorFixture = {
  id: "player_1",
  actorType: "player",
  displayName: "Wren",
} satisfies PublicActor;

export const npcActorFixture = {
  id: "npc_mara",
  actorType: "npc",
  displayName: "Mara Venn",
} satisfies PublicActor;

export const actionRequestFixtures = {
  start_visit: { kind: "start_visit" },
  travel: { kind: "travel", destinationLocationId: "loc_chapel" },
  inspect: { kind: "inspect", inspectableId: "insp_bell_rope" },
  ask: { kind: "ask", npcId: "npc_mara", question: "Where were you that night?" },
  normalize_claim: {
    kind: "normalize_claim",
    npcId: "npc_mara",
    text: "Corin was at the chapel on festival night.",
  },
  tell: { kind: "tell", claimDraftId: "draft_1" },
  show: {
    kind: "show",
    npcId: "npc_mara",
    evidenceRef: { kind: "clue", clueId: "clue_rope" },
  },
  give: { kind: "give", npcId: "npc_mara", itemId: "item_lantern" },
  accept_promise: { kind: "accept_promise", offerId: "cHJvbWlzZS1vZmZlcg" },
  add_note: { kind: "add_note", text: "Nessa contradicts Mara about the rope." },
  leave: { kind: "leave" },
  accuse: {
    kind: "accuse",
    suspectId: "ent_corin",
    motiveId: "ent_protect_lark",
    locationId: "ent_old_chapel",
  },
  resolve: { kind: "resolve", choice: "expose_cover_up" },
} satisfies Record<ActionKind, ActionRequest>;

const dialogueFixture: NpcDialogue = {
  npcId: "npc_mara",
  text: "I closed the inn late. I saw nothing at the chapel.",
  responseMode: "selected",
};

const discoveredClueFixture: DiscoveredClueView = {
  clueId: "clue_rope",
  title: "Frayed bell rope",
  description: "The rope was cut, not worn through.",
  firstContributor: playerActorFixture,
  contributors: [playerActorFixture],
};

const activePromiseFixture: ActivePromiseView = {
  promiseId: "promise_1",
  npc: npcActorFixture,
  kind: "keep_secret",
  summary: "Keep Mara's account of the late closing to yourself.",
  subject: { kind: "claim", claimId: "claim_1", text: "Mara closed the inn late." },
  acceptedAt: NOW,
};

const noteEntryFixture: CaseBoardNoteEntryView = {
  entryId: "entry_note_1",
  entryKind: "note",
  verificationStatus: "unverified_player_note",
  contributedBy: playerActorFixture,
  createdAt: NOW,
  text: "Nessa contradicts Mara about the rope.",
};

const caseAttemptFixture: CaseAttemptView = {
  attemptId: "attempt_1",
  contributedBy: playerActorFixture,
  suspect: { id: "ent_corin", displayName: "Corin Hale" },
  motive: { id: "ent_protect_lark", displayName: "To protect Lark" },
  location: { id: "ent_old_chapel", displayName: "Old Chapel" },
  outcome: "correct",
  createdAt: NOW,
};

export const resolvedResolutionFixture = {
  state: "resolved",
  choice: "expose_cover_up",
  chosenBy: playerActorFixture,
  resolvedAt: NOW,
  epilogue: "The town hears the whole account before the festival begins.",
} satisfies ResolutionView;

export const resolutionViewFixtures = {
  investigating: {
    state: "investigating",
    accusationGate: { state: "locked", message: "There is not enough evidence yet." },
  },
  awaiting_choice: {
    state: "awaiting_choice",
    owner: playerActorFixture,
    reservationExpiresAt: NOW,
    canResolve: true,
    choices: [
      { value: "expose_cover_up", label: "Expose the cover-up" },
      { value: "restore_bell_quietly", label: "Restore the bell quietly" },
    ],
  },
  resolved: resolvedResolutionFixture,
} satisfies Record<ResolutionView["state"], ResolutionView>;

export const caseBoardEntryFixtures = {
  verified_evidence: {
    entryId: "entry_1",
    entryKind: "verified_evidence",
    verificationStatus: "verified_physical",
    contributedBy: playerActorFixture,
    createdAt: NOW,
    clue: {
      clueId: "clue_rope",
      title: "Frayed bell rope",
      description: "The rope was cut, not worn through.",
    },
  },
  testimony: {
    entryId: "entry_2",
    entryKind: "testimony",
    verificationStatus: "attributed_testimony",
    contributedBy: playerActorFixture,
    createdAt: NOW,
    claim: { claimId: "claim_1", text: "Mara closed the inn late." },
    speaker: npcActorFixture,
    provenancePath: [npcActorFixture],
  },
  hearsay: {
    entryId: "entry_3",
    entryKind: "hearsay",
    verificationStatus: "attributed_hearsay",
    contributedBy: playerActorFixture,
    createdAt: NOW,
    claim: { claimId: "claim_2", text: "Corin was at the chapel." },
    speaker: npcActorFixture,
    allegedSource: { id: "npc_nessa", actorType: "npc", displayName: "Nessa Reed" },
    provenancePath: [
      { id: "npc_nessa", actorType: "npc", displayName: "Nessa Reed" },
      npcActorFixture,
    ],
  },
  note: noteEntryFixture,
} satisfies Record<CaseBoardEntryView["entryKind"], CaseBoardEntryView>;

export const playerViewFixture = {
  viewVersion: "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE",
  town: {
    id: "town_1",
    mysteryTitle: "The Missing Festival Bell",
    contentVersion: "bell-mystery-v1",
    tagline: "The bell is gone.",
    status: "active",
  },
  player: {
    id: "player_1",
    displayName: "Wren",
    visit: { status: "active", visitId: "visit_1", locationId: "loc_square" },
  },
  map: [
    {
      id: "loc_square",
      displayName: "Festival Square",
      description: "Bunting hangs over an empty bell frame.",
      sceneKey: "bell-mystery-v1/scenes/festival-square",
      mapOrder: 0,
      access: { state: "open" },
    },
    {
      id: "loc_chapel",
      displayName: "Old Chapel",
      description: "The chapel door is shut.",
      sceneKey: "bell-mystery-v1/scenes/old-chapel",
      mapOrder: 3,
      access: { state: "locked", message: "The chapel door will not open yet." },
    },
  ],
  currentLocation: {
    id: "loc_square",
    displayName: "Festival Square",
    inspectables: [
      {
        id: "insp_bell_rope",
        displayName: "Bell rope",
        inspectionState: "available",
      },
    ],
  },
  encounters: [
    {
      npc: npcActorFixture,
      roleLabel: "Innkeeper",
      portraitKey: "bell-mystery-v1/portraits/mara-venn",
      openingLine: "You are up early for someone with questions.",
      stance: "wary",
      availableActionKinds: ["ask", "normalize_claim", "tell"],
    },
  ],
  inventory: [
    {
      itemId: "item_lantern",
      displayName: "Storm lantern",
      description: "Its glass is cracked along one side.",
    },
  ],
  discoveredClues: [discoveredClueFixture],
  activePromises: [activePromiseFixture],
  caseBoard: [
    caseBoardEntryFixtures.verified_evidence,
    caseBoardEntryFixtures.testimony,
    caseBoardEntryFixtures.hearsay,
    caseBoardEntryFixtures.note,
  ],
  caseBoardContradictions: [{ firstEntryId: "entry_2", secondEntryId: "entry_3" }],
  caseAttempts: [caseAttemptFixture],
  resolution: resolutionViewFixtures.investigating,
  ambientTransition: null,
} satisfies PlayerView;

export const completedActionResponseFixtures = {
  start_visit: {
    actionId: "action_1",
    kind: "start_visit",
    status: "completed",
    outcome: "applied",
    result: { disposition: "started", visitId: "visit_1", locationId: "loc_square" },
  },
  travel: {
    actionId: "action_2",
    kind: "travel",
    status: "completed",
    outcome: "applied",
    result: { disposition: "arrived", locationId: "loc_chapel" },
  },
  inspect: {
    actionId: "action_3",
    kind: "inspect",
    status: "completed",
    outcome: "applied",
    result: {
      inspectableId: "insp_bell_rope",
      discovery: "new_to_town",
      clue: discoveredClueFixture,
    },
  },
  ask: {
    actionId: "action_4",
    kind: "ask",
    status: "completed",
    outcome: "applied",
    result: { dialogue: dialogueFixture, promiseOffers: [] },
  },
  normalize_claim: {
    actionId: "action_5",
    kind: "normalize_claim",
    status: "completed",
    outcome: "no_change",
    result: {
      normalizationStatus: "needs_revision",
      explanation: "Name one person and one place.",
    },
  },
  tell: {
    actionId: "action_6",
    kind: "tell",
    status: "completed",
    outcome: "applied",
    result: {
      claimDraftId: "draft_1",
      claim: { claimId: "claim_1", text: "Mara closed the inn late." },
      dialogue: dialogueFixture,
      promiseOffers: [
        {
          offerId: "cHJvbWlzZS1vZmZlcg",
          sourceActionId: "action_6",
          ordinal: 0,
          npcId: "npc_mara",
          kind: "keep_secret",
          termsVersion: "keep-secret/1.0.0",
          summary: "Keep this to yourself.",
          subject: {
            kind: "claim",
            claimId: "claim_1",
            text: "Mara closed the inn late.",
          },
        },
      ],
    },
  },
  show: {
    actionId: "action_7",
    kind: "show",
    status: "completed",
    outcome: "applied",
    result: {
      evidenceRef: { kind: "clue", clueId: "clue_rope" },
      structuredEffect: "applied",
      appliedClueIds: ["clue_rope"],
      dialogue: dialogueFixture,
      promiseOffers: [],
    },
  },
  give: {
    actionId: "action_8",
    kind: "give",
    status: "completed",
    outcome: "applied",
    result: {
      itemId: "item_lantern",
      custody: "transferred",
      dialogue: dialogueFixture,
      promiseOffers: [],
    },
  },
  accept_promise: {
    actionId: "action_9",
    kind: "accept_promise",
    status: "completed",
    outcome: "applied",
    result: { promise: activePromiseFixture, itemTransfer: null },
  },
  add_note: {
    actionId: "action_10",
    kind: "add_note",
    status: "completed",
    outcome: "applied",
    result: { entry: noteEntryFixture },
  },
  leave: {
    actionId: "action_11",
    kind: "leave",
    status: "completed",
    outcome: "applied",
    result: { visitId: "visit_1", transitionStatus: "waiting" },
  },
  accuse: {
    actionId: "action_12",
    kind: "accuse",
    status: "completed",
    outcome: "applied",
    result: {
      attempt: caseAttemptFixture,
      resolution: resolutionViewFixtures.awaiting_choice,
    },
  },
  resolve: {
    actionId: "action_13",
    kind: "resolve",
    status: "completed",
    outcome: "applied",
    result: { disposition: "resolved", resolution: resolvedResolutionFixture },
  },
} satisfies Record<ActionKind, CompletedActionResponse>;

export const deniedActionResponseFixture = {
  actionId: "action_14",
  kind: "give",
  status: "completed",
  outcome: "denied",
  result: {
    type: "denied",
    reasonCode: "NPC_REFUSED_ITEM",
    message: "Mara will not take the lantern.",
    dialogue: dialogueFixture,
  },
} satisfies CompletedActionResponse;

export const problemResponseFixture = {
  type: "https://the-town-remembers/errors/idempotency-key-reused",
  status: 409,
  code: "IDEMPOTENCY_KEY_REUSED",
  title: "Idempotency key reused",
  detail: "This key was previously used for different action input.",
  requestId: "req_123",
  actionId: "action_123",
  fieldErrors: [],
} satisfies ProblemResponse;
