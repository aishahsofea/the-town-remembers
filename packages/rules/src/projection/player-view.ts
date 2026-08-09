/**
 * The full `PlayerView` projector. Every array applies the stable order
 * `kernel/ordering.ts` (`P2-02`) already names, rather than re-deriving it
 * here. There is no `revision` field anywhere on `PlayerView` to
 * accidentally leak — the schema structurally prevents it, so this module
 * has nothing to "exclude" there, only fields it must never add.
 */

import { ENCOUNTER_ACTION_KINDS } from "@the-town-remembers/http-contracts";
import type {
  AccusationOptionView,
  ActivePromiseView,
  AmbientTransitionViewSchema,
  CaseAttemptView,
  CaseBoardContradictionView,
  CaseBoardEntryView,
  DiscoveredClueView,
  EncounterView,
  InspectableView,
  InventoryItemView,
  LocationAccessSchema,
  LocationView,
  PlayerView,
  PublicNpcActorSchema,
  ResolutionView,
} from "@the-town-remembers/http-contracts";
import type { z } from "zod";

import {
  computeBoardContradictionPairs,
  type BoardEntryRef,
  type ClaimContradictionPair,
} from "../board/provenance.js";
import {
  compareByAcceptedAtThenId,
  compareByAuthoredOrder,
  compareByCreatedAtThenId,
  compareByDiscoverySequenceThenPlayerId,
  compareByMapOrder,
  compareByNormalizedNameThenId,
  compareResolutionChoices,
} from "../kernel/ordering.js";

type AmbientTransitionView = z.infer<typeof AmbientTransitionViewSchema>;
type PublicNpcActor = z.infer<typeof PublicNpcActorSchema>;
type LocationAccess = z.infer<typeof LocationAccessSchema>;
type EncounterActionKind = (typeof ENCOUNTER_ACTION_KINDS)[number];

// --- map --------------------------------------------------------------------------

export interface LocationProjectionInput {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly sceneKey: string;
  readonly mapOrder: number;
  readonly access: LocationAccess;
}

export function projectMap(
  locations: readonly LocationProjectionInput[],
): LocationView[] {
  return locations
    .map((location) => ({
      id: location.id,
      displayName: location.displayName,
      description: location.description,
      sceneKey: location.sceneKey,
      mapOrder: location.mapOrder,
      access: location.access,
    }))
    .toSorted(compareByMapOrder);
}

// --- currentLocation -----------------------------------------------------------------

export interface InspectableProjectionInput {
  readonly id: string;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly inspectionState: "available" | "already_inspected";
}

export function projectCurrentLocation(
  location: { readonly id: string; readonly displayName: string } | null,
  inspectables: readonly InspectableProjectionInput[],
): PlayerView["currentLocation"] {
  if (location === null) return null;
  const ordered: InspectableView[] = inspectables
    .map((inspectable) => ({
      id: inspectable.id,
      displayName: inspectable.displayName,
      normalizedName: inspectable.normalizedName,
      inspectionState: inspectable.inspectionState,
    }))
    .toSorted(compareByNormalizedNameThenId)
    .map(({ id, displayName, inspectionState }) => ({
      id,
      displayName,
      inspectionState,
    }));

  return { id: location.id, displayName: location.displayName, inspectables: ordered };
}

// --- encounters ---------------------------------------------------------------------

export interface EncounterProjectionInput {
  readonly npc: PublicNpcActor;
  readonly normalizedName: string;
  readonly roleLabel: string;
  readonly portraitKey: string;
  readonly openingLine: string;
  readonly stance: EncounterView["stance"];
  readonly permittedActionKinds: ReadonlySet<EncounterActionKind>;
}

/** Filters the fixed, authored `ENCOUNTER_ACTION_KINDS` order down to what's permitted. */
export function orderedAvailableActionKinds(
  permitted: ReadonlySet<EncounterActionKind>,
): EncounterActionKind[] {
  return ENCOUNTER_ACTION_KINDS.filter((kind) => permitted.has(kind));
}

