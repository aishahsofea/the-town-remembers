/**
 * Turns authored content into an ordered plan of rows.
 *
 * Pure: given the same content, creation time, and identity inputs, it produces
 * the same plan except for generated IDs. Nothing here reads a clock or touches
 * a database, so the arithmetic that matters — event sequencing, belief totals,
 * the ambient boundary — can be checked without one.
 *
 * Identities are generated per town. Two towns from one content version are
 * semantically identical and share no UUID, which is why every reference below
 * is resolved through a stable-key map rather than a fixed ID.
 */

import { randomUUID } from "node:crypto";

import { type ContentRegistry } from "@the-town-remembers/content";

export interface MaterializationInput {
  readonly contentVersion: string;
  readonly createdAt: Date;
  /** SHA-256 of the invite token. The plaintext never reaches this package. */
  readonly inviteTokenHash: Uint8Array;
}

export interface PlannedRow {
  readonly [column: string]: unknown;
}

export interface SeedPlan {
  readonly townId: string;
  readonly contentVersion: string;
  readonly createdAt: Date;
  readonly lastEventSequence: number;
  /** `<kind>:<authored key>` to generated UUID, for tests and materialization. */
  readonly ids: ReadonlyMap<string, string>;
  readonly storyEntities: readonly PlannedRow[];
  readonly actors: readonly PlannedRow[];
  readonly npcs: readonly PlannedRow[];
  readonly contactEdges: readonly PlannedRow[];
  readonly claims: readonly PlannedRow[];
  readonly claimRelations: readonly PlannedRow[];
  readonly worldFacts: readonly PlannedRow[];
  readonly caseSolution: PlannedRow;
  readonly items: readonly PlannedRow[];
  readonly inspectables: readonly PlannedRow[];
  readonly clues: readonly PlannedRow[];
  readonly clueEffects: readonly PlannedRow[];
  readonly worldEvents: readonly PlannedRow[];
  readonly episodes: readonly PlannedRow[];
  readonly episodeReferences: readonly PlannedRow[];
  readonly transmissions: readonly PlannedRow[];
  /** Primary contributions first; mirrors reference them by ID. */
  readonly primaryEvidence: readonly PlannedRow[];
  readonly mirrorEvidence: readonly PlannedRow[];
  readonly beliefs: readonly PlannedRow[];
}

export class SeedPlanError extends Error {
  constructor(detail: string) {
    super(`Cannot plan the seed: ${detail}`);
    this.name = "SeedPlanError";
  }
}

function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

