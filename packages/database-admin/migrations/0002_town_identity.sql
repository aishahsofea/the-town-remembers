-- Town, story-entity, and actor identity.
--
-- Two shapes recur through the whole schema and are established here.
--
-- Every town-owned table's primary key begins with `town_id`, and every foreign
-- key between town-owned rows carries `town_id` on both sides. A child row
-- therefore cannot point at a parent in another town: the composite key makes
-- cross-tenant references unrepresentable rather than merely discouraged.
--
-- References whose allowed type matters carry the expected discriminator as a
-- checked constant column and join through a three-column unique key. That is
-- what stops a player actor from acquiring an NPC subtype, or a case solution
-- from naming a location as its culprit, without trusting application code.
--
-- Deletes are never used at runtime, so every foreign key restricts.

CREATE TABLE public.towns (
  id UUID NOT NULL,
  invite_token_hash BYTES NOT NULL,
  content_version STRING NOT NULL,
  status STRING NOT NULL,
  revision INT8 NOT NULL DEFAULT 0,
  last_event_sequence INT8 NOT NULL DEFAULT 0,
  ambient_scheduled_through_sequence INT8 NOT NULL DEFAULT 0,
  winning_case_attempt_id UUID NULL,
  resolution_owner_player_id UUID NULL,
  resolution_reservation_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ NULL,

  CONSTRAINT pk_towns PRIMARY KEY (id),
  CONSTRAINT uq_towns__invite_token_hash UNIQUE (invite_token_hash),
  CONSTRAINT ck_towns__status CHECK (status IN ({{TOWN_STATUSES}})),
  -- Only the SHA-256 of the invite is ever stored, so anything else is a bug.
  CONSTRAINT ck_towns__invite_token_hash_length
    CHECK (length(invite_token_hash) = 32),
  CONSTRAINT ck_towns__counters_non_negative CHECK (
    revision >= 0
    AND last_event_sequence >= 0
    AND ambient_scheduled_through_sequence >= 0
  ),
  -- Ambient ranges are allocated from already-appended events, so the
  -- scheduling boundary can never run ahead of the event sequence.
  CONSTRAINT ck_towns__ambient_boundary
    CHECK (ambient_scheduled_through_sequence <= last_event_sequence),
  -- The reservation is absent while active, complete once an accusation wins,
  -- and retained afterwards as audit identity. A town retired without ever
  -- resolving keeps all three null, which is why `retired` is unconstrained.
  CONSTRAINT ck_towns__resolution_reservation CHECK (
    CASE status
      WHEN 'active' THEN
        winning_case_attempt_id IS NULL
        AND resolution_owner_player_id IS NULL
        AND resolution_reservation_expires_at IS NULL
      WHEN 'awaiting_resolution' THEN
        winning_case_attempt_id IS NOT NULL
        AND resolution_owner_player_id IS NOT NULL
        AND resolution_reservation_expires_at IS NOT NULL
      WHEN 'resolved' THEN
        winning_case_attempt_id IS NOT NULL
        AND resolution_owner_player_id IS NOT NULL
        AND resolution_reservation_expires_at IS NOT NULL
      ELSE true
    END
  ),
  CONSTRAINT ck_towns__resolved_at CHECK (
    CASE status
      WHEN 'active' THEN resolved_at IS NULL
      WHEN 'awaiting_resolution' THEN resolved_at IS NULL
      WHEN 'resolved' THEN resolved_at IS NOT NULL
      ELSE true
    END
  )
);

-- Authored people, locations, items, and motives share one identity space so
-- claims can use real foreign keys instead of polymorphic, unvalidated IDs.
CREATE TABLE public.story_entities (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  entity_type STRING NOT NULL,
  entity_key STRING NOT NULL,
  display_name STRING NOT NULL,
  content_key STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_story_entities PRIMARY KEY (town_id, id),
  CONSTRAINT fk_story_entities__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  CONSTRAINT uq_story_entities__entity_key UNIQUE (town_id, entity_key),
  -- The target of every type-discriminated foreign key in the schema.
  CONSTRAINT uq_story_entities__typed_identity UNIQUE (town_id, id, entity_type),
  CONSTRAINT ck_story_entities__entity_type
    CHECK (entity_type IN ({{STORY_ENTITY_TYPES}}))
);

