/**
 * The four pure input shapes named by the Phase 2 plan, built from
 * `Selectable<...Table>` narrowings of the generated schema types.
 *
 * Every array here is `readonly`, and callers must freeze the values they
 * pass in: `determinism.test.ts` proves that a rule function cannot mutate
 * its input by calling `Object.freeze` at the fixture boundary and asserting
 * a mutation attempt throws.
 */

import type { Selectable } from "kysely";

import type { ContentRegistry } from "@the-town-remembers/content";
import type {
  BeliefEvidenceTable,
  CaseSolutionsTable,
  ClaimsTable,
  ClaimTransmissionsTable,
  EpisodeReferencesTable,
  EpisodesTable,
  ItemsTable,
  NpcBeliefsTable,
  NpcContactEdgesTable,
  NpcPlayerRelationshipsTable,
  PlayerCapabilitiesTable,
  PlayerVisitsTable,
  PromisesTable,
  RelationshipChangesTable,
  TownResolutionsTable,
  TownsTable,
  WorldEventsTable,
} from "@the-town-remembers/database/schema";

/** Current mutable state only — never event history. */
export interface CanonicalTownSnapshot {
  readonly town: Selectable<TownsTable>;
  readonly items: readonly Selectable<ItemsTable>[];
  readonly playerCapabilities: readonly Selectable<PlayerCapabilitiesTable>[];
  readonly promises: readonly Selectable<PromisesTable>[];
  readonly npcBeliefs: readonly Selectable<NpcBeliefsTable>[];
  readonly npcPlayerRelationships: readonly Selectable<NpcPlayerRelationshipsTable>[];
  readonly npcContactEdges: readonly Selectable<NpcContactEdgesTable>[];
  readonly playerVisits: readonly Selectable<PlayerVisitsTable>[];
  /** The one private solution row for this town. */
  readonly caseSolution: Selectable<CaseSolutionsTable>;
  readonly townResolutions: readonly Selectable<TownResolutionsTable>[];
}

/** An ordered, read-only slice of causal history plus the side tables it references. */
export interface WorldEventHistory {
  readonly events: readonly Selectable<WorldEventsTable>[];
  readonly claims: readonly Selectable<ClaimsTable>[];
  readonly claimTransmissions: readonly Selectable<ClaimTransmissionsTable>[];
  readonly beliefEvidence: readonly Selectable<BeliefEvidenceTable>[];
  readonly relationshipChanges: readonly Selectable<RelationshipChangesTable>[];
  readonly episodes: readonly Selectable<EpisodesTable>[];
  readonly episodeReferences: readonly Selectable<EpisodeReferencesTable>[];
}

/**
 * The per-NPC slice a disclosure or ambient rule may see: this NPC's own
 * beliefs, relationships, episodes, and promises only — never another NPC's.
 */
export interface NpcScopedKnowledge {
  readonly npcId: Selectable<NpcBeliefsTable>["npc_id"];
  readonly beliefs: readonly Selectable<NpcBeliefsTable>[];
  readonly relationships: readonly Selectable<NpcPlayerRelationshipsTable>[];
  readonly episodes: readonly Selectable<EpisodesTable>[];
  readonly episodeReferences: readonly Selectable<EpisodeReferencesTable>[];
  readonly promises: readonly Selectable<PromisesTable>[];
}

/** The frozen content registry entries a projector resolves display strings from. */
export interface PlayerSafePresentationInputs {
  readonly content: ContentRegistry;
}
