/**
 * Static validation of the authored registry.
 *
 * The registry is hand-authored data, and the mistakes it invites are quiet
 * ones: a clue that supports a claim nobody seeded, a contradiction written in
 * only one direction, an NPC whose starting knowledge accidentally includes the
 * answer. None of those would fail a type check, and by the time a town is
 * materialized they would look like ordinary rows.
 *
 * These checks run without a database, so they fail in milliseconds on a laptop
 * rather than in an integration suite.
 */

import { CLAIM_ENTITY_MATRIX } from "./claim-matrix.js";
import { claimKeyV1 } from "./claim-key.js";
import type { ContentRegistry } from "./registry.js";

export interface ContentIssue {
  readonly code: string;
  readonly detail: string;
}

function duplicates(keys: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  return [...repeated].toSorted();
}

export function validateContent(registry: ContentRegistry): readonly ContentIssue[] {
  const issues: ContentIssue[] = [];
  const add = (code: string, detail: string): void => {
    issues.push({ code, detail });
  };

  const entityKeys = new Set(registry.storyEntities.map((entity) => entity.entityKey));
  const entityTypes = new Map(
    registry.storyEntities.map((entity) => [entity.entityKey, entity.entityType]),
  );
  const claimKeys = new Set(registry.claims.map((claim) => claim.claimKey));
  const npcKeys = new Set(registry.npcs.map((npc) => npc.npcKey));

  for (const [label, keys] of [
    ["story_entity", registry.storyEntities.map((entity) => entity.entityKey)],
    ["claim", registry.claims.map((claim) => claim.claimKey)],
    ["npc", registry.npcs.map((npc) => npc.npcKey)],
    ["inspectable", registry.inspectables.map((entry) => entry.inspectableKey)],
    ["clue", registry.clues.map((clue) => clue.clueKey)],
    ["world_fact", registry.worldFacts.map((fact) => fact.factKey)],
    ["seed_event", registry.seedEvents.map((event) => event.seedEventKey)],
    ["seed_episode", registry.seedEpisodes.map((episode) => episode.episodeKey)],
  ] as const) {
    for (const key of duplicates(keys)) add("duplicate_key", `${label}: ${key}`);
  }

  // --- Aliases (D4-J) -------------------------------------------------------
  //
  // Aliases are already NFKC-normalized and case-folded by the time they
  // reach here (content/entities.ts#normalizeAliases); this only checks that
  // no two different entities claim the same normalized alias, which would
  // make claim normalization's canonical_entities ambiguous.

  const aliasOwners = new Map<string, string>();
  for (const entity of registry.storyEntities) {
    for (const alias of entity.aliases) {
      const owner = aliasOwners.get(alias);
      if (owner !== undefined && owner !== entity.entityKey) {
        add(
          "alias_collision",
          `"${alias}" is claimed by both ${owner} and ${entity.entityKey}`,
        );
      } else {
        aliasOwners.set(alias, entity.entityKey);
      }
    }
  }

  // --- Claims -------------------------------------------------------------

  const normalizedKeys = new Map<string, string>();
  for (const claim of registry.claims) {
    const roles = CLAIM_ENTITY_MATRIX[claim.predicate];
    if (roles.subject !== claim.subjectType || roles.object !== claim.objectType) {
      add("claim_matrix", `${claim.claimKey} violates the ${claim.predicate} matrix`);
    }
    if (entityTypes.get(claim.subjectKey) !== claim.subjectType) {
      add("claim_subject", `${claim.claimKey} subject ${claim.subjectKey}`);
    }
    if (entityTypes.get(claim.objectKey) !== claim.objectType) {
      add("claim_object", `${claim.claimKey} object ${claim.objectKey}`);
    }

    const key = claimKeyV1({
      subjectEntityType: claim.subjectType,
      subjectEntityKey: claim.subjectKey,
      predicate: claim.predicate,
      objectEntityType: claim.objectType,
      objectEntityKey: claim.objectKey,
      polarity: claim.polarity,
      contextKey: claim.contextKey,
    });
    const collision = normalizedKeys.get(key);
    if (collision !== undefined) {
      add("claim_key_collision", `${claim.claimKey} collides with ${collision}`);
    }
    normalizedKeys.set(key, claim.claimKey);

    if (registry.normalizedKeys.get(claim.claimKey) !== key) {
      add("claim_key_drift", claim.claimKey);
    }
  }

  // --- Relations ----------------------------------------------------------

  const relationSet = new Set(
    registry.claimRelations.map(
      (r) => `${r.claimAKey}|${r.claimBKey}|${r.relationKind}`,
    ),
  );
  for (const relation of registry.claimRelations) {
    for (const key of [relation.claimAKey, relation.claimBKey]) {
      if (!claimKeys.has(key)) add("relation_target", `${key} is not a seeded claim`);
    }
    if (relation.claimAKey === relation.claimBKey) {
      add("relation_self", relation.claimAKey);
    }
    if (
      relation.relationKind === "contradicts" &&
      !relationSet.has(`${relation.claimBKey}|${relation.claimAKey}|contradicts`)
    ) {
      add(
        "relation_asymmetric",
        `${relation.claimAKey} contradicts ${relation.claimBKey} one way only`,
      );
    }
  }

  // --- Truth and evidence -------------------------------------------------

  for (const fact of registry.worldFacts) {
    if (!claimKeys.has(fact.claimKey)) add("fact_claim", fact.factKey);
  }

  const solution = registry.caseSolution;
  const solutionRoles: readonly (readonly [string, string])[] = [
    [solution.culpritKey, "character"],
    [solution.motiveKey, "motive"],
    [solution.locationKey, "location"],
    [solution.requiredItemKey, "item"],
  ];
  for (const [key, expected] of solutionRoles) {
    if (entityTypes.get(key) !== expected)
      add("solution_role", `${key} is not ${expected}`);
  }

  for (const inspectable of registry.inspectables) {
    if (entityTypes.get(inspectable.locationKey) !== "location") {
      add("inspectable_location", inspectable.inspectableKey);
    }
    if (
      inspectable.revealsItemKey !== undefined &&
      entityTypes.get(inspectable.revealsItemKey) !== "item"
    ) {
      add("inspectable_item", inspectable.inspectableKey);
    }
    for (const effect of inspectable.clue?.effects ?? []) {
      if (!claimKeys.has(effect.claimKey)) {
        add("clue_effect_claim", `${inspectable.clue?.clueKey}: ${effect.claimKey}`);
      }
      if (Math.abs(effect.signedWeight) !== 70) {
        add(
          "clue_effect_weight",
          `${inspectable.clue?.clueKey}: ${effect.signedWeight}`,
        );
      }
      if ((effect.effectKind === "supports") !== effect.signedWeight > 0) {
        add("clue_effect_sign", `${inspectable.clue?.clueKey}: ${effect.claimKey}`);
      }
    }
  }

  if (registry.requiredClueKeys.length !== 3) {
    add("required_clues", `expected three, found ${registry.requiredClueKeys.length}`);
  }

  // --- Items and NPCs -----------------------------------------------------

  for (const item of registry.items) {
    const hasLocation = item.initialLocationKey !== undefined;
    const hasHolder = item.initialHolderKey !== undefined;
    if (hasLocation === hasHolder) add("item_custody", item.entityKey);
    if (hasLocation && entityTypes.get(item.initialLocationKey ?? "") !== "location") {
      add("item_location", item.entityKey);
    }
    if (hasHolder && !npcKeys.has(item.initialHolderKey ?? "")) {
      add("item_holder", item.entityKey);
    }
  }

  for (const npc of registry.npcs) {
    if (entityTypes.get(npc.characterKey) !== "character")
      add("npc_character", npc.npcKey);
    if (entityTypes.get(npc.locationKey) !== "location")
      add("npc_location", npc.npcKey);
  }

  for (const edge of registry.contactEdges) {
    if (!npcKeys.has(edge.fromNpcKey) || !npcKeys.has(edge.toNpcKey)) {
      add("contact_edge_npc", `${edge.fromNpcKey}->${edge.toNpcKey}`);
    }
    if (edge.fromNpcKey === edge.toNpcKey) add("contact_edge_self", edge.fromNpcKey);
    if (edge.trustScore < -100 || edge.trustScore > 100) {
      add("contact_edge_trust", `${edge.fromNpcKey}->${edge.toNpcKey}`);
    }
  }

  // --- Seed ---------------------------------------------------------------

  const seedEventKeys = new Set(registry.seedEvents.map((event) => event.seedEventKey));
  let previousOffset = Number.NEGATIVE_INFINITY;
  for (const event of registry.seedEvents) {
    if (event.offsetMinutes >= 0) add("seed_offset_future", event.seedEventKey);
    if (event.offsetMinutes < previousOffset) {
      add("seed_offset_order", event.seedEventKey);
    }
    previousOffset = event.offsetMinutes;
  }

  for (const episode of registry.seedEpisodes) {
    if (!seedEventKeys.has(episode.seedEventKey)) {
      add("episode_event", episode.episodeKey);
    }
    if (!npcKeys.has(episode.npcKey)) add("episode_npc", episode.episodeKey);
    if (episode.importance < 0 || episode.importance > 100) {
      add("episode_importance", episode.episodeKey);
    }
    const seenReferences = new Set<string>();
    for (const reference of episode.references) {
      const token = `${reference.referenceKind}|${reference.key}`;
      if (seenReferences.has(token)) {
        add("episode_reference_duplicate", `${episode.episodeKey}: ${token}`);
      }
      seenReferences.add(token);
      const known =
        reference.referenceKind === "claim"
          ? claimKeys.has(reference.key)
          : entityKeys.has(reference.key);
      if (!known) add("episode_reference", `${episode.episodeKey}: ${reference.key}`);
    }
  }

  for (const transmission of registry.seedTransmissions) {
    if (!seedEventKeys.has(transmission.seedEventKey)) {
      add("transmission_event", transmission.transmissionKey);
    }
    if (!claimKeys.has(transmission.claimKey)) {
      add("transmission_claim", transmission.transmissionKey);
    }
    if (transmission.speakerNpcKey === transmission.recipientNpcKey) {
      add("transmission_self", transmission.transmissionKey);
    }
  }

  for (const evidence of registry.seedEvidence) {
    if (!seedEventKeys.has(evidence.seedEventKey)) {
      add("evidence_event", `${evidence.npcKey}/${evidence.claimKey}`);
    }
    if (!claimKeys.has(evidence.claimKey)) {
      add("evidence_claim", `${evidence.npcKey}/${evidence.claimKey}`);
    }
    if (evidence.evidenceKind === "contradiction") {
      const target = evidence.mirrorsEvidenceOf;
      if (!target) {
        add("mirror_missing_primary", `${evidence.npcKey}/${evidence.claimKey}`);
      } else if (
        !relationSet.has(`${target.claimKey}|${evidence.claimKey}|contradicts`)
      ) {
        add(
          "mirror_without_relation",
          `${target.claimKey} does not contradict ${evidence.claimKey}`,
        );
      }
    }
  }

  // --- Starting knowledge boundaries --------------------------------------
  //
  // The mystery only works if the NPCs begin genuinely partial. These are the
  // three boundaries Decision 009 states, checked against the seed rather than
  // trusted to the prose.

  const referencesFor = (npcKey: string): Set<string> => {
    const keys = new Set<string>();
    for (const episode of registry.seedEpisodes) {
      if (episode.npcKey !== npcKey) continue;
      for (const reference of episode.references) keys.add(reference.key);
    }
    for (const evidence of registry.seedEvidence) {
      if (evidence.npcKey === npcKey) keys.add(evidence.claimKey);
    }
    return keys;
  };

  const beliefsOf = (npcKey: string): Set<string> =>
    new Set(
      registry.seedBeliefs
        .filter((belief) => belief.npcKey === npcKey && belief.score > 0)
        .map((belief) => belief.claimKey),
    );

  const maraKnows = referencesFor("mara_venn");
  const maraBelieves = beliefsOf("mara_venn");
  if (maraKnows.has("old_chapel") || maraBelieves.has("bell_at_chapel")) {
    add("starting_knowledge", "Mara begins with the chapel location");
  }

  // Nessa saw a covered cart. Her episode of it must not name the bell, and she
  // must hold no positive belief that the bell was in the chapel: seeing the
  // frame empty at dawn is a different thing from knowing what she let through
  // the gate.
  const cartEpisode = registry.seedEpisodes.find(
    (episode) => episode.episodeKey === "nessa_saw_corins_cart",
  );
  if (
    cartEpisode?.references.some((reference) => reference.key === "festival_bell") ??
    true
  ) {
    add("starting_knowledge", "Nessa's cart observation names the bell");
  }
  const nessaBelieves = beliefsOf("nessa_reed");
  for (const forbidden of [
    "bell_at_chapel",
    "bell_at_chapel_current",
    "lark_damaged_bell",
  ]) {
    if (nessaBelieves.has(forbidden)) {
      add("starting_knowledge", `Nessa begins believing ${forbidden}`);
    }
  }

  const corinBelieves = beliefsOf("corin_hale");
  for (const required of [
    "lark_damaged_bell",
    "corin_moved_bell",
    "bell_at_chapel",
    "corin_protected_lark",
  ]) {
    if (!corinBelieves.has(required)) {
      add("starting_knowledge", `Corin is missing ${required}`);
    }
  }

  // --- Promises -----------------------------------------------------------

  const secret = registry.promiseTerms.keepLarkAccidentSecret;
  if (!claimKeys.has(secret.subjectClaimKey))
    add("promise_subject", secret.termsVersion);
  const key = registry.promiseTerms.returnChapelKey;
  if (entityTypes.get(key.subjectItemKey) !== "item")
    add("promise_subject", key.termsVersion);

  return issues;
}
