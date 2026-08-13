/**
 * The frozen `bell-mystery-v1` registry.
 *
 * A town records the content version it was created from and never looks up
 * "latest" again. That is what lets a later balance or copy change ship as a
 * new version without silently rewriting towns that are mid-play, and it is why
 * the accessor below takes a version and refuses anything else.
 */

import {
  CLAIMS,
  CLAIM_RELATIONS,
  claimNormalizedKeys,
  type AuthoredClaim,
  type AuthoredClaimRelation,
} from "./claims.js";
import {
  ALL_FALLBACK_LINES,
  CONFESSION_TEMPLATES,
  DENIAL_TEMPLATES,
  DISCLOSURE_TEMPLATES,
  DISCLOSURE_TIER_TABLE,
  NPC_DIALOGUE_PROFILES,
  OUTCOME_TEMPLATES,
  REQUESTED_ITEM_BINDINGS,
  type ConfessionTemplate,
  type DenialTemplate,
  type DisclosureTemplate,
  type DisclosureTierBinding,
  type FallbackLine,
  type NpcDialogueProfile,
  type OutcomeTemplate,
  type RequestedItemBinding,
} from "./dialogue/index.js";
import {
  CHARACTERS,
  CONTACT_EDGES,
  ITEMS,
  LOCATIONS,
  LOCKED_LOCATION_MESSAGE,
  MOTIVES,
  NPCS,
  STORY_ENTITIES,
  type AuthoredEntity,
  type AuthoredItem,
  type AuthoredLocation,
  type AuthoredNpc,
  type ContactEdge,
} from "./entities.js";
import {
  CASE_SOLUTION,
  CLUES,
  EVIDENCE_GATE_LOCKED_MESSAGE,
  INSPECTABLES,
  REQUIRED_CLUE_KEYS,
  WORLD_FACTS,
  type AuthoredClue,
  type AuthoredInspectable,
  type WorldFact,
} from "./evidence.js";
import {
  SEED_EPISODES,
  SEED_EVENTS,
  SEED_EVIDENCE,
  SEED_TRANSMISSIONS,
  seedBeliefs,
  type SeedBelief,
  type SeedEpisode,
  type SeedEvent,
  type SeedEvidence,
  type SeedTransmission,
} from "./seed.js";
import { CONTENT_VERSION, RULES_VERSION, PROMISE_TERMS } from "./versions.js";

export interface ContentRegistry {
  readonly contentVersion: string;
  readonly rulesVersion: string;
  readonly characters: readonly AuthoredEntity[];
  readonly locations: readonly AuthoredLocation[];
  readonly items: readonly AuthoredItem[];
  readonly motives: readonly AuthoredEntity[];
  readonly storyEntities: readonly AuthoredEntity[];
  readonly npcs: readonly AuthoredNpc[];
  readonly contactEdges: readonly ContactEdge[];
  readonly claims: readonly AuthoredClaim[];
  readonly claimRelations: readonly AuthoredClaimRelation[];
  readonly normalizedKeys: ReadonlyMap<string, string>;
  readonly worldFacts: readonly WorldFact[];
  readonly caseSolution: typeof CASE_SOLUTION;
  readonly inspectables: readonly AuthoredInspectable[];
  readonly clues: readonly AuthoredClue[];
  readonly requiredClueKeys: readonly string[];
  readonly seedEvents: readonly SeedEvent[];
  readonly seedEpisodes: readonly SeedEpisode[];
  readonly seedTransmissions: readonly SeedTransmission[];
  readonly seedEvidence: readonly SeedEvidence[];
  readonly seedBeliefs: readonly SeedBelief[];
  readonly promiseTerms: typeof PROMISE_TERMS;
  readonly lockedLocationMessage: string;
  readonly evidenceGateLockedMessage: string;
  readonly npcDialogueProfiles: readonly NpcDialogueProfile[];
  readonly requestedItemBindings: readonly RequestedItemBinding[];
  readonly disclosureTierTable: readonly DisclosureTierBinding[];
  readonly disclosureTemplates: readonly DisclosureTemplate[];
  readonly confessionTemplates: readonly ConfessionTemplate[];
  readonly outcomeTemplates: readonly OutcomeTemplate[];
  readonly denialTemplates: readonly DenialTemplate[];
  readonly fallbackLines: readonly FallbackLine[];
}

export const BELL_MYSTERY_V1: ContentRegistry = Object.freeze({
  contentVersion: CONTENT_VERSION,
  rulesVersion: RULES_VERSION,
  characters: CHARACTERS,
  locations: LOCATIONS,
  items: ITEMS,
  motives: MOTIVES,
  storyEntities: STORY_ENTITIES,
  npcs: NPCS,
  contactEdges: CONTACT_EDGES,
  claims: CLAIMS,
  claimRelations: CLAIM_RELATIONS,
  normalizedKeys: claimNormalizedKeys(),
  worldFacts: WORLD_FACTS,
  caseSolution: CASE_SOLUTION,
  inspectables: INSPECTABLES,
  clues: CLUES,
  requiredClueKeys: REQUIRED_CLUE_KEYS,
  seedEvents: SEED_EVENTS,
  seedEpisodes: SEED_EPISODES,
  seedTransmissions: SEED_TRANSMISSIONS,
  seedEvidence: SEED_EVIDENCE,
  seedBeliefs: seedBeliefs(),
  promiseTerms: PROMISE_TERMS,
  lockedLocationMessage: LOCKED_LOCATION_MESSAGE,
  evidenceGateLockedMessage: EVIDENCE_GATE_LOCKED_MESSAGE,
  npcDialogueProfiles: NPC_DIALOGUE_PROFILES,
  requestedItemBindings: REQUESTED_ITEM_BINDINGS,
  disclosureTierTable: DISCLOSURE_TIER_TABLE,
  disclosureTemplates: DISCLOSURE_TEMPLATES,
  confessionTemplates: CONFESSION_TEMPLATES,
  outcomeTemplates: OUTCOME_TEMPLATES,
  denialTemplates: DENIAL_TEMPLATES,
  fallbackLines: ALL_FALLBACK_LINES,
});

const REGISTRIES: ReadonlyMap<string, ContentRegistry> = new Map([
  [CONTENT_VERSION, BELL_MYSTERY_V1],
]);

export class UnknownContentVersionError extends Error {
  constructor(version: string) {
    super(`No authored content is registered for version "${version}".`);
    this.name = "UnknownContentVersionError";
  }
}

/**
 * Looks up content by frozen version. There is deliberately no "latest"
 * accessor: an operation on an existing town must use the version that town was
 * created from, and offering a convenient alternative is how that goes wrong.
 */
export function contentFor(version: string): ContentRegistry {
  const registry = REGISTRIES.get(version);
  if (!registry) throw new UnknownContentVersionError(version);
  return registry;
}
