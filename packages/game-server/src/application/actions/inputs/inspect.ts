/**
 * `inspect`'s `D3-N` narrow input loader and its full `ActionHandler`
 * (`P3-11`).
 *
 * `InspectLoadedInputs` deliberately does **not** `extends InspectInputs`
 * (unlike `StartVisitLoadedInputs`): an away player has no real current
 * location, and rules' own `InspectInputs.locationEntityId` is a required
 * `string`, the same nullability conflict `travel.ts`'s `TravelLoadedInputs`
 * already has for `currentLocationId`. `plan()` below builds the rules-layer
 * `InspectInputs` object explicitly, only once the away/frozen pre-checks
 * have already returned.
 */

import type { ActionResultByKind } from "@the-town-remembers/http-contracts";
import { contentFor, ITEM_DESCRIPTIONS } from "@the-town-remembers/content";
import {
  classifyInspectDiscovery,
  custodyFor,
  deniedResult,
  dispatcherTrace,
  planInspect,
  projectDiscoveredClues,
  type InspectInputs,
  type ItemCustody,
  type ReasonCode,
} from "@the-town-remembers/rules";
import type { Pool } from "pg";

import { internalError } from "../../../http/errors.js";
import {
  readBoardEntryExists,
  readClueDiscoveries,
  readInspectableAtLocation,
  readItemForReveal,
  type ClueDiscoveryContributor,
} from "../../../persistence/discoveries.js";
import { readPlayerAndVisit } from "../../../persistence/view-queries.js";
import { normalizeDisplayName } from "../../join.js";
import type { ActionHandler, LoadInputsContext } from "../executor.js";

export interface InspectLoadedInputs {
  readonly playerId: string;
  readonly playerDisplayName: string;
  readonly townId: string;
  readonly townActive: boolean;
  readonly townRevision: number;
  readonly contentVersion: string;
  readonly hasActiveVisit: boolean;
  readonly visitId: string | null;
  readonly locationEntityId: string | null;
  readonly inspectableId: string;
  readonly hasInspectable: boolean;
  readonly hasClue: boolean;
  readonly clueId: string | null;
  readonly clueKey: string | null;
  readonly clueAlreadyDiscoveredInTown: boolean;
  readonly clueAlreadyDiscoveredByThisPlayer: boolean;
  readonly boardEntryAlreadyExists: boolean;
  readonly existingContributors: readonly ClueDiscoveryContributor[];
  readonly revealsItemId: string | null;
  readonly itemAlreadyRevealed: boolean;
  readonly revealedItemEntityKey: string | null;
  readonly revealedItemPortable: boolean;
  readonly revealedItemRevision: number;
  readonly revealedItemCustody: {
    readonly heldByActorId: string | null;
    readonly locationEntityId: string | null;
  } | null;
}

async function readTownStatusRevisionAndVersion(
  pool: Pool,
  townId: string,
): Promise<{
  readonly active: boolean;
  readonly revision: number;
  readonly contentVersion: string;
}> {
  const result = await pool.query<{
    readonly status: string;
    readonly revision: number;
    readonly content_version: string;
  }>("SELECT status, revision, content_version FROM public.towns WHERE id = $1", [
    townId,
  ]);
  const row = result.rows[0]!;
  return {
    active: row.status === "active",
    revision: row.revision,
    contentVersion: row.content_version,
  };
}

export async function loadInspectInputs(
  pool: Pool,
  context: LoadInputsContext,
): Promise<InspectLoadedInputs> {
  const inspectableId = context.requestPayload["inspectableId"] as string;

  const [town, playerAndVisit] = await Promise.all([
    readTownStatusRevisionAndVersion(pool, context.townId),
    readPlayerAndVisit(pool, context.townId, context.playerId),
  ]);
  if (playerAndVisit === undefined) throw internalError();

  const locationEntityId = playerAndVisit.locationEntityId;
  const hasActiveVisit = locationEntityId !== null;

  const inspectable = hasActiveVisit
    ? await readInspectableAtLocation(pool, context.townId, inspectableId, locationEntityId)
    : undefined;

  const [existingContributors, boardEntryAlreadyExists, revealedItem] = await Promise.all(
    [
      inspectable?.clueId
        ? readClueDiscoveries(pool, context.townId, inspectable.clueId)
        : Promise.resolve([]),
      inspectable?.clueId
        ? readBoardEntryExists(pool, context.townId, inspectable.clueId)
        : Promise.resolve(false),
      inspectable?.linkedItemEntityId
        ? readItemForReveal(pool, context.townId, inspectable.linkedItemEntityId)
        : Promise.resolve(undefined),
    ],
  );

  return {
    playerId: context.playerId,
    playerDisplayName: playerAndVisit.displayName,
    townId: context.townId,
    townActive: town.active,
    townRevision: town.revision,
    contentVersion: town.contentVersion,
    hasActiveVisit,
    visitId: playerAndVisit.visitId,
    locationEntityId,
    inspectableId,
    hasInspectable: inspectable !== undefined,
    hasClue: inspectable?.clueId !== null && inspectable?.clueId !== undefined,
    clueId: inspectable?.clueId ?? null,
    clueKey: inspectable?.clueKey ?? null,
    clueAlreadyDiscoveredInTown: existingContributors.length > 0,
    clueAlreadyDiscoveredByThisPlayer: existingContributors.some(
      (contributor) => contributor.playerId === context.playerId,
    ),
    boardEntryAlreadyExists,
    existingContributors,
    revealsItemId: inspectable?.linkedItemEntityId ?? null,
    itemAlreadyRevealed: revealedItem?.alreadyRevealed ?? false,
    revealedItemEntityKey: revealedItem?.entityKey ?? null,
    revealedItemPortable: revealedItem?.portable ?? false,
    revealedItemRevision: revealedItem?.revision ?? 0,
    revealedItemCustody: revealedItem
      ? {
          heldByActorId: revealedItem.heldByActorId,
          locationEntityId: revealedItem.locationEntityId,
        }
      : null,
  };
}