export function projectEncounters(
  encounters: readonly EncounterProjectionInput[],
): EncounterView[] {
  return encounters
    .toSorted((left, right) =>
      compareByNormalizedNameThenId(
        { normalizedName: left.normalizedName, id: left.npc.id },
        { normalizedName: right.normalizedName, id: right.npc.id },
      ),
    )
    .map((encounter) => ({
      npc: encounter.npc,
      roleLabel: encounter.roleLabel,
      portraitKey: encounter.portraitKey,
      openingLine: encounter.openingLine,
      stance: encounter.stance,
      availableActionKinds: orderedAvailableActionKinds(encounter.permittedActionKinds),
    }));
}

// --- inventory ------------------------------------------------------------------------

export interface InventoryProjectionInput {
  readonly itemId: string;
  readonly displayName: string;
  readonly normalizedName: string;
  readonly description: string;
}

export function projectInventory(
  items: readonly InventoryProjectionInput[],
): InventoryItemView[] {
  return items
    .toSorted((left, right) =>
      compareByNormalizedNameThenId(
        { normalizedName: left.normalizedName, id: left.itemId },
        { normalizedName: right.normalizedName, id: right.itemId },
      ),
    )
    .map(({ itemId, displayName, description }) => ({
      itemId,
      displayName,
      description,
    }));
}

// --- discoveredClues -------------------------------------------------------------------

export interface DiscoveredClueProjectionInput {
  readonly clueId: string;
  readonly normalizedName: string;
  readonly title: string;
  readonly description: string;
  readonly contributors: readonly {
    readonly discoverySequence: number;
    readonly player: {
      readonly id: string;
      readonly actorType: "player";
      readonly displayName: string;
    };
  }[];
}

export function projectDiscoveredClues(
  clues: readonly DiscoveredClueProjectionInput[],
): DiscoveredClueView[] {
  return clues
    .toSorted((left, right) =>
      compareByNormalizedNameThenId(
        { normalizedName: left.normalizedName, id: left.clueId },
        { normalizedName: right.normalizedName, id: right.clueId },
      ),
    )
    .map((clue) => {
      const orderedContributors = clue.contributors
        .toSorted((left, right) =>
          compareByDiscoverySequenceThenPlayerId(
            { discoverySequence: left.discoverySequence, playerId: left.player.id },
            { discoverySequence: right.discoverySequence, playerId: right.player.id },
          ),
        )
        .map((contributor) => contributor.player);
      return {
        clueId: clue.clueId,
        title: clue.title,
        description: clue.description,
        firstContributor: orderedContributors[0]!,
        contributors: orderedContributors,
      };
    });
}

// --- activePromises -----------------------------------------------------------------------

export interface ActivePromiseProjectionInput {
  readonly promiseId: string;
  readonly acceptedAt: Date;
  readonly view: Omit<ActivePromiseView, "acceptedAt" | "promiseId">;
}

export function projectActivePromises(
  promises: readonly ActivePromiseProjectionInput[],
): ActivePromiseView[] {
  return promises
    .toSorted((left, right) =>
      compareByAcceptedAtThenId(
        { acceptedAt: left.acceptedAt, id: left.promiseId },
        { acceptedAt: right.acceptedAt, id: right.promiseId },
      ),
    )
    .map((promise) => ({
      promiseId: promise.promiseId,
      acceptedAt: promise.acceptedAt.toISOString(),
      ...promise.view,
    }));
}

// --- caseBoard and contradictions ----------------------------------------------------------

export interface CaseBoardProjectionInput {
  readonly entryId: string;
  readonly claimId: string | null;
  readonly createdAt: Date;
  readonly view: Omit<CaseBoardEntryView, "entryId" | "createdAt">;
}

export function projectCaseBoard(
  entries: readonly CaseBoardProjectionInput[],
): CaseBoardEntryView[] {
  return entries
    .toSorted((left, right) =>
      compareByCreatedAtThenId(
        { createdAt: left.createdAt, id: left.entryId },
        { createdAt: right.createdAt, id: right.entryId },
      ),
    )
    .map((entry) => ({
      entryId: entry.entryId,
      createdAt: entry.createdAt.toISOString(),
      ...entry.view,
    })) as unknown as CaseBoardEntryView[];
}

