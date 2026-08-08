-- Authored truth, physical evidence, and current item state.
--
-- This is where objective reality lives. `world_facts` and `case_solutions`
-- record what is actually true, `items` records where things actually are, and
-- none of it is ever sent wholesale to a model or a player. Claims elsewhere in
-- the schema stay truth-neutral precisely because truth is kept here.
--
-- Physical evidence is authored as clues attached to inspectables, with signed
-- claim effects. That is what makes the mystery solvable without any
-- model-selected line of dialogue: the deterministic path exists in data.
--
-- Foreign keys to `world_events` are added by 0009.

-- Immutable authored propositions known to be objectively true.
CREATE TABLE public.world_facts (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  fact_key STRING NOT NULL,
  claim_id UUID NOT NULL,
  visibility STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_world_facts PRIMARY KEY (town_id, id),
  CONSTRAINT fk_world_facts__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_world_facts__fact_key UNIQUE (town_id, fact_key),
  -- One fact per claim: truth is not asserted twice about one proposition.
  CONSTRAINT uq_world_facts__claim UNIQUE (town_id, claim_id),
  CONSTRAINT ck_world_facts__visibility
    CHECK (visibility IN ({{WORLD_FACT_VISIBILITIES}}))
);

-- Exactly one private answer per town: `town_id` is the primary key, so a
-- second solution is unrepresentable rather than merely unexpected.
CREATE TABLE public.case_solutions (
  town_id UUID NOT NULL,
  culprit_entity_id UUID NOT NULL,
  culprit_entity_type STRING NOT NULL DEFAULT 'character',
  motive_entity_id UUID NOT NULL,
  motive_entity_type STRING NOT NULL DEFAULT 'motive',
  location_entity_id UUID NOT NULL,
  location_entity_type STRING NOT NULL DEFAULT 'location',
  required_item_id UUID NOT NULL,
  required_item_entity_type STRING NOT NULL DEFAULT 'item',
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_case_solutions PRIMARY KEY (town_id),
  CONSTRAINT ck_case_solutions__culprit_entity_type
    CHECK (culprit_entity_type = 'character'),
  CONSTRAINT ck_case_solutions__motive_entity_type
    CHECK (motive_entity_type = 'motive'),
  CONSTRAINT ck_case_solutions__location_entity_type
    CHECK (location_entity_type = 'location'),
  CONSTRAINT ck_case_solutions__required_item_entity_type
    CHECK (required_item_entity_type = 'item'),
  CONSTRAINT fk_case_solutions__culprit
    FOREIGN KEY (town_id, culprit_entity_id, culprit_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_case_solutions__motive
    FOREIGN KEY (town_id, motive_entity_id, motive_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_case_solutions__location
    FOREIGN KEY (town_id, location_entity_id, location_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_case_solutions__required_item
    FOREIGN KEY (town_id, required_item_id, required_item_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT
);

-- Current custody of a unique item. The item's own row is authoritative: when a
-- linked inspectable's item moves, the inspectable becomes available only at
-- the new custody location rather than the two disagreeing.
CREATE TABLE public.items (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  entity_type STRING NOT NULL DEFAULT 'item',
  location_entity_id UUID NULL,
  location_entity_type STRING NULL,
  held_by_actor_id UUID NULL,
  portable BOOL NOT NULL,
  revision INT8 NOT NULL DEFAULT 0,
  revealed_event_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_items PRIMARY KEY (town_id, id),
  CONSTRAINT ck_items__entity_type CHECK (entity_type = 'item'),
  -- An item *is* a story entity; its ID is that entity's ID.
  CONSTRAINT fk_items__entity
    FOREIGN KEY (town_id, id, entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT ck_items__location_entity_type
    CHECK (location_entity_type IS NULL OR location_entity_type = 'location'),
  CONSTRAINT fk_items__location
    FOREIGN KEY (town_id, location_entity_id, location_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_items__holder
    FOREIGN KEY (town_id, held_by_actor_id) REFERENCES public.actors (town_id, id)
    ON DELETE RESTRICT,
  -- Exactly one custodian. Two concurrent transfers cannot both succeed
  -- because each is a conditional update against `revision`.
  CONSTRAINT ck_items__exactly_one_custodian
    CHECK ((location_entity_id IS NULL) <> (held_by_actor_id IS NULL)),
  CONSTRAINT ck_items__location_pair
    CHECK ((location_entity_id IS NULL) = (location_entity_type IS NULL)),
  CONSTRAINT ck_items__revision CHECK (revision >= 0)
);

-- Authored areas and objects that accept Inspect.
CREATE TABLE public.inspectables (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  inspectable_key STRING NOT NULL,
  location_entity_id UUID NOT NULL,
  location_entity_type STRING NOT NULL DEFAULT 'location',
  linked_entity_id UUID NULL,
  linked_entity_type STRING NULL,
  display_name STRING NOT NULL,
  content_key STRING NOT NULL,
  gate_key STRING NULL,
  enabled BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_inspectables PRIMARY KEY (town_id, id),
  CONSTRAINT uq_inspectables__inspectable_key UNIQUE (town_id, inspectable_key),
  CONSTRAINT ck_inspectables__location_entity_type
    CHECK (location_entity_type = 'location'),
  CONSTRAINT fk_inspectables__location
    FOREIGN KEY (town_id, location_entity_id, location_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  -- Fixed scenery has no linked entity; a linked one is always an item.
  CONSTRAINT ck_inspectables__linked_entity_type
    CHECK (linked_entity_type IS NULL OR linked_entity_type = 'item'),
  CONSTRAINT ck_inspectables__linked_pair
    CHECK ((linked_entity_id IS NULL) = (linked_entity_type IS NULL)),
  CONSTRAINT fk_inspectables__linked_item
    FOREIGN KEY (town_id, linked_entity_id, linked_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT
);

-- Persistent authored permissions such as `enter_old_chapel`. Access that stays
-- purely derived from an item or relationship creates no row here.
CREATE TABLE public.player_capabilities (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_id UUID NOT NULL,
  capability_key STRING NOT NULL,
  status STRING NOT NULL,
  granted_event_id UUID NOT NULL,
  revoked_event_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_player_capabilities PRIMARY KEY (town_id, id),
  CONSTRAINT fk_player_capabilities__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_player_capabilities__player_key
    UNIQUE (town_id, player_id, capability_key),
  CONSTRAINT ck_player_capabilities__status
    CHECK (status IN ({{CAPABILITY_STATUSES}})),
  -- Capabilities move from granted to revoked only, so the revoking event is
  -- present exactly when the row is revoked.
  CONSTRAINT ck_player_capabilities__revocation
    CHECK ((status = 'revoked') = (revoked_event_id IS NOT NULL))
);

-- Authored verified evidence revealed by inspection.
CREATE TABLE public.clues (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  clue_key STRING NOT NULL,
  inspectable_id UUID NOT NULL,
  clue_kind STRING NOT NULL,
  content_key STRING NOT NULL,
  required_for_resolution BOOL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_clues PRIMARY KEY (town_id, id),
  CONSTRAINT uq_clues__clue_key UNIQUE (town_id, clue_key),
  CONSTRAINT fk_clues__inspectable
    FOREIGN KEY (town_id, inspectable_id) REFERENCES public.inspectables (town_id, id)
    ON DELETE RESTRICT,
  -- Clue kind controls presentation only; the signed effects below remain
  -- authoritative for what a clue actually establishes.
  CONSTRAINT ck_clues__clue_kind CHECK (clue_kind IN ({{CLUE_KINDS}}))
);

CREATE TABLE public.clue_claim_effects (
  town_id UUID NOT NULL,
  clue_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  effect_kind STRING NOT NULL,
  signed_weight INT4 NOT NULL,
  rule_version STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_clue_claim_effects PRIMARY KEY (town_id, clue_id, claim_id),
  CONSTRAINT fk_clue_claim_effects__clue
    FOREIGN KEY (town_id, clue_id) REFERENCES public.clues (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_clue_claim_effects__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_clue_claim_effects__effect_kind
    CHECK (effect_kind IN ({{CLUE_EFFECT_KINDS}})),
  CONSTRAINT ck_clue_claim_effects__weight_range
    CHECK (signed_weight BETWEEN -100 AND 100 AND signed_weight <> 0),
  -- The sign is not decorative: a `supports` edge that stored a negative weight
  -- would invert a belief while reading as support in inspection.
  CONSTRAINT ck_clue_claim_effects__sign_matches_kind
    CHECK ((effect_kind = 'supports') = (signed_weight > 0))
);

-- Append-only attribution that a player found a clue. Repeated inspection by
-- the same player creates no row, so contribution history is not spam.
CREATE TABLE public.clue_discoveries (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  clue_id UUID NOT NULL,
  player_id UUID NOT NULL,
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_clue_discoveries PRIMARY KEY (town_id, id),
  CONSTRAINT fk_clue_discoveries__clue
    FOREIGN KEY (town_id, clue_id) REFERENCES public.clues (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_clue_discoveries__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_clue_discoveries__clue_player UNIQUE (town_id, clue_id, player_id)
);
