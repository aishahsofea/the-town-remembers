/**
 * The explicit player-view read set (`P3-06`).
 *
 * One function per projection region, each with a mandatory `town_id`
 * parameter and no `SELECT *`. These are the only reads `application/player-view/build.ts`
 * performs; every row shape here is deliberately narrow rather than a
 * reusable "load everything" snapshot, matching `D3-N`'s per-kind narrow-input
 * convention for the action executor.
 */

import { hasChapelAccess } from "@the-town-remembers/rules";
import { LOCKED_LOCATION_MESSAGE } from "@the-town-remembers/content";
import type { LocationAccessSchema } from "@the-town-remembers/http-contracts";
import type { Pool } from "pg";
import type { z } from "zod";

type LocationAccess = z.infer<typeof LocationAccessSchema>;

// --- town header --------------------------------------------------------------------

export type TownLifecycleStatus =
  "active" | "awaiting_resolution" | "resolved" | "retired";

export interface TownHeaderRow {
  readonly status: TownLifecycleStatus;
  readonly contentVersion: string;
}

export async function readTownHeader(
  pool: Pool,
  townId: string,
): Promise<TownHeaderRow | undefined> {
  const result = await pool.query<{
    status: TownLifecycleStatus;
    content_version: string;
  }>("SELECT status, content_version FROM public.towns WHERE id = $1", [townId]);
  const row = result.rows[0];
  if (!row) return undefined;
  return { status: row.status, contentVersion: row.content_version };
}

// --- player and current visit --------------------------------------------------------

export interface PlayerAndVisitRow {
  readonly displayName: string;
  readonly visitId: string | null;
  readonly locationEntityId: string | null;
}