export function projectCaseBoardContradictions(
  visibleEntries: readonly BoardEntryRef[],
  contradictingClaimPairs: readonly ClaimContradictionPair[],
): CaseBoardContradictionView[] {
  return [...computeBoardContradictionPairs(visibleEntries, contradictingClaimPairs)];
}

// --- caseAttempts ------------------------------------------------------------------------

export interface CaseAttemptProjectionInput {
  readonly attemptId: string;
  readonly createdAt: Date;
  readonly view: Omit<CaseAttemptView, "attemptId" | "createdAt">;
}

export function projectCaseAttempts(
  attempts: readonly CaseAttemptProjectionInput[],
): CaseAttemptView[] {
  return attempts
    .toSorted((left, right) =>
      compareByCreatedAtThenId(
        { createdAt: left.createdAt, id: left.attemptId },
        { createdAt: right.createdAt, id: right.attemptId },
      ),
    )
    .map((attempt) => ({
      attemptId: attempt.attemptId,
      createdAt: attempt.createdAt.toISOString(),
      ...attempt.view,
    }));
}

// --- resolution: accusation option ordering and ending choices -------------------------------

export interface AuthoredOptionInput {
  readonly id: string;
  readonly displayName: string;
  readonly authoredOrder: number;
}

export function projectAccusationOptions(
  options: readonly AuthoredOptionInput[],
): AccusationOptionView[] {
  return options
    .toSorted(compareByAuthoredOrder)
    .map(({ id, displayName }) => ({ id, displayName }));
}

export function orderResolutionChoices<T extends { readonly value: string }>(
  choices: readonly T[],
): readonly T[] {
  return choices.toSorted((left, right) =>
    compareResolutionChoices(left.value, right.value),
  );
}

// --- Whole-view composition --------------------------------------------------------------------

export interface PlayerViewProjectionInputs {
  readonly viewVersion: string;
  readonly town: PlayerView["town"];
  readonly player: PlayerView["player"];
  readonly map: readonly LocationProjectionInput[];
  readonly currentLocation: {
    readonly location: { readonly id: string; readonly displayName: string } | null;
    readonly inspectables: readonly InspectableProjectionInput[];
  };
  readonly encounters: readonly EncounterProjectionInput[];
  readonly inventory: readonly InventoryProjectionInput[];
  readonly discoveredClues: readonly DiscoveredClueProjectionInput[];
  readonly activePromises: readonly ActivePromiseProjectionInput[];
  readonly caseBoard: readonly CaseBoardProjectionInput[];
  readonly caseBoardContradictionsInput: {
    readonly visibleEntries: readonly BoardEntryRef[];
    readonly contradictingClaimPairs: readonly ClaimContradictionPair[];
  };
  readonly caseAttempts: readonly CaseAttemptProjectionInput[];
  readonly resolution: ResolutionView;
  readonly ambientTransition: AmbientTransitionView | null;
}

export function projectPlayerView(inputs: PlayerViewProjectionInputs): PlayerView {
  return {
    viewVersion: inputs.viewVersion,
    town: inputs.town,
    player: inputs.player,
    map: projectMap(inputs.map),
    currentLocation: projectCurrentLocation(
      inputs.currentLocation.location,
      inputs.currentLocation.inspectables,
    ),
    encounters: projectEncounters(inputs.encounters),
    inventory: projectInventory(inputs.inventory),
    discoveredClues: projectDiscoveredClues(inputs.discoveredClues),
    activePromises: projectActivePromises(inputs.activePromises),
    caseBoard: projectCaseBoard(inputs.caseBoard),
    caseBoardContradictions: projectCaseBoardContradictions(
      inputs.caseBoardContradictionsInput.visibleEntries,
      inputs.caseBoardContradictionsInput.contradictingClaimPairs,
    ),
    caseAttempts: projectCaseAttempts(inputs.caseAttempts),
    resolution: inputs.resolution,
    ambientTransition: inputs.ambientTransition,
  };
}