const GENERIC_DENIAL_MESSAGE = "That isn't possible right now.";

const INSPECT_DENIAL_MESSAGES: Partial<Record<ReasonCode, string>> = {
  INSPECTABLE_NOT_FOUND: "There's nothing to inspect there.",
  VISIT_NOT_ACTIVE: "Start a visit before you inspect anything.",
  TOWN_NOT_ACTIVE: "This town's story is no longer taking new moves.",
};

/** Every content-registry lookup here is keyed by a value the database only
 * ever produced from that same frozen registry — a miss is content drift,
 * not a normal empty case (matches `player-view/build.ts`'s own `required`). */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw internalError();
  return value;
}

export const inspectActionHandler: ActionHandler<"inspect", InspectLoadedInputs> = {
  kind: "inspect",
  loadInputs: loadInspectInputs,
  plan(inputs) {
    const trace = dispatcherTrace("actions.inspect", [inputs.inspectableId]);
    if (!inputs.hasActiveVisit) return deniedResult("VISIT_NOT_ACTIVE", trace, {});
    if (!inputs.townActive) return deniedResult("TOWN_NOT_ACTIVE", trace, {});

    const rulesInputs: InspectInputs = {
      inspectableId: inputs.inspectableId,
      hasInspectable: inputs.hasInspectable,
      hasClue: inputs.hasClue,
      clueId: inputs.clueId,
      clueAlreadyDiscoveredInTown: inputs.clueAlreadyDiscoveredInTown,
      clueAlreadyDiscoveredByThisPlayer: inputs.clueAlreadyDiscoveredByThisPlayer,
      playerId: inputs.playerId,
      townId: inputs.townId,
      townRevision: inputs.townRevision,
      locationEntityId: inputs.locationEntityId!,
      revealsItemId: inputs.revealsItemId,
      itemAlreadyRevealed: inputs.itemAlreadyRevealed,
      revealedItemPortable: inputs.revealedItemPortable,
      revealedItemRevision: inputs.revealedItemRevision,
      boardEntryAlreadyExists: inputs.boardEntryAlreadyExists,
    };
    return planInspect(rulesInputs);
  },
  buildResult(inputs): ActionResultByKind["inspect"] {
    const discovery = classifyInspectDiscovery({
      hasInspectable: inputs.hasInspectable,
      hasClue: inputs.hasClue,
      clueAlreadyDiscoveredInTown: inputs.clueAlreadyDiscoveredInTown,
      clueAlreadyDiscoveredByThisPlayer: inputs.clueAlreadyDiscoveredByThisPlayer,
    });
    const content = contentFor(inputs.contentVersion);
    const thisPlayer = {
      id: inputs.playerId,
      actorType: "player" as const,
      displayName: inputs.playerDisplayName,
    };

    let clue: ActionResultByKind["inspect"]["clue"];
    if (inputs.hasClue && inputs.clueId !== null && inputs.clueKey !== null) {
      const authored = required(
        content.clues.find((candidate) => candidate.clueKey === inputs.clueKey),
      );
      const contributors = [
        ...inputs.existingContributors.map((contributor) => ({
          discoverySequence: contributor.discoverySequence,
          player: {
            id: contributor.playerId,
            actorType: "player" as const,
            displayName: contributor.displayName,
          },
        })),
        ...(discovery === "already_discovered_by_player"
          ? []
          : [{ discoverySequence: Number.MAX_SAFE_INTEGER, player: thisPlayer }]),
      ];
      const [projected] = projectDiscoveredClues([
        {
          clueId: inputs.clueId,
          normalizedName: normalizeDisplayName(authored.title),
          title: authored.title,
          description: authored.description,
          contributors,
        },
      ]);
      clue = {
        clueId: projected!.clueId,
        title: projected!.title,
        description: projected!.description,
        firstContributor: projected!.firstContributor,
        contributors: projected!.contributors,
      };
    }

    let revealedItem: ActionResultByKind["inspect"]["revealedItem"];
    if (inputs.revealsItemId !== null && inputs.revealedItemEntityKey !== null) {
      const authoredItem = required(
        content.items.find(
          (candidate) => candidate.entityKey === inputs.revealedItemEntityKey,
        ),
      );
      const revealsNewItem = !inputs.itemAlreadyRevealed;
      const custody: ItemCustody =
        revealsNewItem && inputs.revealedItemPortable
          ? { kind: "player_inventory" }
          : custodyFor({
              heldByActorId: inputs.revealedItemCustody?.heldByActorId ?? null,
              locationEntityId:
                inputs.revealedItemCustody?.locationEntityId ?? inputs.locationEntityId,
            });
      revealedItem = {
        itemId: inputs.revealsItemId,
        displayName: authoredItem.displayName,
        description: required(ITEM_DESCRIPTIONS[inputs.revealedItemEntityKey]),
        custody,
      };
    }

    return {
      inspectableId: inputs.inspectableId,
      discovery,
      ...(clue ? { clue } : {}),
      ...(revealedItem ? { revealedItem } : {}),
    };
  },
  reasonMessage: (code) => INSPECT_DENIAL_MESSAGES[code] ?? GENERIC_DENIAL_MESSAGE,
  resolveVisitId: (inputs) => inputs.visitId,
  eventMetadata: (inputs) => ({
    actorId: inputs.playerId,
    locationEntityId: inputs.locationEntityId,
    clueId: inputs.clueId,
  }),
};
