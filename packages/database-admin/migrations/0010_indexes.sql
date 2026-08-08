-- Required indexes.
--
-- Primary keys and unique constraints already cover most accepted lookups, so
-- this file adds only what they do not. Two kinds appear here.
--
-- Access indexes serve a named query: a cleanup sweep, a cookie lookup, a
-- timeline read. Each one exists because some path would otherwise scan.
--
-- Partial unique indexes are repeat protection. They are the reason one clue
-- cannot be applied to one NPC's belief twice, one source cannot contribute
-- testimony weight twice, and one promise cannot pay out twice. Losing one of
-- them would not slow the system down; it would let a player farm trust.

-- Stale-work sweeps look for expired processing claims, so the predicate is the
-- claim state rather than the whole table.
CREATE INDEX ix_town_creation_requests__stale
  ON public.town_creation_requests (processing_expires_at)
  WHERE status = 'processing';

CREATE INDEX ix_join_requests__player
  ON public.join_requests (town_id, player_id);

-- Recovery closes join replay windows that are still open. A request whose
-- secret is already cleared or whose bootstrap is confirmed is not open.
CREATE INDEX ix_join_requests__open_replay
  ON public.join_requests (replay_expires_at)
  WHERE join_secret_hash IS NOT NULL AND bootstrap_confirmed_at IS NULL;

CREATE INDEX ix_player_sessions__player_status
  ON public.player_sessions (town_id, player_id, status);

-- Bootstrap confirmation reaches the join request through the session.
CREATE INDEX ix_player_sessions__join_request
  ON public.player_sessions (town_id, join_request_id);

-- Expired buckets may be pruned after 24 hours; this is the only routine
-- delete in the schema.
CREATE INDEX ix_api_rate_limits__pruning ON public.api_rate_limits (updated_at);

CREATE INDEX ix_world_events__type_time
  ON public.world_events (town_id, event_type, occurred_at DESC);

CREATE INDEX ix_claim_transmissions__claim_time
  ON public.claim_transmissions (town_id, claim_id, created_at);

-- Walking a provenance chain downward, for inspection and for repeat detection.
CREATE INDEX ix_claim_transmissions__parent
  ON public.claim_transmissions (town_id, parent_transmission_id);

CREATE INDEX ix_belief_evidence__belief_time
  ON public.belief_evidence (town_id, npc_id, claim_id, created_at);

-- One originating actor contributes testimony weight to one claim once, no
-- matter how many transmissions descend from them.
CREATE UNIQUE INDEX uq_belief_evidence__testimony_source
  ON public.belief_evidence (town_id, npc_id, claim_id, independent_source_actor_id)
  WHERE evidence_kind IN ('player_testimony', 'npc_testimony');

-- Each corroboration threshold is crossed at most once per causal event.
CREATE UNIQUE INDEX uq_belief_evidence__corroboration
  ON public.belief_evidence (
    town_id, event_id, npc_id, claim_id, corroboration_threshold
  )
  WHERE evidence_kind = 'corroboration';

-- One discovered clue applies to one NPC's belief once. This also coalesces an
-- explicit `contradicts` edge with the mirror derived from the same clue, which
-- would otherwise double the negative weight.
CREATE UNIQUE INDEX uq_belief_evidence__clue_effect
  ON public.belief_evidence (town_id, npc_id, claim_id, clue_id)
  WHERE evidence_kind IN ('physical_clue', 'contradiction') AND clue_id IS NOT NULL;

-- A mirror is unique for its NPC, target claim, and primary evidence row, so
-- backfilling a newly created relation cannot duplicate an existing mirror.
CREATE UNIQUE INDEX uq_belief_evidence__mirror
  ON public.belief_evidence (town_id, npc_id, claim_id, mirrors_evidence_id)
  WHERE evidence_kind = 'contradiction' AND mirrors_evidence_id IS NOT NULL;

CREATE INDEX ix_relationship_changes__timeline
  ON public.relationship_changes (town_id, npc_id, player_id, created_at);

-- Relationship rewards fire once per triggering subject. Without these a player
-- could re-present the same clue, or re-give the same item, for unlimited trust.
CREATE UNIQUE INDEX uq_relationship_changes__claim_trigger
  ON public.relationship_changes (town_id, npc_id, player_id, reason_kind, claim_id)
  WHERE reason_kind IN ('verified_testimony', 'lie_established');

CREATE UNIQUE INDEX uq_relationship_changes__clue_trigger
  ON public.relationship_changes (town_id, npc_id, player_id, reason_kind, clue_id)
  WHERE reason_kind = 'evidence_presented';

CREATE UNIQUE INDEX uq_relationship_changes__item_trigger
  ON public.relationship_changes (town_id, npc_id, player_id, reason_kind, item_id)
  WHERE reason_kind = 'requested_item_given';

-- A promise pays out or costs once, whichever it ends up being.
CREATE UNIQUE INDEX uq_relationship_changes__promise_trigger
  ON public.relationship_changes (town_id, promise_id, reason_kind)
  WHERE reason_kind IN ('promise_fulfilled', 'promise_broken');

CREATE INDEX ix_case_board_entries__timeline
  ON public.case_board_entries (town_id, created_at);

CREATE INDEX ix_player_actions__stale
  ON public.player_actions (processing_expires_at)
  WHERE status = 'processing';

CREATE INDEX ix_player_actions__retryable
  ON public.player_actions (retry_after_at)
  WHERE status = 'retryable';

-- Monthly admission sums settled cost plus outstanding reservations, so the
-- billing month and status lead.
CREATE INDEX ix_model_cost_reservations__month_status
  ON public.model_cost_reservations (billing_month, status);

-- One attempt reserves once. Retrying an admission step that already committed
-- must not reserve a second maximum against the monthly ceiling.
CREATE UNIQUE INDEX uq_model_cost_reservations__player_action
  ON public.model_cost_reservations (player_action_id, purpose, attempt_ordinal)
  WHERE player_action_id IS NOT NULL;

CREATE UNIQUE INDEX uq_model_cost_reservations__ambient_execution
  ON public.model_cost_reservations (
    ambient_job_execution_id, purpose, attempt_ordinal
  )
  WHERE ambient_job_execution_id IS NOT NULL;

CREATE UNIQUE INDEX uq_model_cost_reservations__world_event
  ON public.model_cost_reservations (world_event_id, purpose, attempt_ordinal)
  WHERE world_event_id IS NOT NULL;

CREATE UNIQUE INDEX uq_model_cost_reservations__non_game_operation
  ON public.model_cost_reservations (non_game_operation_key, purpose, attempt_ordinal)
  WHERE non_game_operation_key IS NOT NULL;

-- Recovery publishes due rows and terminalizes overdue transitions in one scan.
CREATE INDEX ix_outbox__delivery
  ON public.outbox (
    town_id, delivery_status, next_send_at, send_expires_at, transition_deadline_at
  );

CREATE INDEX ix_ambient_job_executions__stale
  ON public.ambient_job_executions (status, processing_expires_at)
  WHERE status = 'processing';
