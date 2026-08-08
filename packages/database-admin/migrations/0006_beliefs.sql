-- Beliefs and relationship ledgers.
--
-- Every score in this schema is a clamped sum of an append-only ledger, never a
-- number someone edited. `npc_beliefs` and `npc_player_relationships` hold the
-- current aggregate for fast reads; `belief_evidence` and
-- `relationship_changes` hold the reasons, permanently. That is what makes the
-- inspection surface able to explain *why* an NPC believes something rather
-- than only reporting that it does.
--
-- Old evidence is never edited. Discrediting a source appends an exact
-- opposite reversal, which is why repeated discrediting cannot subtract the
-- same testimony twice.
--
-- Foreign keys to `world_events` are added by 0009.

CREATE TABLE public.npc_beliefs (
  town_id UUID NOT NULL,
  npc_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  score INT4 NOT NULL,
  label STRING NOT NULL,
  revision INT8 NOT NULL DEFAULT 0,
  updated_event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_npc_beliefs PRIMARY KEY (town_id, npc_id, claim_id),
  CONSTRAINT fk_npc_beliefs__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_npc_beliefs__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_npc_beliefs__score_range CHECK (score BETWEEN -100 AND 100),
  CONSTRAINT ck_npc_beliefs__label CHECK (label IN ({{BELIEF_LABELS}})),
  CONSTRAINT ck_npc_beliefs__revision CHECK (revision >= 0),
  -- The label is derived from the score, so a row cannot claim to be
  -- `convinced` while holding a score that says otherwise.
  CONSTRAINT ck_npc_beliefs__label_matches_score CHECK (
    CASE
      WHEN score >= 60 THEN label = 'convinced'
      WHEN score >= 20 THEN label = 'leaning'
      ELSE label = 'doubtful'
    END
  )
);

