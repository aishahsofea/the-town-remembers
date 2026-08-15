/**
 * The version-one player-view build (`P3-06`).
 *
 * Feeds `persistence/view-queries.ts`'s reads into
 * `rules/projection/player-view.ts`'s projectors. Phase 3 projects the shared
 * verified-evidence entries created by `inspect`; promises, case attempts,
 * contradictions, and ambient transitions remain their honest empty defaults.
 * `resolution` is genuinely derived from the real discovered-clue set through
 * `rules#isConfrontationGateOpen`, even though no Phase 3 action can open it
 * yet (`accuse` is Phase 6) — a future phase that opens the gate inherits a
 * correct projection rather than one that silently assumed `locked`.
 *
 * `EncounterView.availableActionKinds` is the full `ENCOUNTER_ACTION_KINDS`
 * set while `enableNpcMutations` is `true`, and empty while it is `false` —
 * `D4-R`'s gate, never a function of stance (`http/actions/enabled.ts`
 * applies the identical gate at submission time).
 *
 * The returned `viewVersion` is the placeholder `""` — the caller always
 * routes this draft through `etag.ts#computePlayerViewVersion` and
 * `#finalizePlayerView` before it reaches `PlayerViewSchema.parse` or a
 * response body.
 */

import {
  EVIDENCE_GATE_LOCKED_MESSAGE,
  ITEM_DESCRIPTIONS,
  LOCATION_SCENE_KEYS,
  MYSTERY_TITLE,
  NPC_PORTRAIT_KEYS,
  NPC_ROLE_LABELS,
  TAGLINE,
  contentFor,
  renderClaimSentence,
} from "@the-town-remembers/content";
import {
  ENCOUNTER_ACTION_KINDS,
  type PlayerView,
} from "@the-town-remembers/http-contracts";
import {
  buildProvenancePath,
  isConfrontationGateOpen,
  projectAccusationOptions,
  projectPlayerView,
  stanceFor,
  verificationStatusFor,
  type PlayerViewProjectionInputs,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../http/errors.js";
import {
  readAccusationCandidateEntities,
  readActivePromisesForPlayer,
  readBoardClaimEntries,
  readCoLocatedNpcs,
  readConfrontationGateStatus,
  readDiscoveredClues,
  readInspectables,
  readInventory,
  readMapAccess,
  readPlayerAndVisit,
  readTownHeader,
  readTransmissionProvenanceLinks,
  readVerifiedCaseBoardEntries,
  type ActivePromiseClaimSubjectRow,
  type ClueDiscoveryRow,
  type StoryEntityRow,
} from "../../persistence/view-queries.js";
import { normalizeDisplayName } from "../join.js";

export interface BuildPlayerViewParams {
  readonly townId: string;
  readonly playerId: string;
  /** `D4-R`: the six model-backed action kinds render as `availableActionKinds` only while this is `true` — never conditioned on stance. */
  readonly enableNpcMutations: boolean;
}

/**
 * Every content lookup this module performs is over a key the database
 * itself only ever produces from the same frozen content registry — a
 * `characterKey`, `clueKey`, `entityKey` this returns `undefined` for is a
 * genuine invariant violation (content drift), not a normal empty case, so
 * it fails loud rather than silently blanking a player-facing string.
 */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw internalError();
  return value;
}

function groupByClue(
  rows: readonly ClueDiscoveryRow[],
): ReadonlyMap<string, readonly ClueDiscoveryRow[]> {
  const groups = new Map<string, ClueDiscoveryRow[]>();
  for (const row of rows) {
    const group = groups.get(row.clueId);
    if (group) group.push(row);
    else groups.set(row.clueId, [row]);
  }
  return groups;
}

/** `renderClaimSentence` throws on an unknown key/context, which `required()`'s callers already treat as an invariant violation — let it propagate as-is. */
function claimTextFor(
  content: ReturnType<typeof contentFor>,
  claim: ActivePromiseClaimSubjectRow,
): string {
  return renderClaimSentence(content, {
    subjectEntityKey: claim.subjectEntityKey,
    predicate: claim.predicate,
    objectEntityKey: claim.objectEntityKey,
    polarity: claim.polarity,
    contextKey: claim.contextKey,
  });
}

