-- Claims, dialogue records, provenance, and episodic memory.
--
-- A claim is a proposition, not a fact. Objective truth lives in `world_facts`,
-- `case_solutions`, and current-state tables such as `items`; nothing here
-- asserts that a claim is true. That separation is what lets a player spread a
-- false rumour that changes NPC dialogue while the bell's actual location is
-- untouched.
--
-- Claim identity is the `claim-key:v1` representation over frozen authored
-- entity keys, so a seeded proposition and the same proposition normalized
-- later in play collide on `normalized_key` and reuse one row.
--
-- Provenance is explicit rather than inferred from prose: every communication
-- names its speaker, recipient, source kind, and parent, so a player-visible
-- chain can be walked without asking a model what it meant.
--
-- Foreign keys to `player_actions` and `world_events` are cyclic with tables
-- created later and are added by 0009.

CREATE TABLE public.claims (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  subject_entity_id UUID NOT NULL,
  subject_entity_type STRING NOT NULL,
  predicate STRING NOT NULL,
  object_entity_id UUID NOT NULL,
  object_entity_type STRING NOT NULL,
  polarity STRING NOT NULL,
  context_key STRING NOT NULL,
  normalized_key STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_claims PRIMARY KEY (town_id, id),
  CONSTRAINT fk_claims__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  CONSTRAINT uq_claims__normalized_key UNIQUE (town_id, normalized_key),
  CONSTRAINT fk_claims__subject
    FOREIGN KEY (town_id, subject_entity_id, subject_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_claims__object
    FOREIGN KEY (town_id, object_entity_id, object_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT ck_claims__predicate CHECK (predicate IN ({{CLAIM_PREDICATES}})),
  CONSTRAINT ck_claims__polarity CHECK (polarity IN ({{CLAIM_POLARITIES}})),
  -- The predicate/type matrix is enforced here rather than trusted to
  -- application code, so no writer can create "a location damaged an item".
  CONSTRAINT ck_claims__entity_matrix CHECK (
    {{CLAIM_ENTITY_MATRIX}}
  )
);

-- Deterministic and authored semantic relations. Contradiction is symmetric and
-- stored in both directions so a mirror lookup is one query; entailment is
-- directional and stored once.
CREATE TABLE public.claim_relations (
  town_id UUID NOT NULL,
  claim_a_id UUID NOT NULL,
  claim_b_id UUID NOT NULL,
  relation_kind STRING NOT NULL,
  rule_version STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_claim_relations
    PRIMARY KEY (town_id, claim_a_id, claim_b_id, relation_kind),
  CONSTRAINT fk_claim_relations__claim_a
    FOREIGN KEY (town_id, claim_a_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_relations__claim_b
    FOREIGN KEY (town_id, claim_b_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_claim_relations__relation_kind
    CHECK (relation_kind IN ({{CLAIM_RELATION_KINDS}})),
  CONSTRAINT ck_claim_relations__distinct CHECK (claim_a_id <> claim_b_id)
);

-- Normalization and confirmation are separate operations. An unconfirmed draft
-- has no belief or gameplay effect at all, which is why it lives in its own
-- table rather than as a provisional claim.
CREATE TABLE public.claim_drafts (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  target_npc_id UUID NOT NULL,
  original_text STRING NOT NULL,
  subject_entity_id UUID NOT NULL,
  subject_entity_type STRING NOT NULL,
  predicate STRING NOT NULL,
  object_entity_id UUID NOT NULL,
  object_entity_type STRING NOT NULL,
  polarity STRING NOT NULL,
  context_key STRING NOT NULL,
  normalized_key STRING NOT NULL,
  alleged_source_actor_id UUID NULL,
  status STRING NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  normalization_action_id UUID NOT NULL,
  confirmed_by_action_id UUID NULL,
  confirmed_claim_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_claim_drafts PRIMARY KEY (town_id, id),
  CONSTRAINT fk_claim_drafts__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_drafts__visit
    FOREIGN KEY (town_id, visit_id) REFERENCES public.player_visits (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_drafts__target_npc
    FOREIGN KEY (town_id, target_npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_drafts__subject
    FOREIGN KEY (town_id, subject_entity_id, subject_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_drafts__object
    FOREIGN KEY (town_id, object_entity_id, object_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  -- An alleged source is an actor the player explicitly named. Application code
  -- never infers one from NPC dialogue.
  CONSTRAINT fk_claim_drafts__alleged_source
    FOREIGN KEY (town_id, alleged_source_actor_id)
    REFERENCES public.actors (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_drafts__confirmed_claim
    FOREIGN KEY (town_id, confirmed_claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_claim_drafts__status CHECK (status IN ({{CLAIM_DRAFT_STATUSES}})),
  CONSTRAINT ck_claim_drafts__predicate CHECK (predicate IN ({{CLAIM_PREDICATES}})),
  CONSTRAINT ck_claim_drafts__polarity CHECK (polarity IN ({{CLAIM_POLARITIES}})),
  CONSTRAINT ck_claim_drafts__entity_matrix CHECK (
    {{CLAIM_ENTITY_MATRIX}}
  ),
  -- Only a confirmed draft names the action that confirmed it and the claim it
  -- became; a pending, cancelled, or expired draft names neither.
  CONSTRAINT ck_claim_drafts__confirmation CHECK (
    CASE status
      WHEN 'confirmed' THEN
        confirmed_by_action_id IS NOT NULL AND confirmed_claim_id IS NOT NULL
      ELSE confirmed_by_action_id IS NULL AND confirmed_claim_id IS NULL
    END
  )
);

-- One accepted NPC turn and the exact text the player saw. Immutable: a repair
-- or fallback is recorded as its response mode, not by rewriting the row.
CREATE TABLE public.npc_interactions (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_action_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  player_id UUID NOT NULL,
  npc_id UUID NOT NULL,
  event_id UUID NOT NULL,
  input_kind STRING NOT NULL,
  player_text STRING NULL,
  npc_text STRING NOT NULL,
  response_mode STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_npc_interactions PRIMARY KEY (town_id, id),
  CONSTRAINT uq_npc_interactions__player_action UNIQUE (town_id, player_action_id),
  CONSTRAINT fk_npc_interactions__visit
    FOREIGN KEY (town_id, visit_id) REFERENCES public.player_visits (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_npc_interactions__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_npc_interactions__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_npc_interactions__input_kind
    CHECK (input_kind IN ({{INTERACTION_INPUT_KINDS}})),
  CONSTRAINT ck_npc_interactions__response_mode
    CHECK (response_mode IN ({{INTERACTION_RESPONSE_MODES}}))
);

-- Immutable NPC experience. Identity, text, importance, event, and references
-- are append-only; the derived embedding columns are the sole mutable
-- exception and never change what the NPC experienced.
CREATE TABLE public.episodes (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  npc_id UUID NOT NULL,
  event_id UUID NOT NULL,
  episode_kind STRING NOT NULL,
  summary STRING NOT NULL,
  importance INT4 NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  embedding VECTOR(256) NULL,
  embedding_status STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_episodes PRIMARY KEY (town_id, id),
  CONSTRAINT fk_episodes__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_episodes__npc_event_kind
    UNIQUE (town_id, npc_id, event_id, episode_kind),
  CONSTRAINT ck_episodes__episode_kind CHECK (episode_kind IN ({{EPISODE_KINDS}})),
  CONSTRAINT ck_episodes__importance CHECK (importance BETWEEN 0 AND 100),
  CONSTRAINT ck_episodes__embedding_status
    CHECK (embedding_status IN ({{EMBEDDING_STATUSES}})),
  -- An embedding failure never discards the episode; it leaves the vector null
  -- and the status honest, so recall can fall back without widening scope.
  CONSTRAINT ck_episodes__embedding_consistency
    CHECK ((embedding IS NOT NULL) = (embedding_status = 'ready'))
);

-- Structured people, places, items, motives, and claims used by deterministic
-- reranking, so recall does not depend on parsing the summary text.
CREATE TABLE public.episode_references (
  town_id UUID NOT NULL,
  -- A surrogate key rather than a hidden rowid: the schema audit compares the
  -- migrated column set against a declared inventory, and an implicit column
  -- would appear there as an unexplained difference.
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL,
  reference_kind STRING NOT NULL,
  entity_id UUID NULL,
  claim_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_episode_references PRIMARY KEY (town_id, id),
  CONSTRAINT fk_episode_references__episode
    FOREIGN KEY (town_id, episode_id) REFERENCES public.episodes (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_episode_references__entity
    FOREIGN KEY (town_id, entity_id) REFERENCES public.story_entities (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_episode_references__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_episode_references__reference_kind
    CHECK (reference_kind IN ({{EPISODE_REFERENCE_KINDS}})),
  CONSTRAINT ck_episode_references__exactly_one_target
    CHECK ((entity_id IS NULL) <> (claim_id IS NULL)),
  -- The populated column must agree with the declared kind.
  CONSTRAINT ck_episode_references__kind_matches_target
    CHECK ((reference_kind = 'claim') = (claim_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_episode_references__entity
  ON public.episode_references (town_id, episode_id, reference_kind, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE UNIQUE INDEX uq_episode_references__claim
  ON public.episode_references (town_id, episode_id, claim_id)
  WHERE claim_id IS NOT NULL;

-- One actual act of communicating a structured claim, by a player or an NPC.
CREATE TABLE public.claim_transmissions (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  claim_id UUID NOT NULL,
  speaker_actor_id UUID NOT NULL,
  recipient_actor_id UUID NOT NULL,
  recipient_actor_type STRING NOT NULL,
  parent_transmission_id UUID NULL,
  -- `true` exactly when this row may be repeated further. Stored and indexed
  -- so the parent foreign key below can refuse a terminal hop-4 parent.
  parent_eligible BOOL NOT NULL AS (hop_count < 4) STORED,
  parent_is_eligible BOOL NULL,
  root_transmission_id UUID NOT NULL,
  source_episode_id UUID NULL,
  alleged_source_actor_id UUID NULL,
  source_kind STRING NOT NULL,
  hop_count INT4 NOT NULL,
  event_id UUID NOT NULL,
  interaction_id UUID NULL,
  ordinal INT4 NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_claim_transmissions PRIMARY KEY (town_id, id),
  CONSTRAINT fk_claim_transmissions__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_transmissions__speaker
    FOREIGN KEY (town_id, speaker_actor_id) REFERENCES public.actors (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_claim_transmissions__recipient_actor_type
    CHECK (recipient_actor_type IN ({{ACTOR_TYPES}})),
  CONSTRAINT fk_claim_transmissions__recipient
    FOREIGN KEY (town_id, recipient_actor_id, recipient_actor_type)
    REFERENCES public.actors (town_id, id, actor_type) ON DELETE RESTRICT,
  -- A parent must itself be repeatable. Joining through the computed
  -- eligibility flag makes "no hop-4 transmission may become a parent" a
  -- foreign key rather than a rule application code has to remember.
  CONSTRAINT uq_claim_transmissions__parent_eligible
    UNIQUE (town_id, id, parent_eligible),
  CONSTRAINT ck_claim_transmissions__parent_is_eligible
    CHECK (parent_is_eligible IS NULL OR parent_is_eligible),
  CONSTRAINT ck_claim_transmissions__parent_pair
    CHECK ((parent_transmission_id IS NULL) = (parent_is_eligible IS NULL)),
  CONSTRAINT fk_claim_transmissions__parent
    FOREIGN KEY (town_id, parent_transmission_id, parent_is_eligible)
    REFERENCES public.claim_transmissions (town_id, id, parent_eligible)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_transmissions__source_episode
    FOREIGN KEY (town_id, source_episode_id) REFERENCES public.episodes (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_claim_transmissions__alleged_source
    FOREIGN KEY (town_id, alleged_source_actor_id)
    REFERENCES public.actors (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_claim_transmissions__interaction
    FOREIGN KEY (town_id, interaction_id)
    REFERENCES public.npc_interactions (town_id, id) ON DELETE RESTRICT,
  -- Every claim spoken in one turn shares that turn's event and takes a
  -- distinct ordinal, which is how a multi-claim disclosure stays addressable.
  CONSTRAINT uq_claim_transmissions__event_ordinal UNIQUE (town_id, event_id, ordinal),
  CONSTRAINT ck_claim_transmissions__source_kind
    CHECK (source_kind IN ({{TRANSMISSION_SOURCE_KINDS}})),
  CONSTRAINT ck_claim_transmissions__distinct_parties
    CHECK (speaker_actor_id <> recipient_actor_id),
  CONSTRAINT ck_claim_transmissions__ordinal CHECK (ordinal >= 0),
  -- Hop 4 is the terminal player-visible provenance edge: players do not
  -- propagate claims through an ambient hop, so an NPC recipient stops at 3.
  CONSTRAINT ck_claim_transmissions__hop_range CHECK (hop_count BETWEEN 0 AND 4),
  CONSTRAINT ck_claim_transmissions__npc_recipient_hop
    CHECK (recipient_actor_type <> 'npc' OR hop_count <= 3),
  CONSTRAINT ck_claim_transmissions__source_shape CHECK (
    CASE source_kind
      WHEN 'original_assertion' THEN
        parent_transmission_id IS NULL AND source_episode_id IS NULL
        AND hop_count = 0
      WHEN 'direct_observation' THEN
        parent_transmission_id IS NULL AND source_episode_id IS NOT NULL
        AND hop_count = 0
      WHEN 'repeated_testimony' THEN
        parent_transmission_id IS NOT NULL AND source_episode_id IS NULL
        AND hop_count >= 1
      WHEN 'alleged_hearsay' THEN
        parent_transmission_id IS NULL AND source_episode_id IS NULL
        AND alleged_source_actor_id IS NOT NULL AND hop_count >= 1
      ELSE false
    END
  ),
  -- An originating transmission names itself as root; a repeat copies its
  -- parent's root, so independent-source identity is explicit rather than
  -- reconstructed by walking the chain at read time.
  CONSTRAINT ck_claim_transmissions__root
    CHECK ((parent_transmission_id IS NULL) = (root_transmission_id = id))
);