-- One contribution to one belief, with everything needed to explain it.
CREATE TABLE public.belief_evidence (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  npc_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  event_id UUID NOT NULL,
  episode_id UUID NULL,
  transmission_id UUID NULL,
  source_root_transmission_id UUID NULL,
  independent_source_actor_id UUID NULL,
  corroboration_threshold INT4 NULL,
  clue_id UUID NULL,
  evidence_kind STRING NOT NULL,
  signed_weight INT4 NOT NULL,
  trust_snapshot INT4 NULL,
  hop_count INT4 NULL,
  mirrors_evidence_id UUID NULL,
  reverses_evidence_id UUID NULL,
  rule_version STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_belief_evidence PRIMARY KEY (town_id, id),
  CONSTRAINT fk_belief_evidence__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__episode
    FOREIGN KEY (town_id, episode_id) REFERENCES public.episodes (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__transmission
    FOREIGN KEY (town_id, transmission_id)
    REFERENCES public.claim_transmissions (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__source_root
    FOREIGN KEY (town_id, source_root_transmission_id)
    REFERENCES public.claim_transmissions (town_id, id) ON DELETE RESTRICT,
  -- The actor who originated the root transmission. Source independence is
  -- about who first said it, not which transmission row carried it.
  CONSTRAINT fk_belief_evidence__independent_source
    FOREIGN KEY (town_id, independent_source_actor_id)
    REFERENCES public.actors (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__clue
    FOREIGN KEY (town_id, clue_id) REFERENCES public.clues (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__mirrors
    FOREIGN KEY (town_id, mirrors_evidence_id)
    REFERENCES public.belief_evidence (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_belief_evidence__reverses
    FOREIGN KEY (town_id, reverses_evidence_id)
    REFERENCES public.belief_evidence (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_belief_evidence__evidence_kind
    CHECK (evidence_kind IN ({{EVIDENCE_KINDS}})),
  CONSTRAINT ck_belief_evidence__weight_range
    CHECK (signed_weight BETWEEN -100 AND 100),
  CONSTRAINT ck_belief_evidence__trust_snapshot_range
    CHECK (trust_snapshot IS NULL OR trust_snapshot BETWEEN -100 AND 100),
  CONSTRAINT ck_belief_evidence__hop_range
    CHECK (hop_count IS NULL OR hop_count BETWEEN 0 AND 4),
  CONSTRAINT ck_belief_evidence__corroboration_threshold
    CHECK (corroboration_threshold IS NULL OR corroboration_threshold IN (2, 3)),
  -- Each evidence kind carries exactly the references that explain it. A
  -- testimony row without its root transmission could not be deduplicated by
  -- source, and a mirror without its primary could be created twice.
  CONSTRAINT ck_belief_evidence__shape CHECK (
    CASE evidence_kind
      WHEN 'direct_observation' THEN
        episode_id IS NOT NULL AND transmission_id IS NULL AND clue_id IS NULL
        AND mirrors_evidence_id IS NULL AND reverses_evidence_id IS NULL
        AND corroboration_threshold IS NULL
      WHEN 'player_testimony' THEN
        transmission_id IS NOT NULL AND source_root_transmission_id IS NOT NULL
        AND independent_source_actor_id IS NOT NULL AND trust_snapshot IS NOT NULL
        AND hop_count IS NOT NULL AND clue_id IS NULL
        AND mirrors_evidence_id IS NULL AND reverses_evidence_id IS NULL
        AND corroboration_threshold IS NULL
      WHEN 'npc_testimony' THEN
        transmission_id IS NOT NULL AND source_root_transmission_id IS NOT NULL
        AND independent_source_actor_id IS NOT NULL AND trust_snapshot IS NOT NULL
        AND hop_count IS NOT NULL AND clue_id IS NULL
        AND mirrors_evidence_id IS NULL AND reverses_evidence_id IS NULL
        AND corroboration_threshold IS NULL
      WHEN 'physical_clue' THEN
        clue_id IS NOT NULL AND transmission_id IS NULL AND episode_id IS NULL
        AND mirrors_evidence_id IS NULL AND reverses_evidence_id IS NULL
        AND corroboration_threshold IS NULL
      WHEN 'corroboration' THEN
        corroboration_threshold IS NOT NULL
        AND independent_source_actor_id IS NOT NULL
        AND clue_id IS NULL AND mirrors_evidence_id IS NULL
        AND reverses_evidence_id IS NULL
      WHEN 'contradiction' THEN
        ((clue_id IS NULL) <> (mirrors_evidence_id IS NULL))
        AND reverses_evidence_id IS NULL AND corroboration_threshold IS NULL
      WHEN 'source_reversal' THEN
        reverses_evidence_id IS NOT NULL AND mirrors_evidence_id IS NULL
        AND corroboration_threshold IS NULL
      ELSE false
    END
  )
);

-- One evidence row can be reversed at most once, so discrediting a source
-- repeatedly cannot subtract the same contribution twice.
CREATE UNIQUE INDEX uq_belief_evidence__reverses
  ON public.belief_evidence (town_id, reverses_evidence_id)
  WHERE reverses_evidence_id IS NOT NULL;

CREATE TABLE public.npc_player_relationships (
  town_id UUID NOT NULL,
  npc_id UUID NOT NULL,
  player_id UUID NOT NULL,
  trust_score INT4 NOT NULL DEFAULT 0,
  suspicion_score INT4 NOT NULL DEFAULT 0,
  revision INT8 NOT NULL DEFAULT 0,
  updated_event_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_npc_player_relationships PRIMARY KEY (town_id, npc_id, player_id),
  CONSTRAINT fk_npc_player_relationships__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_npc_player_relationships__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_npc_player_relationships__trust_range
    CHECK (trust_score BETWEEN -100 AND 100),
  CONSTRAINT ck_npc_player_relationships__suspicion_range
    CHECK (suspicion_score BETWEEN -100 AND 100),
  CONSTRAINT ck_npc_player_relationships__revision CHECK (revision >= 0)
);

-- Append-only relationship history. A zero-delta event creates no row, so the
-- timeline shows only what actually changed.
CREATE TABLE public.relationship_changes (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  npc_id UUID NOT NULL,
  player_id UUID NOT NULL,
  event_id UUID NOT NULL,
  trust_delta INT4 NOT NULL,
  suspicion_delta INT4 NOT NULL,
  reason_kind STRING NOT NULL,
  claim_id UUID NULL,
  clue_id UUID NULL,
  item_id UUID NULL,
  promise_id UUID NULL,
  source_root_transmission_id UUID NULL,
  rule_version STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_relationship_changes PRIMARY KEY (town_id, id),
  CONSTRAINT fk_relationship_changes__npc
    FOREIGN KEY (town_id, npc_id) REFERENCES public.npcs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_changes__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_changes__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_changes__clue
    FOREIGN KEY (town_id, clue_id) REFERENCES public.clues (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_changes__item
    FOREIGN KEY (town_id, item_id) REFERENCES public.items (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_changes__source_root
    FOREIGN KEY (town_id, source_root_transmission_id)
    REFERENCES public.claim_transmissions (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_relationship_changes__reason_kind
    CHECK (reason_kind IN ({{RELATIONSHIP_REASON_KINDS}})),
  CONSTRAINT ck_relationship_changes__delta_range CHECK (
    trust_delta BETWEEN -200 AND 200 AND suspicion_delta BETWEEN -200 AND 200
  ),
  CONSTRAINT ck_relationship_changes__non_zero
    CHECK (trust_delta <> 0 OR suspicion_delta <> 0),
  -- Each reason binds to the evidence that justifies it. `lie_established`
  -- needs both the claim and the root transmission, because a caught lie is a
  -- statement about who knowingly said what.
  CONSTRAINT ck_relationship_changes__shape CHECK (
    CASE reason_kind
      WHEN 'verified_testimony' THEN
        claim_id IS NOT NULL AND clue_id IS NOT NULL
        AND source_root_transmission_id IS NOT NULL
        AND item_id IS NULL AND promise_id IS NULL
      WHEN 'evidence_presented' THEN
        clue_id IS NOT NULL AND item_id IS NULL AND promise_id IS NULL
      WHEN 'requested_item_given' THEN
        item_id IS NOT NULL AND claim_id IS NULL AND clue_id IS NULL
        AND promise_id IS NULL
      WHEN 'promise_fulfilled' THEN
        promise_id IS NOT NULL AND claim_id IS NULL AND clue_id IS NULL
        AND item_id IS NULL
      WHEN 'promise_broken' THEN
        promise_id IS NOT NULL AND claim_id IS NULL AND clue_id IS NULL
        AND item_id IS NULL
      WHEN 'lie_established' THEN
        claim_id IS NOT NULL AND source_root_transmission_id IS NOT NULL
        AND item_id IS NULL AND promise_id IS NULL
      ELSE false
    END
  )
);