export async function buildPlayerView(
  pool: Pool,
  params: BuildPlayerViewParams,
): Promise<PlayerView> {
  const { townId, playerId, enableNpcMutations } = params;

  const [
    townHeader,
    playerAndVisit,
    mapAccess,
    inventory,
    discoveredClues,
    verifiedCaseBoardEntries,
    boardClaimEntries,
    provenanceLinks,
    activePromiseRows,
    gateStatus,
  ] = await Promise.all([
    readTownHeader(pool, townId),
    readPlayerAndVisit(pool, townId, playerId),
    readMapAccess(pool, townId, playerId),
    readInventory(pool, townId, playerId),
    readDiscoveredClues(pool, townId),
    readVerifiedCaseBoardEntries(pool, townId),
    readBoardClaimEntries(pool, townId),
    readTransmissionProvenanceLinks(pool, townId),
    readActivePromisesForPlayer(pool, townId, playerId),
    readConfrontationGateStatus(pool, townId),
  ]);

  if (!townHeader || !playerAndVisit) throw internalError();
  const townStatus = townHeader.status;
  if (townStatus === "retired") throw internalError();

  const content = contentFor(townHeader.contentVersion);
  const locationContentByKey = new Map(
    content.locations.map((location) => [location.entityKey, location]),
  );
  const clueContentByKey = new Map(content.clues.map((clue) => [clue.clueKey, clue]));
  const npcContentByKey = new Map(content.npcs.map((npc) => [npc.npcKey, npc]));
  const promiseSummaryByTermsVersion = new Map<string, string>(
    Object.values(content.promiseTerms).map((terms) => [
      terms.termsVersion,
      terms.summary,
    ]),
  );

  const visit: PlayerView["player"]["visit"] =
    playerAndVisit.visitId === null || playerAndVisit.locationEntityId === null
      ? { status: "away" }
      : {
          status: townStatus === "active" ? "active" : "frozen",
          visitId: playerAndVisit.visitId,
          locationId: playerAndVisit.locationEntityId,
        };

  const currentLocationHeader =
    playerAndVisit.locationEntityId === null
      ? undefined
      : mapAccess.find((location) => location.id === playerAndVisit.locationEntityId);

  const [inspectables, coLocatedNpcs] = currentLocationHeader
    ? await Promise.all([
        readInspectables(pool, townId, playerId, currentLocationHeader.id),
        readCoLocatedNpcs(pool, townId, playerId, currentLocationHeader.id),
      ])
    : [[], []];

  const gateOpen = isConfrontationGateOpen(gateStatus);
  const discoveredClueGroups = groupByClue(discoveredClues);
  const verifiedEvidenceBoard: PlayerViewProjectionInputs["caseBoard"] =
    verifiedCaseBoardEntries.map((entry) => {
      const authored = required(clueContentByKey.get(entry.clueKey));
      return {
        entryId: entry.entryId,
        claimId: null,
        createdAt: entry.createdAt,
        view: {
          entryKind: "verified_evidence",
          verificationStatus: "verified_physical",
          contributedBy: {
            id: entry.contributedByPlayerId,
            actorType: "player",
            displayName: entry.contributedByDisplayName,
          },
          clue: {
            clueId: entry.clueId,
            title: authored.title,
            description: authored.description,
          },
        },
      };
    });

  const provenanceLinksById = new Map(
    provenanceLinks.map((link) => [
      link.transmissionId,
      {
        transmissionId: link.transmissionId,
        parentTransmissionId: link.parentTransmissionId,
        speakerActorId: link.speakerActorId,
        speakerActorType: link.speakerActorType,
      },
    ]),
  );
  const actorDisplayNameById = new Map(
    provenanceLinks.map((link) => [link.speakerActorId, link.speakerDisplayName]),
  );
  const claimBoard: PlayerViewProjectionInputs["caseBoard"] = boardClaimEntries.map(
    (entry) => {
      const attribution = {
        contributedBy: {
          id: entry.contributedByPlayerId,
          actorType: "player" as const,
          displayName: entry.contributedByDisplayName,
        },
        claim: {
          claimId: entry.claim.claimId,
          text: claimTextFor(content, entry.claim),
        },
        speaker: entry.speaker,
        ...(entry.allegedSource === undefined
          ? {}
          : { allegedSource: entry.allegedSource }),
        provenancePath: buildProvenancePath(
          entry.transmissionId,
          provenanceLinksById,
        ).map((actor) => ({
          id: actor.actorId,
          actorType: actor.actorType,
          displayName: required(actorDisplayNameById.get(actor.actorId)),
        })),
      };
      return {
        entryId: entry.entryId,
        claimId: entry.claim.claimId,
        createdAt: entry.createdAt,
        view:
          entry.entryKind === "testimony"
            ? {
                entryKind: "testimony" as const,
                verificationStatus: verificationStatusFor("testimony"),
                ...attribution,
              }
            : {
                entryKind: "hearsay" as const,
                verificationStatus: verificationStatusFor("hearsay"),
                ...attribution,
              },
      };
    },
  );
  const caseBoard: PlayerViewProjectionInputs["caseBoard"] = [
    ...verifiedEvidenceBoard,
    ...claimBoard,
  ];

  const activePromises: PlayerViewProjectionInputs["activePromises"] =
    activePromiseRows.map((row) => ({
      promiseId: row.promiseId,
      acceptedAt: row.createdAt,
      view: {
        npc: { id: row.npcId, actorType: "npc", displayName: row.npcDisplayName },
        kind: row.kind,
        summary: required(promiseSummaryByTermsVersion.get(row.termsVersion)),
        subject:
          row.claim !== undefined
            ? {
                kind: "claim",
                claimId: row.claim.claimId,
                text: claimTextFor(content, row.claim),
              }
            : {
                kind: "item",
                itemId: required(row.item).itemId,
                displayName: required(row.item).displayName,
              },
      },
    }));

  const [characterEntities, motiveEntities]: [
    readonly StoryEntityRow[],
    readonly StoryEntityRow[],
  ] = gateOpen
    ? await Promise.all([
        readAccusationCandidateEntities(pool, townId, "character"),
        readAccusationCandidateEntities(pool, townId, "motive"),
      ])
    : [[], []];
  const characterIdByKey = new Map(
    characterEntities.map((row) => [row.entityKey, row.id]),
  );
  const motiveIdByKey = new Map(motiveEntities.map((row) => [row.entityKey, row.id]));
  const locationIdByKey = new Map(mapAccess.map((row) => [row.entityKey, row.id]));
  const permittedActionKinds = new Set<(typeof ENCOUNTER_ACTION_KINDS)[number]>(
    enableNpcMutations ? ENCOUNTER_ACTION_KINDS : [],
  );

  const inputs: PlayerViewProjectionInputs = {
    viewVersion: "",
    town: {
      id: townId,
      mysteryTitle: MYSTERY_TITLE,
      contentVersion: townHeader.contentVersion,
      tagline: TAGLINE,
      status: townStatus,
    },
    player: { id: playerId, displayName: playerAndVisit.displayName, visit },
    map: mapAccess.map((location) => {
      const authored = required(locationContentByKey.get(location.entityKey));
      return {
        id: location.id,
        displayName: location.displayName,
        description: authored.description,
        sceneKey: required(LOCATION_SCENE_KEYS[location.entityKey]),
        mapOrder: authored.mapOrder,
        access: location.access,
      };
    }),
    currentLocation: currentLocationHeader
      ? {
          location: {
            id: currentLocationHeader.id,
            displayName: currentLocationHeader.displayName,
          },
          inspectables: inspectables.map((inspectable) => ({
            id: inspectable.id,
            displayName: inspectable.displayName,
            normalizedName: normalizeDisplayName(inspectable.displayName),
            inspectionState: inspectable.alreadyInspected
              ? ("already_inspected" as const)
              : ("available" as const),
          })),
        }
      : { location: null, inspectables: [] },
    encounters: coLocatedNpcs.map((npc) => {
      const authored = required(npcContentByKey.get(npc.characterKey));
      return {
        npc: { id: npc.npcId, actorType: "npc" as const, displayName: npc.displayName },
        roleLabel: required(NPC_ROLE_LABELS[npc.characterKey]),
        portraitKey: required(NPC_PORTRAIT_KEYS[npc.characterKey]),
        openingLine: authored.openingGreeting,
        stance: stanceFor(npc.trustScore, npc.suspicionScore),
        normalizedName: normalizeDisplayName(npc.displayName),
        permittedActionKinds,
      };
    }),
    inventory: inventory.map((item) => ({
      itemId: item.itemId,
      displayName: item.displayName,
      normalizedName: normalizeDisplayName(item.displayName),
      description: required(ITEM_DESCRIPTIONS[item.entityKey]),
    })),
    discoveredClues: [...discoveredClueGroups.entries()].map(([clueId, rows]) => {
      const first = rows[0]!;
      const authored = required(clueContentByKey.get(first.clueKey));
      return {
        clueId,
        normalizedName: normalizeDisplayName(authored.title),
        title: authored.title,
        description: authored.description,
        contributors: rows.map((row) => ({
          discoverySequence: row.discoverySequence,
          player: {
            id: row.playerId,
            actorType: "player" as const,
            displayName: row.playerDisplayName,
          },
        })),
      };
    }),
    activePromises,
    caseBoard,
    caseBoardContradictionsInput: { visibleEntries: [], contradictingClaimPairs: [] },
    caseAttempts: [],
    resolution: gateOpen
      ? {
          state: "investigating",
          accusationGate: {
            state: "open",
            options: {
              suspects: projectAccusationOptions(
                content.characters.flatMap((character, index) => {
                  const id = characterIdByKey.get(character.entityKey);
                  return id
                    ? [{ id, displayName: character.displayName, authoredOrder: index }]
                    : [];
                }),
              ),
              motives: projectAccusationOptions(
                content.motives.flatMap((motive, index) => {
                  const id = motiveIdByKey.get(motive.entityKey);
                  return id
                    ? [{ id, displayName: motive.displayName, authoredOrder: index }]
                    : [];
                }),
              ),
              locations: projectAccusationOptions(
                content.locations.flatMap((location, index) => {
                  const id = locationIdByKey.get(location.entityKey);
                  return id
                    ? [{ id, displayName: location.displayName, authoredOrder: index }]
                    : [];
                }),
              ),
            },
          },
        }
      : {
          state: "investigating",
          accusationGate: { state: "locked", message: EVIDENCE_GATE_LOCKED_MESSAGE },
        },
    ambientTransition: null,
  };

  return projectPlayerView(inputs);
}