export function planTown(
  content: ContentRegistry,
  input: MaterializationInput,
): SeedPlan {
  if (input.contentVersion !== content.contentVersion) {
    throw new SeedPlanError("the requested version does not match the registry");
  }

  const townId = randomUUID();
  const ids = new Map<string, string>();
  const id = (key: string): string => {
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    const generated = randomUUID();
    ids.set(key, generated);
    return generated;
  };
  const need = (key: string): string => {
    const found = ids.get(key);
    if (found === undefined) throw new SeedPlanError(`unresolved reference ${key}`);
    return found;
  };

  const createdAt = input.createdAt;

  const storyEntities = content.storyEntities.map((entity) => ({
    town_id: townId,
    id: id(`entity:${entity.entityKey}`),
    entity_type: entity.entityType,
    entity_key: entity.entityKey,
    display_name: entity.displayName,
    content_key: entity.contentKey,
    created_at: createdAt,
  }));

  const npcCharacters = new Map(
    content.characters.map((character) => [character.entityKey, character]),
  );
  const actors = content.npcs.map((npc) => {
    const character = npcCharacters.get(npc.characterKey);
    if (!character) throw new SeedPlanError(`npc ${npc.npcKey} has no character`);
    return {
      town_id: townId,
      id: id(`actor:${npc.npcKey}`),
      actor_type: "npc",
      display_name: character.displayName,
      display_name_normalized: character.displayName
        .normalize("NFKC")
        .trim()
        .replaceAll(/\s+/gu, " ")
        .toLowerCase(),
      created_at: createdAt,
    };
  });

  const npcs = content.npcs.map((npc) => ({
    town_id: townId,
    id: need(`actor:${npc.npcKey}`),
    character_entity_id: need(`entity:${npc.characterKey}`),
    location_entity_id: need(`entity:${npc.locationKey}`),
    profile_key: npc.profileKey,
    profile_version: npc.profileVersion,
    created_at: createdAt,
  }));

  const contactEdges = content.contactEdges.map((edge) => ({
    town_id: townId,
    from_npc_id: need(`actor:${edge.fromNpcKey}`),
    to_npc_id: need(`actor:${edge.toNpcKey}`),
    trust_score: edge.trustScore,
    enabled: true,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const claims = content.claims.map((claim) => ({
    town_id: townId,
    id: id(`claim:${claim.claimKey}`),
    subject_entity_id: need(`entity:${claim.subjectKey}`),
    subject_entity_type: claim.subjectType,
    predicate: claim.predicate,
    object_entity_id: need(`entity:${claim.objectKey}`),
    object_entity_type: claim.objectType,
    polarity: claim.polarity,
    context_key: claim.contextKey,
    normalized_key: content.normalizedKeys.get(claim.claimKey),
    created_at: createdAt,
  }));

  const claimRelations = content.claimRelations.map((relation) => ({
    town_id: townId,
    claim_a_id: need(`claim:${relation.claimAKey}`),
    claim_b_id: need(`claim:${relation.claimBKey}`),
    relation_kind: relation.relationKind,
    rule_version: content.rulesVersion,
    created_at: createdAt,
  }));

  const worldFacts = content.worldFacts.map((fact) => ({
    town_id: townId,
    id: id(`fact:${fact.factKey}`),
    fact_key: fact.factKey,
    claim_id: need(`claim:${fact.claimKey}`),
    visibility: fact.visibility,
    created_at: createdAt,
  }));

  const caseSolution: PlannedRow = {
    town_id: townId,
    culprit_entity_id: need(`entity:${content.caseSolution.culpritKey}`),
    motive_entity_id: need(`entity:${content.caseSolution.motiveKey}`),
    location_entity_id: need(`entity:${content.caseSolution.locationKey}`),
    required_item_id: need(`entity:${content.caseSolution.requiredItemKey}`),
    created_at: createdAt,
  };

  const items = content.items.map((item) => ({
    town_id: townId,
    // An item's row *is* its story entity, so the IDs are the same value.
    id: need(`entity:${item.entityKey}`),
    location_entity_id:
      item.initialLocationKey === undefined
        ? null
        : need(`entity:${item.initialLocationKey}`),
    location_entity_type: item.initialLocationKey === undefined ? null : "location",
    held_by_actor_id:
      item.initialHolderKey === undefined
        ? null
        : need(`actor:${item.initialHolderKey}`),
    portable: item.portable,
    revision: 0,
    revealed_event_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const inspectables = content.inspectables.map((inspectable) => ({
    town_id: townId,
    id: id(`inspectable:${inspectable.inspectableKey}`),
    inspectable_key: inspectable.inspectableKey,
    location_entity_id: need(`entity:${inspectable.locationKey}`),
    linked_entity_id:
      inspectable.revealsItemKey === undefined
        ? null
        : need(`entity:${inspectable.revealsItemKey}`),
    linked_entity_type: inspectable.revealsItemKey === undefined ? null : "item",
    display_name: inspectable.displayName,
    content_key: inspectable.contentKey,
    gate_key: null,
    enabled: true,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const clues = content.inspectables.flatMap((inspectable) =>
    inspectable.clue === undefined
      ? []
      : [
          {
            town_id: townId,
            id: id(`clue:${inspectable.clue.clueKey}`),
            clue_key: inspectable.clue.clueKey,
            inspectable_id: need(`inspectable:${inspectable.inspectableKey}`),
            clue_kind: inspectable.clue.clueKind,
            content_key: `clue.${inspectable.clue.clueKey}`,
            required_for_resolution: inspectable.clue.requiredForResolution,
            created_at: createdAt,
          },
        ],
  );

  const clueEffects = content.clues.flatMap((clue) =>
    clue.effects.map((effect) => ({
      town_id: townId,
      clue_id: need(`clue:${clue.clueKey}`),
      claim_id: need(`claim:${effect.claimKey}`),
      effect_kind: effect.effectKind,
      signed_weight: effect.signedWeight,
      rule_version: content.rulesVersion,
      created_at: createdAt,
    })),
  );

  // --- Causal history -----------------------------------------------------

  const episodesByEvent = new Map(
    content.seedEpisodes.map((episode) => [episode.seedEventKey, episode]),
  );
  const transmissionsByEvent = new Map(
    content.seedTransmissions.map((transmission) => [
      transmission.seedEventKey,
      transmission,
    ]),
  );

  const worldEvents = content.seedEvents.map((event, index) => {
    const episode = episodesByEvent.get(event.seedEventKey);
    const transmission = transmissionsByEvent.get(event.seedEventKey);
    const claimReferences =
      episode?.references.filter((reference) => reference.referenceKind === "claim") ??
      [];
    const locationReference = episode?.references.find(
      (reference) => reference.referenceKind === "location",
    );

    return {
      town_id: townId,
      id: id(`event:${event.seedEventKey}`),
      sequence_no: index + 1,
      event_type: event.eventType,
      // Authored backstory is inspectable history, not new activity, so no
      // later departure can schedule an ambient tick from it.
      ambient_eligible: false,
      occurred_at: minutesAfter(createdAt, event.offsetMinutes),
      origin_kind: "system_seed",
      player_action_id: null,
      ambient_job_execution_id: null,
      effect_index: 0,
      effect_key: `seed:${content.contentVersion}:${event.seedEventKey}`,
      actor_id: transmission
        ? need(`actor:${transmission.speakerNpcKey}`)
        : episode
          ? need(`actor:${episode.npcKey}`)
          : null,
      target_actor_id: transmission
        ? need(`actor:${transmission.recipientNpcKey}`)
        : null,
      subject_entity_id: null,
      location_entity_id: locationReference
        ? need(`entity:${locationReference.key}`)
        : null,
      // Typed columns hold a reference only when there is exactly one. An
      // observation covering three claims names them all through
      // `episode_references` instead of picking an arbitrary first.
      claim_id: transmission
        ? need(`claim:${transmission.claimKey}`)
        : claimReferences.length === 1 && claimReferences[0]
          ? need(`claim:${claimReferences[0].key}`)
          : null,
      clue_id: null,
      promise_id: null,
      payload: {
        version: "world-event/1",
        contentVersion: content.contentVersion,
        seedEventKey: event.seedEventKey,
      },
      created_at: createdAt,
    };
  });

  const eventTimes = new Map(
    content.seedEvents.map((event) => [
      event.seedEventKey,
      minutesAfter(createdAt, event.offsetMinutes),
    ]),
  );

  const episodes = content.seedEpisodes.map((episode) => ({
    town_id: townId,
    id: id(`episode:${episode.episodeKey}`),
    npc_id: need(`actor:${episode.npcKey}`),
    event_id: need(`event:${episode.seedEventKey}`),
    episode_kind: episode.episodeKind,
    summary: episode.summary,
    importance: episode.importance,
    occurred_at: eventTimes.get(episode.seedEventKey),
    embedding: null,
    // Seed episodes are embedded later by the ambient path; a pending vector
    // never blocks recall, which falls back to the deterministic pool.
    embedding_status: "pending",
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const episodeReferences = content.seedEpisodes.flatMap((episode) =>
    episode.references.map((reference) => ({
      town_id: townId,
      id: randomUUID(),
      episode_id: need(`episode:${episode.episodeKey}`),
      reference_kind: reference.referenceKind,
      entity_id:
        reference.referenceKind === "claim" ? null : need(`entity:${reference.key}`),
      claim_id:
        reference.referenceKind === "claim" ? need(`claim:${reference.key}`) : null,
      created_at: createdAt,
    })),
  );

  const transmissions = content.seedTransmissions.map((transmission) => {
    const transmissionId = id(`transmission:${transmission.transmissionKey}`);
    return {
      town_id: townId,
      id: transmissionId,
      claim_id: need(`claim:${transmission.claimKey}`),
      speaker_actor_id: need(`actor:${transmission.speakerNpcKey}`),
      recipient_actor_id: need(`actor:${transmission.recipientNpcKey}`),
      recipient_actor_type: "npc",
      parent_transmission_id: null,
      parent_is_eligible: null,
      // The speaker originates the claim, so the transmission is its own root.
      root_transmission_id: transmissionId,
      source_episode_id: null,
      alleged_source_actor_id: null,
      source_kind: "original_assertion",
      hop_count: 0,
      event_id: need(`event:${transmission.seedEventKey}`),
      interaction_id: null,
      ordinal: 0,
      created_at: eventTimes.get(transmission.seedEventKey),
    };
  });

  const evidenceId = (npcKey: string, claimKey: string): string =>
    id(`evidence:${npcKey}/${claimKey}`);

  const buildEvidence = (
    evidence: ContentRegistry["seedEvidence"][number],
  ): PlannedRow => ({
    town_id: townId,
    id: evidenceId(evidence.npcKey, evidence.claimKey),
    npc_id: need(`actor:${evidence.npcKey}`),
    claim_id: need(`claim:${evidence.claimKey}`),
    event_id: need(`event:${evidence.seedEventKey}`),
    episode_id:
      evidence.episodeKey === undefined ? null : need(`episode:${evidence.episodeKey}`),
    transmission_id:
      evidence.transmissionKey === undefined
        ? null
        : need(`transmission:${evidence.transmissionKey}`),
    source_root_transmission_id:
      evidence.transmissionKey === undefined
        ? null
        : need(`transmission:${evidence.transmissionKey}`),
    independent_source_actor_id:
      evidence.independentSourceNpcKey === undefined
        ? null
        : need(`actor:${evidence.independentSourceNpcKey}`),
    corroboration_threshold: null,
    clue_id: null,
    evidence_kind: evidence.evidenceKind,
    signed_weight: evidence.signedWeight,
    trust_snapshot: evidence.trustSnapshot ?? null,
    hop_count: evidence.transmissionKey === undefined ? null : 0,
    mirrors_evidence_id:
      evidence.mirrorsEvidenceOf === undefined
        ? null
        : evidenceId(
            evidence.mirrorsEvidenceOf.npcKey,
            evidence.mirrorsEvidenceOf.claimKey,
          ),
    reverses_evidence_id: null,
    rule_version: content.rulesVersion,
    created_at: eventTimes.get(evidence.seedEventKey),
  });

  // Mirrors point at the primary row they oppose, so primaries insert first.
  const primaryEvidence = content.seedEvidence
    .filter((evidence) => evidence.mirrorsEvidenceOf === undefined)
    .map(buildEvidence);
  const mirrorEvidence = content.seedEvidence
    .filter((evidence) => evidence.mirrorsEvidenceOf !== undefined)
    .map(buildEvidence);

  const beliefs = content.seedBeliefs.map((belief) => ({
    town_id: townId,
    npc_id: need(`actor:${belief.npcKey}`),
    claim_id: need(`claim:${belief.claimKey}`),
    score: belief.score,
    label: belief.label,
    revision: 0,
    updated_event_id: need(`event:${belief.seedEventKey}`),
    created_at: createdAt,
    updated_at: createdAt,
  }));

  return {
    townId,
    contentVersion: content.contentVersion,
    createdAt,
    lastEventSequence: worldEvents.length,
    ids,
    storyEntities,
    actors,
    npcs,
    contactEdges,
    claims,
    claimRelations,
    worldFacts,
    caseSolution,
    items,
    inspectables,
    clues,
    clueEffects,
    worldEvents,
    episodes,
    episodeReferences,
    transmissions,
    primaryEvidence,
    mirrorEvidence,
    beliefs,
  };
}