/** The player's one active visit, if any — `null` fields mean `away`. */
export async function readPlayerAndVisit(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<PlayerAndVisitRow | undefined> {
  const result = await pool.query<{
    display_name: string;
    visit_id: string | null;
    location_entity_id: string | null;
  }>(
    `SELECT a.display_name,
            pv.id AS visit_id,
            pv.current_location_entity_id AS location_entity_id
       FROM public.actors a
       LEFT JOIN public.player_visits pv
         ON pv.town_id = a.town_id AND pv.player_id = a.id AND pv.status = 'active'
      WHERE a.town_id = $1 AND a.id = $2 AND a.actor_type = 'player'`,
    [townId, playerId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    displayName: row.display_name,
    visitId: row.visit_id,
    locationEntityId: row.location_entity_id,
  };
}

// --- map access -----------------------------------------------------------------------

export interface LocationAccessRow {
  readonly id: string;
  readonly entityKey: string;
  readonly displayName: string;
  readonly access: LocationAccess;
}

/**
 * Every location's access for this player. Only the Old Chapel is ever
 * locked in `bell-mystery-v1`; its unlock rule (`rules#hasChapelAccess`) is
 * evaluated here rather than generalized, matching how `persistence/players.ts`
 * already names `festival_square` as a literal rather than inventing
 * content-agnostic machinery for one location.
 */
export async function readMapAccess(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<readonly LocationAccessRow[]> {
  const [locations, capability, chapelKey] = await Promise.all([
    pool.query<{ id: string; entity_key: string; display_name: string }>(
      `SELECT id, entity_key, display_name FROM public.story_entities
        WHERE town_id = $1 AND entity_type = 'location'`,
      [townId],
    ),
    pool.query(
      `SELECT 1 FROM public.player_capabilities
        WHERE town_id = $1 AND player_id = $2 AND capability_key = 'enter_old_chapel'
          AND status = 'granted'`,
      [townId, playerId],
    ),
    pool.query(
      `SELECT 1 FROM public.items i
         JOIN public.story_entities se ON se.town_id = i.town_id AND se.id = i.id
        WHERE i.town_id = $1 AND se.entity_key = 'old_chapel_key' AND i.held_by_actor_id = $2`,
      [townId, playerId],
    ),
  ]);

  const hasCapability = (capability.rowCount ?? 0) > 0;
  const holdsChapelKey = (chapelKey.rowCount ?? 0) > 0;
  const chapelOpen = hasChapelAccess(holdsChapelKey, hasCapability);

  return locations.rows.map((row) => ({
    id: row.id,
    entityKey: row.entity_key,
    displayName: row.display_name,
    access:
      row.entity_key !== "old_chapel" || chapelOpen
        ? { state: "open" as const }
        : { state: "locked" as const, message: LOCKED_LOCATION_MESSAGE },
  }));
}

// --- inspectables at the current location -----------------------------------------------

export interface InspectableRow {
  readonly id: string;
  readonly inspectableKey: string;
  readonly displayName: string;
  readonly alreadyInspected: boolean;
}

export async function readInspectables(
  pool: Pool,
  townId: string,
  playerId: string,
  locationEntityId: string,
): Promise<readonly InspectableRow[]> {
  const result = await pool.query<{
    id: string;
    inspectable_key: string;
    display_name: string;
    already_inspected: boolean;
  }>(
    `SELECT i.id, i.inspectable_key, i.display_name,
            EXISTS (
              SELECT 1 FROM public.clues cl
                JOIN public.clue_discoveries cd
                  ON cd.town_id = cl.town_id AND cd.clue_id = cl.id
               WHERE cl.town_id = i.town_id AND cl.inspectable_id = i.id
                 AND cd.player_id = $3
            ) AS already_inspected
       FROM public.inspectables i
      WHERE i.town_id = $1 AND i.location_entity_id = $2 AND i.enabled = true`,
    [townId, locationEntityId, playerId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    inspectableKey: row.inspectable_key,
    displayName: row.display_name,
    alreadyInspected: row.already_inspected,
  }));
}

// --- NPCs at the current location --------------------------------------------------------

export interface CoLocatedNpcRow {
  readonly npcId: string;
  readonly characterKey: string;
  readonly displayName: string;
  readonly trustScore: number;
  readonly suspicionScore: number;
}

export async function readCoLocatedNpcs(
  pool: Pool,
  townId: string,
  playerId: string,
  locationEntityId: string,
): Promise<readonly CoLocatedNpcRow[]> {
  const result = await pool.query<{
    npc_id: string;
    character_key: string;
    display_name: string;
    trust_score: number;
    suspicion_score: number;
  }>(
    `SELECT n.id AS npc_id, ch.entity_key AS character_key, a.display_name,
            r.trust_score, r.suspicion_score
       FROM public.npcs n
       JOIN public.actors a ON a.town_id = n.town_id AND a.id = n.id
       JOIN public.story_entities ch
         ON ch.town_id = n.town_id AND ch.id = n.character_entity_id
       JOIN public.npc_player_relationships r
         ON r.town_id = n.town_id AND r.npc_id = n.id AND r.player_id = $3
      WHERE n.town_id = $1 AND n.location_entity_id = $2`,
    [townId, locationEntityId, playerId],
  );
  return result.rows.map((row) => ({
    npcId: row.npc_id,
    characterKey: row.character_key,
    displayName: row.display_name,
    trustScore: row.trust_score,
    suspicionScore: row.suspicion_score,
  }));
}

// --- inventory --------------------------------------------------------------------------

export interface InventoryItemRow {
  readonly itemId: string;
  readonly entityKey: string;
  readonly displayName: string;
}

export async function readInventory(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<readonly InventoryItemRow[]> {
  const result = await pool.query<{
    item_id: string;
    entity_key: string;
    display_name: string;
  }>(
    `SELECT i.id AS item_id, se.entity_key, se.display_name
       FROM public.items i
       JOIN public.story_entities se ON se.town_id = i.town_id AND se.id = i.id
      WHERE i.town_id = $1 AND i.held_by_actor_id = $2`,
    [townId, playerId],
  );
  return result.rows.map((row) => ({
    itemId: row.item_id,
    entityKey: row.entity_key,
    displayName: row.display_name,
  }));
}

// --- confrontation gate status -----------------------------------------------------------

export interface ConfrontationGateStatusRow {
  readonly bellRevealed: boolean;
  readonly requiredDiscoveredCount: number;
  readonly requiredTotalCount: number;
}

/**
 * Real DB truth for `rules#isConfrontationGateOpen`. `bellRevealed` reads
 * `items.revealed_event_id`, never a player's `clue_discoveries` row — the
 * bell's reveal is town-wide state, not per-player attribution. Required
 * counts read `clues.required_for_resolution` directly rather than matching
 * clue keys against an authored list, so a schema row is always the source of
 * truth for what "required" means.
 */
export async function readConfrontationGateStatus(
  pool: Pool,
  townId: string,
): Promise<ConfrontationGateStatusRow> {
  const result = await pool.query<{
    bell_revealed: boolean;
    required_discovered_count: string;
    required_total_count: string;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM public.items i
           JOIN public.story_entities se ON se.town_id = i.town_id AND se.id = i.id
          WHERE i.town_id = $1 AND se.entity_key = 'festival_bell'
            AND i.revealed_event_id IS NOT NULL
       ) AS bell_revealed,
       (SELECT count(DISTINCT cd.clue_id) FROM public.clue_discoveries cd
          JOIN public.clues cl ON cl.town_id = cd.town_id AND cl.id = cd.clue_id
         WHERE cd.town_id = $1 AND cl.required_for_resolution = true) AS required_discovered_count,
       (SELECT count(*) FROM public.clues
         WHERE town_id = $1 AND required_for_resolution = true) AS required_total_count`,
    [townId],
  );
  const row = result.rows[0]!;
  return {
    bellRevealed: row.bell_revealed,
    requiredDiscoveredCount: Number(row.required_discovered_count),
    requiredTotalCount: Number(row.required_total_count),
  };
}

// --- accusation candidate entities ---------------------------------------------------------

export interface StoryEntityRow {
  readonly id: string;
  readonly entityKey: string;
}

/**
 * Characters and motives by their real story-entity ID, for the open
 * accusation gate's `suspects`/`motives` options. `locations` reuses
 * {@link readMapAccess}'s rows rather than a third query — no Phase 3 action
 * can open the gate yet (`accuse` is Phase 6), but the projection must still
 * carry real IDs rather than authored keys the moment it does.
 */
export async function readAccusationCandidateEntities(
  pool: Pool,
  townId: string,
  entityType: "character" | "motive",
): Promise<readonly StoryEntityRow[]> {
  const result = await pool.query<{ id: string; entity_key: string }>(
    `SELECT id, entity_key FROM public.story_entities
      WHERE town_id = $1 AND entity_type = $2`,
    [townId, entityType],
  );
  return result.rows.map((row) => ({ id: row.id, entityKey: row.entity_key }));
}

// --- discovered clues, town-wide --------------------------------------------------------

export interface ClueDiscoveryRow {
  readonly clueId: string;
  readonly clueKey: string;
  readonly playerId: string;
  readonly playerDisplayName: string;
  readonly discoverySequence: number;
}

/** Every clue any player has discovered, one row per contributing discovery. */
export async function readDiscoveredClues(
  pool: Pool,
  townId: string,
): Promise<readonly ClueDiscoveryRow[]> {
  const result = await pool.query<{
    clue_id: string;
    clue_key: string;
    player_id: string;
    player_display_name: string;
    discovery_sequence: number;
  }>(
    `SELECT cl.id AS clue_id, cl.clue_key, cd.player_id, a.display_name AS player_display_name,
            we.sequence_no AS discovery_sequence
       FROM public.clue_discoveries cd
       JOIN public.clues cl ON cl.town_id = cd.town_id AND cl.id = cd.clue_id
       JOIN public.actors a ON a.town_id = cd.town_id AND a.id = cd.player_id
       JOIN public.world_events we ON we.town_id = cd.town_id AND we.id = cd.event_id
      WHERE cd.town_id = $1`,
    [townId],
  );
  return result.rows.map((row) => ({
    clueId: row.clue_id,
    clueKey: row.clue_key,
    playerId: row.player_id,
    playerDisplayName: row.player_display_name,
    discoverySequence: row.discovery_sequence,
  }));
}

// --- active promises, all NPCs, one player ----------------------------------------------

export interface ActivePromiseClaimSubjectRow {
  readonly claimId: string;
  readonly subjectEntityKey: string;
  readonly predicate: "was_at" | "moved" | "damaged" | "is_at" | "acted_for";
  readonly objectEntityKey: string;
  readonly polarity: "positive" | "negative";
  readonly contextKey: string;
}

export interface ActivePromiseItemSubjectRow {
  readonly itemId: string;
  readonly entityKey: string;
  readonly displayName: string;
}

export interface ActivePromiseRow {
  readonly promiseId: string;
  readonly npcId: string;
  readonly npcDisplayName: string;
  readonly kind: "keep_secret" | "return_item";
  readonly termsVersion: string;
  readonly createdAt: Date;
  readonly claim: ActivePromiseClaimSubjectRow | undefined;
  readonly item: ActivePromiseItemSubjectRow | undefined;
}

/** Every active promise across all NPCs for one player, subject fields fully joined. */
export async function readActivePromisesForPlayer(
  pool: Pool,
  townId: string,
  playerId: string,
): Promise<readonly ActivePromiseRow[]> {
  const result = await pool.query<{
    promise_id: string;
    npc_id: string;
    npc_display_name: string;
    kind: "keep_secret" | "return_item";
    terms_version: string;
    created_at: Date;
    claim_id: string | null;
    claim_subject_key: string | null;
    predicate: ActivePromiseClaimSubjectRow["predicate"] | null;
    claim_object_key: string | null;
    polarity: ActivePromiseClaimSubjectRow["polarity"] | null;
    context_key: string | null;
    item_id: string | null;
    item_entity_key: string | null;
    item_display_name: string | null;
  }>(
    `SELECT p.id AS promise_id, p.npc_id, npc_actor.display_name AS npc_display_name,
            p.kind, p.terms_version, p.created_at,
            c.id AS claim_id, subj.entity_key AS claim_subject_key, c.predicate,
            obj.entity_key AS claim_object_key, c.polarity, c.context_key,
            item_entity.id AS item_id, item_entity.entity_key AS item_entity_key,
            item_entity.display_name AS item_display_name
       FROM public.promises p
       JOIN public.actors npc_actor ON npc_actor.town_id = p.town_id AND npc_actor.id = p.npc_id
       LEFT JOIN public.claims c ON c.town_id = p.town_id AND c.id = p.protected_claim_id
       LEFT JOIN public.story_entities subj
         ON subj.town_id = c.town_id AND subj.id = c.subject_entity_id
       LEFT JOIN public.story_entities obj
         ON obj.town_id = c.town_id AND obj.id = c.object_entity_id
       LEFT JOIN public.story_entities item_entity
         ON item_entity.town_id = p.town_id AND item_entity.id = p.item_id
      WHERE p.town_id = $1 AND p.player_id = $2 AND p.status = 'active'`,
    [townId, playerId],
  );
  return result.rows.map((row) => ({
    promiseId: row.promise_id,
    npcId: row.npc_id,
    npcDisplayName: row.npc_display_name,
    kind: row.kind,
    termsVersion: row.terms_version,
    createdAt: row.created_at,
    claim:
      row.claim_id === null
        ? undefined
        : {
            claimId: row.claim_id,
            subjectEntityKey: row.claim_subject_key!,
            predicate: row.predicate!,
            objectEntityKey: row.claim_object_key!,
            polarity: row.polarity!,
            contextKey: row.context_key!,
          },
    item:
      row.item_id === null
        ? undefined
        : {
            itemId: row.item_id,
            entityKey: row.item_entity_key!,
            displayName: row.item_display_name!,
          },
  }));
}

// --- testimony / hearsay board entries, town-wide -------------------------------------

export interface BoardClaimEntryRow {
  readonly entryId: string;
  readonly entryKind: "testimony" | "hearsay";
  readonly createdAt: Date;
  readonly contributedByPlayerId: string;
  readonly contributedByDisplayName: string;
  readonly claim: ActivePromiseClaimSubjectRow;
  readonly transmissionId: string;
  readonly speaker: {
    readonly id: string;
    readonly actorType: "player" | "npc";
    readonly displayName: string;
  };
  readonly allegedSource:
    | {
        readonly id: string;
        readonly actorType: "player" | "npc";
        readonly displayName: string;
      }
    | undefined;
}

/** Every board entry attributed to a transmission (`testimony`/`hearsay`), town-wide. */
export async function readBoardClaimEntries(
  pool: Pool,
  townId: string,
): Promise<readonly BoardClaimEntryRow[]> {
  const result = await pool.query<{
    entry_id: string;
    entry_kind: "testimony" | "hearsay";
    created_at: Date;
    contributor_id: string;
    contributor_display_name: string;
    claim_id: string;
    claim_subject_key: string;
    predicate: ActivePromiseClaimSubjectRow["predicate"];
    claim_object_key: string;
    polarity: ActivePromiseClaimSubjectRow["polarity"];
    context_key: string;
    transmission_id: string;
    speaker_id: string;
    speaker_actor_type: "player" | "npc";
    speaker_display_name: string;
    alleged_id: string | null;
    alleged_actor_type: "player" | "npc" | null;
    alleged_display_name: string | null;
  }>(
    `SELECT cbe.id AS entry_id, cbe.entry_kind, cbe.created_at,
            contributor.id AS contributor_id, contributor.display_name AS contributor_display_name,
            c.id AS claim_id, subj.entity_key AS claim_subject_key, c.predicate,
            obj.entity_key AS claim_object_key, c.polarity, c.context_key,
            t.id AS transmission_id,
            speaker.id AS speaker_id, speaker.actor_type AS speaker_actor_type,
            speaker.display_name AS speaker_display_name,
            alleged.id AS alleged_id, alleged.actor_type AS alleged_actor_type,
            alleged.display_name AS alleged_display_name
       FROM public.case_board_entries cbe
       JOIN public.actors contributor
         ON contributor.town_id = cbe.town_id AND contributor.id = cbe.contributed_by_player_id
       JOIN public.claims c ON c.town_id = cbe.town_id AND c.id = cbe.claim_id
       JOIN public.story_entities subj ON subj.town_id = c.town_id AND subj.id = c.subject_entity_id
       JOIN public.story_entities obj ON obj.town_id = c.town_id AND obj.id = c.object_entity_id
       JOIN public.claim_transmissions t
         ON t.town_id = cbe.town_id AND t.id = cbe.transmission_id
       JOIN public.actors speaker ON speaker.town_id = t.town_id AND speaker.id = t.speaker_actor_id
       LEFT JOIN public.actors alleged
         ON alleged.town_id = t.town_id AND alleged.id = t.alleged_source_actor_id
      WHERE cbe.town_id = $1 AND cbe.entry_kind IN ('testimony', 'hearsay')`,
    [townId],
  );
  return result.rows.map((row) => ({
    entryId: row.entry_id,
    entryKind: row.entry_kind,
    createdAt: row.created_at,
    contributedByPlayerId: row.contributor_id,
    contributedByDisplayName: row.contributor_display_name,
    claim: {
      claimId: row.claim_id,
      subjectEntityKey: row.claim_subject_key,
      predicate: row.predicate,
      objectEntityKey: row.claim_object_key,
      polarity: row.polarity,
      contextKey: row.context_key,
    },
    transmissionId: row.transmission_id,
    speaker: {
      id: row.speaker_id,
      actorType: row.speaker_actor_type,
      displayName: row.speaker_display_name,
    },
    allegedSource:
      row.alleged_id === null
        ? undefined
        : {
            id: row.alleged_id,
            actorType: row.alleged_actor_type!,
            displayName: row.alleged_display_name!,
          },
  }));
}

/** Every transmission's provenance link, town-wide — the raw material `board/provenance.ts#buildProvenancePath` walks. */
export async function readTransmissionProvenanceLinks(
  pool: Pool,
  townId: string,
): Promise<
  readonly {
    readonly transmissionId: string;
    readonly parentTransmissionId: string | null;
    readonly speakerActorId: string;
    readonly speakerActorType: "player" | "npc";
    readonly speakerDisplayName: string;
  }[]
> {
  const result = await pool.query<{
    id: string;
    parent_transmission_id: string | null;
    speaker_actor_id: string;
    speaker_actor_type: "player" | "npc";
    speaker_display_name: string;
  }>(
    `SELECT t.id, t.parent_transmission_id, t.speaker_actor_id,
            speaker.actor_type AS speaker_actor_type, speaker.display_name AS speaker_display_name
       FROM public.claim_transmissions t
       JOIN public.actors speaker ON speaker.town_id = t.town_id AND speaker.id = t.speaker_actor_id
      WHERE t.town_id = $1`,
    [townId],
  );
  return result.rows.map((row) => ({
    transmissionId: row.id,
    parentTransmissionId: row.parent_transmission_id,
    speakerActorId: row.speaker_actor_id,
    speakerActorType: row.speaker_actor_type,
    speakerDisplayName: row.speaker_display_name,
  }));
}

// --- shared verified-evidence board ----------------------------------------------------

export interface VerifiedCaseBoardEntryRow {
  readonly entryId: string;
  readonly contributedByPlayerId: string;
  readonly contributedByDisplayName: string;
  readonly clueId: string;
  readonly clueKey: string;
  readonly createdAt: Date;
}

/** Phase 3 can create only verified physical-evidence entries. */
export async function readVerifiedCaseBoardEntries(
  pool: Pool,
  townId: string,
): Promise<readonly VerifiedCaseBoardEntryRow[]> {
  const result = await pool.query<{
    readonly entry_id: string;
    readonly contributed_by_player_id: string;
    readonly contributed_by_display_name: string;
    readonly clue_id: string;
    readonly clue_key: string;
    readonly created_at: Date;
  }>(
    `SELECT cbe.id AS entry_id,
            cbe.contributed_by_player_id,
            actor.display_name AS contributed_by_display_name,
            clue.id AS clue_id,
            clue.clue_key,
            cbe.created_at
       FROM public.case_board_entries cbe
       JOIN public.actors actor
         ON actor.town_id = cbe.town_id AND actor.id = cbe.contributed_by_player_id
       JOIN public.clues clue
         ON clue.town_id = cbe.town_id AND clue.id = cbe.clue_id
      WHERE cbe.town_id = $1
        AND cbe.entry_kind = 'verified_evidence'
        AND cbe.verification_status = 'verified_physical'`,
    [townId],
  );
  return result.rows.map((row) => ({
    entryId: row.entry_id,
    contributedByPlayerId: row.contributed_by_player_id,
    contributedByDisplayName: row.contributed_by_display_name,
    clueId: row.clue_id,
    clueKey: row.clue_key,
    createdAt: row.created_at,
  }));
}
