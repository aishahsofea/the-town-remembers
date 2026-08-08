-- Promises, the shared case board, accusations, and the one irreversible
-- ending.
--
-- Everything here is either irreversible or append-only, which is the point. A
-- promise that has been broken cannot quietly become active again, a submitted
-- accusation stays in contribution history whether or not it was right, and a
-- town resolves exactly once because `town_id` is the resolution's primary key.
--
-- Foreign keys to `world_events`, `player_actions`, and `case_attempts` are
-- added by 0009.

CREATE TABLE public.promises (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  npc_id UUID NOT NULL,
  player_id UUID NOT NULL,
  kind STRING NOT NULL,
  protected_claim_id UUID NULL,
  item_id UUID NULL,
  status STRING NOT NULL,
  accepted_event_id UUID NOT NULL,
  resolved_event_id UUID NULL,
  terms_version STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_promises PRIMARY KEY (town_id, id),
  CONSTRAINT fk_promises__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_promises__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_promises__protected_claim
    FOREIGN KEY (town_id, protected_claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_promises__item
    FOREIGN KEY (town_id, item_id) REFERENCES public.items (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_promises__kind CHECK (kind IN ({{PROMISE_KINDS}})),
  CONSTRAINT ck_promises__status CHECK (status IN ({{PROMISE_STATUSES}})),
  -- The subject is exactly one thing and it must match the kind, so a
  -- keep-secret promise cannot be resolved by returning an item.
  CONSTRAINT ck_promises__subject_matches_kind CHECK (
    CASE kind
      WHEN 'keep_secret' THEN protected_claim_id IS NOT NULL AND item_id IS NULL
      WHEN 'return_item' THEN item_id IS NOT NULL AND protected_claim_id IS NULL
      ELSE false
    END
  ),
  -- Transitions are active -> fulfilled or active -> broken, and irreversible;
  -- the resolving event is present exactly when the promise is no longer active.
  CONSTRAINT ck_promises__resolution
    CHECK ((status <> 'active') = (resolved_event_id IS NOT NULL))
);

-- At most one active promise per NPC, player, and subject. Two live copies of
-- the same obligation would make "broken" ambiguous.
CREATE UNIQUE INDEX uq_promises__active_secret
  ON public.promises (town_id, npc_id, player_id, protected_claim_id)
  WHERE status = 'active' AND kind = 'keep_secret';

CREATE UNIQUE INDEX uq_promises__active_item
  ON public.promises (town_id, npc_id, player_id, item_id)
  WHERE status = 'active' AND kind = 'return_item';

-- The shared, player-contributed board. Every entry names a contributor; there
-- is no anonymous or system-authored variant.
CREATE TABLE public.case_board_entries (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  entry_kind STRING NOT NULL,
  contributed_by_player_id UUID NOT NULL,
  source_event_id UUID NOT NULL,
  clue_id UUID NULL,
  claim_id UUID NULL,
  transmission_id UUID NULL,
  note_text STRING NULL,
  verification_status STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_case_board_entries PRIMARY KEY (town_id, id),
  CONSTRAINT fk_case_board_entries__player
    FOREIGN KEY (town_id, contributed_by_player_id)
    REFERENCES public.players (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_case_board_entries__clue
    FOREIGN KEY (town_id, clue_id) REFERENCES public.clues (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_case_board_entries__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_case_board_entries__transmission
    FOREIGN KEY (town_id, transmission_id)
    REFERENCES public.claim_transmissions (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_case_board_entries__entry_kind
    CHECK (entry_kind IN ({{BOARD_ENTRY_KINDS}})),
  CONSTRAINT ck_case_board_entries__verification_status
    CHECK (verification_status IN ({{BOARD_VERIFICATION_STATUSES}})),
  -- Classification is derived from the displayed transmission, so the stored
  -- pair must agree rather than being two independently settable labels.
  CONSTRAINT ck_case_board_entries__status_matches_kind CHECK (
    CASE entry_kind
      WHEN 'verified_evidence' THEN verification_status = 'verified_physical'
      WHEN 'testimony' THEN verification_status = 'attributed_testimony'
      WHEN 'hearsay' THEN verification_status = 'attributed_hearsay'
      WHEN 'note' THEN verification_status = 'unverified_player_note'
      ELSE false
    END
  ),
  CONSTRAINT ck_case_board_entries__shape CHECK (
    CASE entry_kind
      WHEN 'verified_evidence' THEN
        clue_id IS NOT NULL AND claim_id IS NULL AND transmission_id IS NULL
        AND note_text IS NULL
      WHEN 'testimony' THEN
        claim_id IS NOT NULL AND transmission_id IS NOT NULL AND clue_id IS NULL
        AND note_text IS NULL
      WHEN 'hearsay' THEN
        claim_id IS NOT NULL AND transmission_id IS NOT NULL AND clue_id IS NULL
        AND note_text IS NULL
      WHEN 'note' THEN
        note_text IS NOT NULL AND clue_id IS NULL AND claim_id IS NULL
        AND transmission_id IS NULL
      ELSE false
    END
  ),
  -- The accepted bound is 1–280 grapheme clusters, which SQL cannot count. The
  -- write boundary enforces it with Intl.Segmenter; this byte bound is only a
  -- backstop against an absurd value reaching storage.
  CONSTRAINT ck_case_board_entries__note_length
    CHECK (note_text IS NULL
           OR (length(note_text) >= 1 AND octet_length(note_text) <= 1120))
);

-- One shared entry per clue, and one per displayed transmission. Notes are
-- append-only and deliberately unconstrained by these.
CREATE UNIQUE INDEX uq_case_board_entries__clue
  ON public.case_board_entries (town_id, clue_id)
  WHERE clue_id IS NOT NULL;

CREATE UNIQUE INDEX uq_case_board_entries__transmission
  ON public.case_board_entries (town_id, transmission_id)
  WHERE transmission_id IS NOT NULL;

-- Immutable submitted theory. An incorrect attempt does not close the town; it
-- stays visible in contribution history.
CREATE TABLE public.case_attempts (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_action_id UUID NOT NULL,
  player_id UUID NOT NULL,
  suspect_entity_id UUID NOT NULL,
  suspect_entity_type STRING NOT NULL DEFAULT 'character',
  motive_entity_id UUID NOT NULL,
  motive_entity_type STRING NOT NULL DEFAULT 'motive',
  location_entity_id UUID NOT NULL,
  location_entity_type STRING NOT NULL DEFAULT 'location',
  outcome STRING NOT NULL,
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_case_attempts PRIMARY KEY (town_id, id),
  CONSTRAINT uq_case_attempts__player_action UNIQUE (town_id, player_action_id),
  CONSTRAINT fk_case_attempts__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_case_attempts__suspect_entity_type
    CHECK (suspect_entity_type = 'character'),
  CONSTRAINT ck_case_attempts__motive_entity_type
    CHECK (motive_entity_type = 'motive'),
  CONSTRAINT ck_case_attempts__location_entity_type
    CHECK (location_entity_type = 'location'),
  CONSTRAINT fk_case_attempts__suspect
    FOREIGN KEY (town_id, suspect_entity_id, suspect_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_case_attempts__motive
    FOREIGN KEY (town_id, motive_entity_id, motive_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT fk_case_attempts__location
    FOREIGN KEY (town_id, location_entity_id, location_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  -- The outcome is a server comparison against the private solution, never a
  -- model judgment.
  CONSTRAINT ck_case_attempts__outcome CHECK (outcome IN ({{CASE_ATTEMPT_OUTCOMES}}))
);

-- The one irreversible shared ending.
CREATE TABLE public.town_resolutions (
  town_id UUID NOT NULL,
  case_attempt_id UUID NOT NULL,
  chosen_by_player_id UUID NOT NULL,
  choice STRING NOT NULL,
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_town_resolutions PRIMARY KEY (town_id),
  CONSTRAINT fk_town_resolutions__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  CONSTRAINT fk_town_resolutions__attempt
    FOREIGN KEY (town_id, case_attempt_id)
    REFERENCES public.case_attempts (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_town_resolutions__player
    FOREIGN KEY (town_id, chosen_by_player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_town_resolutions__choice CHECK (choice IN ({{RESOLUTION_CHOICES}}))
);