-- Players and conversational NPCs share one identity space so player-to-NPC,
-- NPC-to-NPC, and NPC-to-player speech uses one provenance model.
CREATE TABLE public.actors (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  actor_type STRING NOT NULL,
  display_name STRING NOT NULL,
  display_name_normalized STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_actors PRIMARY KEY (town_id, id),
  CONSTRAINT fk_actors__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  -- Prevents both duplicate player names and authored-NPC impersonation. The
  -- normalized form is NFKC, trimmed, whitespace-collapsed, and case-folded by
  -- the write boundary; the database only enforces that it is unique.
  CONSTRAINT uq_actors__display_name_normalized
    UNIQUE (town_id, display_name_normalized),
  CONSTRAINT uq_actors__typed_identity UNIQUE (town_id, id, actor_type),
  CONSTRAINT ck_actors__actor_type CHECK (actor_type IN ({{ACTOR_TYPES}}))
);

CREATE TABLE public.players (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  actor_type STRING NOT NULL DEFAULT 'player',
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_players PRIMARY KEY (town_id, id),
  CONSTRAINT ck_players__actor_type CHECK (actor_type = 'player'),
  -- Joining through the discriminator is what makes a player actor unable to
  -- acquire an NPC subtype, and vice versa.
  CONSTRAINT fk_players__actor
    FOREIGN KEY (town_id, id, actor_type)
    REFERENCES public.actors (town_id, id, actor_type) ON DELETE RESTRICT
);

CREATE TABLE public.npcs (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  actor_type STRING NOT NULL DEFAULT 'npc',
  character_entity_id UUID NOT NULL,
  character_entity_type STRING NOT NULL DEFAULT 'character',
  location_entity_id UUID NOT NULL,
  location_entity_type STRING NOT NULL DEFAULT 'location',
  profile_key STRING NOT NULL,
  profile_version STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_npcs PRIMARY KEY (town_id, id),
  CONSTRAINT ck_npcs__actor_type CHECK (actor_type = 'npc'),
  CONSTRAINT ck_npcs__character_entity_type
    CHECK (character_entity_type = 'character'),
  CONSTRAINT ck_npcs__location_entity_type CHECK (location_entity_type = 'location'),
  CONSTRAINT fk_npcs__actor
    FOREIGN KEY (town_id, id, actor_type)
    REFERENCES public.actors (town_id, id, actor_type) ON DELETE RESTRICT,
  CONSTRAINT fk_npcs__character
    FOREIGN KEY (town_id, character_entity_id, character_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_npcs__location
    FOREIGN KEY (town_id, location_entity_id, location_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  -- One authored character has at most one conversational actor. Lark is a
  -- character entity with no row here at all.
  CONSTRAINT uq_npcs__character UNIQUE (town_id, character_entity_id)
);

-- Authored directional NPC-to-NPC trust. Contact eligibility reads the
-- speaker-to-listener edge; testimony weighting reads the listener-to-speaker
-- edge, which is why the pair is directional rather than symmetric.
CREATE TABLE public.npc_contact_edges (
  town_id UUID NOT NULL,
  from_npc_id UUID NOT NULL,
  to_npc_id UUID NOT NULL,
  trust_score INT4 NOT NULL,
  enabled BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_npc_contact_edges PRIMARY KEY (town_id, from_npc_id, to_npc_id),
  CONSTRAINT fk_npc_contact_edges__from
    FOREIGN KEY (town_id, from_npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_npc_contact_edges__to
    FOREIGN KEY (town_id, to_npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_npc_contact_edges__distinct CHECK (from_npc_id <> to_npc_id),
  CONSTRAINT ck_npc_contact_edges__trust_range
    CHECK (trust_score BETWEEN -100 AND 100)
);
