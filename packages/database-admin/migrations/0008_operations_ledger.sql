-- Player actions, the world-event ledger, model runs, cost admission, and the
-- ambient handoff.
--
-- `world_events` is the stable effect ledger everything else points at. One
-- action or ambient job may produce several numbered events, so downstream
-- records reference an event instead of each carrying a duplicate idempotency
-- key. Its `effect_key` is what makes a redelivered job unable to apply twice.
--
-- `model_cost_reservations` is the one deliberately global table: a monthly
-- spend ceiling cannot be enforced per town. Only the cost-admission service
-- may read it across towns.

CREATE TABLE public.player_actions (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_id UUID NOT NULL,
  visit_id UUID NULL,
  idempotency_key UUID NOT NULL,
  action_kind STRING NOT NULL,
  request_hash BYTES NOT NULL,
  request_payload JSONB NOT NULL,
  target_actor_id UUID NULL,
  target_entity_id UUID NULL,
  status STRING NOT NULL,
  processing_token UUID NULL,
  processing_expires_at TIMESTAMPTZ NULL,
  attempt_count INT4 NOT NULL DEFAULT 0,
  outcome STRING NULL,
  response_status INT4 NULL,
  response_payload JSONB NULL,
  error_code STRING NULL,
  retry_after_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,

  CONSTRAINT pk_player_actions PRIMARY KEY (town_id, id),
  CONSTRAINT uq_player_actions__idempotency_key
    UNIQUE (town_id, player_id, idempotency_key),
  CONSTRAINT fk_player_actions__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_player_actions__visit
    FOREIGN KEY (town_id, visit_id) REFERENCES public.player_visits (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_player_actions__target_actor
    FOREIGN KEY (town_id, target_actor_id) REFERENCES public.actors (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_player_actions__target_entity
    FOREIGN KEY (town_id, target_entity_id)
    REFERENCES public.story_entities (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_player_actions__action_kind CHECK (action_kind IN ({{ACTION_KINDS}})),
  CONSTRAINT ck_player_actions__status CHECK (status IN ({{ACTION_STATUSES}})),
  CONSTRAINT ck_player_actions__outcome
    CHECK (outcome IS NULL OR outcome IN ({{ACTION_OUTCOMES}})),
  CONSTRAINT ck_player_actions__request_hash_length CHECK (length(request_hash) = 32),
  CONSTRAINT ck_player_actions__attempt_count CHECK (attempt_count >= 0),
  -- The processing claim exists only while processing. Completion still
  -- requires the current token, so a worker whose claim was replaced cannot
  -- commit even if it is still running.
  CONSTRAINT ck_player_actions__claim CHECK (
    CASE status
      WHEN 'processing' THEN
        processing_token IS NOT NULL AND processing_expires_at IS NOT NULL
      ELSE processing_token IS NULL AND processing_expires_at IS NULL
    END
  ),
  -- `retryable` is reserved for a second relevant revision conflict: it stores
  -- the saved 409 and a retry time, and deliberately no outcome, because
  -- nothing was applied.
  CONSTRAINT ck_player_actions__state_fields CHECK (
    CASE status
      WHEN 'processing' THEN
        outcome IS NULL AND response_status IS NULL AND response_payload IS NULL
        AND error_code IS NULL AND retry_after_at IS NULL AND completed_at IS NULL
      WHEN 'retryable' THEN
        outcome IS NULL AND response_status = 409
        AND error_code = 'ACTION_CONFLICT' AND response_payload IS NOT NULL
        AND retry_after_at IS NOT NULL AND completed_at IS NULL
      WHEN 'completed' THEN
        outcome IS NOT NULL AND response_status IS NOT NULL
        AND response_payload IS NOT NULL AND retry_after_at IS NULL
        AND completed_at IS NOT NULL
      WHEN 'failed' THEN
        outcome IS NULL AND response_status IS NOT NULL
        AND response_payload IS NOT NULL AND error_code IS NOT NULL
        AND retry_after_at IS NULL AND completed_at IS NOT NULL
      ELSE false
    END
  )
);

-- One processing action per player. A different action arriving while this
-- exists is rejected before any record is created.
CREATE UNIQUE INDEX uq_player_actions__one_processing
  ON public.player_actions (town_id, player_id)
  WHERE status = 'processing';

-- The stable effect ledger. Append-only, sequenced, and the anchor for every
-- causal reference in the schema.
CREATE TABLE public.world_events (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  sequence_no INT8 NOT NULL,
  event_type STRING NOT NULL,
  ambient_eligible BOOL NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  origin_kind STRING NOT NULL,
  player_action_id UUID NULL,
  ambient_job_execution_id UUID NULL,
  effect_index INT4 NOT NULL,
  effect_key STRING NOT NULL,
  actor_id UUID NULL,
  target_actor_id UUID NULL,
  subject_entity_id UUID NULL,
  location_entity_id UUID NULL,
  claim_id UUID NULL,
  clue_id UUID NULL,
  promise_id UUID NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_world_events PRIMARY KEY (town_id, id),
  CONSTRAINT uq_world_events__sequence UNIQUE (town_id, sequence_no),
  -- Derived as `player:<action-key>:<index>`, `ambient:<job-key>:<index>`, or
  -- `seed:<content-version>:<key>`. Uniqueness is what makes a redelivered job
  -- a no-op rather than a second set of effects.
  CONSTRAINT uq_world_events__effect_key UNIQUE (town_id, effect_key),
  CONSTRAINT fk_world_events__player_action
    FOREIGN KEY (town_id, player_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__actor
    FOREIGN KEY (town_id, actor_id) REFERENCES public.actors (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__target_actor
    FOREIGN KEY (town_id, target_actor_id) REFERENCES public.actors (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__subject_entity
    FOREIGN KEY (town_id, subject_entity_id)
    REFERENCES public.story_entities (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__location_entity
    FOREIGN KEY (town_id, location_entity_id)
    REFERENCES public.story_entities (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__claim
    FOREIGN KEY (town_id, claim_id) REFERENCES public.claims (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__clue
    FOREIGN KEY (town_id, clue_id) REFERENCES public.clues (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_world_events__promise
    FOREIGN KEY (town_id, promise_id) REFERENCES public.promises (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_world_events__event_type CHECK (event_type IN ({{EVENT_TYPES}})),
  CONSTRAINT ck_world_events__origin_kind CHECK (origin_kind IN ({{EVENT_ORIGIN_KINDS}})),
  CONSTRAINT ck_world_events__sequence_positive CHECK (sequence_no > 0),
  CONSTRAINT ck_world_events__effect_index CHECK (effect_index >= 0),
  -- Exactly the origin the kind declares. A seed event has neither, which is
  -- how authored backstory stays distinguishable from live activity.
  CONSTRAINT ck_world_events__origin_shape CHECK (
    CASE origin_kind
      WHEN 'player_action' THEN
        player_action_id IS NOT NULL AND ambient_job_execution_id IS NULL
      WHEN 'ambient_job' THEN
        ambient_job_execution_id IS NOT NULL AND player_action_id IS NULL
      WHEN 'system_seed' THEN
        player_action_id IS NULL AND ambient_job_execution_id IS NULL
      ELSE false
    END
  )
);

-- Effect indexes are numbered within their origin, so two effects of one
-- action cannot collide and a replay cannot renumber them.
CREATE UNIQUE INDEX uq_world_events__player_effect
  ON public.world_events (town_id, player_action_id, effect_index)
  WHERE player_action_id IS NOT NULL;

CREATE UNIQUE INDEX uq_world_events__ambient_effect
  ON public.world_events (town_id, ambient_job_execution_id, effect_index)
  WHERE ambient_job_execution_id IS NOT NULL;

-- Model invocation telemetry. Appended in its own short transaction after
-- validation, so a later state conflict cannot erase incurred cost or hide a
-- rejected attempt. Prompts and raw invalid output are never stored.
CREATE TABLE public.agent_runs (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_action_id UUID NULL,
  ambient_job_execution_id UUID NULL,
  world_event_id UUID NULL,
  purpose STRING NOT NULL,
  model STRING NOT NULL,
  inference_profile STRING NOT NULL,
  prompt_version STRING NOT NULL,
  target_prompt_version STRING NULL,
  prompt_sha256 BYTES NULL,
  task_input_version STRING NULL,
  output_schema_version STRING NULL,
  validation_policy_version STRING NULL,
  input_tokens INT8 NOT NULL,
  output_tokens INT8 NOT NULL,
  cache_read_tokens INT8 NOT NULL,
  cache_write_tokens INT8 NOT NULL,
  latency_ms INT8 NOT NULL,
  estimated_cost DECIMAL(12, 6) NOT NULL,
  outcome STRING NOT NULL,
  validation_error_code STRING NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_agent_runs PRIMARY KEY (town_id, id),
  CONSTRAINT fk_agent_runs__player_action
    FOREIGN KEY (town_id, player_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_agent_runs__world_event
    FOREIGN KEY (town_id, world_event_id) REFERENCES public.world_events (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_agent_runs__purpose CHECK (purpose IN ({{AGENT_RUN_PURPOSES}})),
  CONSTRAINT ck_agent_runs__outcome CHECK (outcome IN ({{AGENT_RUN_OUTCOMES}})),
  CONSTRAINT ck_agent_runs__measures_non_negative CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND cache_read_tokens >= 0
    AND cache_write_tokens >= 0 AND latency_ms >= 0 AND estimated_cost >= 0
  ),
  -- Every run is attributable to something that caused it.
  CONSTRAINT ck_agent_runs__has_causal_source CHECK (
    player_action_id IS NOT NULL OR ambient_job_execution_id IS NOT NULL
    OR world_event_id IS NOT NULL
  ),
  -- Structured calls must be reproducible without storing the prompt: the hash
  -- plus the four contract versions pin exactly what ran. Embedding calls have
  -- none of those, so they must not pretend to.
  CONSTRAINT ck_agent_runs__contract_versions CHECK (
    CASE
      WHEN purpose IN ({{EMBEDDING_AGENT_RUN_PURPOSES}}) THEN
        prompt_sha256 IS NULL AND task_input_version IS NULL
        AND output_schema_version IS NULL AND validation_policy_version IS NULL
      ELSE
        prompt_sha256 IS NOT NULL AND task_input_version IS NOT NULL
        AND output_schema_version IS NOT NULL
        AND validation_policy_version IS NOT NULL
    END
  ),
  CONSTRAINT ck_agent_runs__prompt_sha256_length
    CHECK (prompt_sha256 IS NULL OR length(prompt_sha256) = 32),
  -- Only a repair names the prompt whose output it is repairing.
  CONSTRAINT ck_agent_runs__target_prompt_version
    CHECK ((purpose = 'structured_repair') = (target_prompt_version IS NOT NULL))
);

-- Durable admission control for model spend. Deliberately global: `town_id` is
-- nullable because warmup and synthetic smoke calls belong to no town.
CREATE TABLE public.model_cost_reservations (
  id UUID NOT NULL,
  billing_month DATE NOT NULL,
  town_id UUID NULL,
  player_action_id UUID NULL,
  ambient_job_execution_id UUID NULL,
  world_event_id UUID NULL,
  non_game_operation_key STRING NULL,
  attempt_ordinal INT4 NOT NULL,
  purpose STRING NOT NULL,
  model STRING NOT NULL,
  inference_profile STRING NOT NULL,
  price_version STRING NOT NULL,
  maximum_cost DECIMAL(12, 6) NOT NULL,
  status STRING NOT NULL,
  agent_run_id UUID NULL,
  actual_cost DECIMAL(12, 6) NULL,
  settled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_model_cost_reservations PRIMARY KEY (id),
  CONSTRAINT fk_model_cost_reservations__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  CONSTRAINT fk_model_cost_reservations__player_action
    FOREIGN KEY (town_id, player_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_model_cost_reservations__world_event
    FOREIGN KEY (town_id, world_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_model_cost_reservations__agent_run
    FOREIGN KEY (town_id, agent_run_id) REFERENCES public.agent_runs (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_model_cost_reservations__purpose
    CHECK (purpose IN ({{AGENT_RUN_PURPOSES}})),
  CONSTRAINT ck_model_cost_reservations__status
    CHECK (status IN ({{RESERVATION_STATUSES}})),
  CONSTRAINT ck_model_cost_reservations__attempt_ordinal CHECK (attempt_ordinal >= 0),
  CONSTRAINT ck_model_cost_reservations__costs_non_negative
    CHECK (maximum_cost >= 0 AND (actual_cost IS NULL OR actual_cost >= 0)),
  -- Settlement cannot exceed what was admitted, so the monthly ceiling holds
  -- even when an invocation costs more than expected.
  CONSTRAINT ck_model_cost_reservations__settlement_within_reservation
    CHECK (actual_cost IS NULL OR actual_cost <= maximum_cost),
  -- Exactly one caller identity, and a town exactly when the caller is
  -- town-scoped.
  CONSTRAINT ck_model_cost_reservations__single_source CHECK (
    (
      (CASE WHEN player_action_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN ambient_job_execution_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN world_event_id IS NULL THEN 0 ELSE 1 END)
      + (CASE WHEN non_game_operation_key IS NULL THEN 0 ELSE 1 END)
    ) = 1
  ),
  CONSTRAINT ck_model_cost_reservations__town_presence
    CHECK ((non_game_operation_key IS NULL) = (town_id IS NOT NULL)),
  -- An ambiguous invocation stays reserved at its maximum until someone can
  -- prove whether it happened; it is never expired by wall-clock age.
  CONSTRAINT ck_model_cost_reservations__settlement_shape CHECK (
    CASE status
      WHEN 'reserved' THEN actual_cost IS NULL AND settled_at IS NULL
      WHEN 'settled' THEN actual_cost IS NOT NULL AND settled_at IS NOT NULL
      WHEN 'released' THEN actual_cost = 0 AND settled_at IS NOT NULL
      ELSE false
    END
  )
);

-- Transactional handoff to SQS. The row is written in the same transaction as
-- the departure it follows, so a crash before publication is recoverable
-- rather than a lost job.
CREATE TABLE public.outbox (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  source_event_id UUID NOT NULL,
  visit_id UUID NOT NULL,
  job_type STRING NOT NULL,
  job_key UUID NOT NULL,
  payload JSONB NOT NULL,
  payload_hash BYTES NOT NULL,
  after_event_sequence INT8 NOT NULL,
  through_event_sequence INT8 NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  transition_deadline_at TIMESTAMPTZ NOT NULL,
  next_send_at TIMESTAMPTZ NOT NULL,
  delivery_status STRING NOT NULL,
  send_token UUID NULL,
  send_expires_at TIMESTAMPTZ NULL,
  send_attempt_count INT4 NOT NULL DEFAULT 0,
  last_error_code STRING NULL,
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_outbox PRIMARY KEY (town_id, id),
  CONSTRAINT fk_outbox__source_event
    FOREIGN KEY (town_id, source_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbox__visit
    FOREIGN KEY (town_id, visit_id) REFERENCES public.player_visits (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_outbox__job_key UNIQUE (town_id, job_key),
  -- One job per departed visit: a second would duplicate an event range.
  CONSTRAINT uq_outbox__visit_job_type UNIQUE (town_id, visit_id, job_type),
  CONSTRAINT ck_outbox__job_type CHECK (job_type IN ({{OUTBOX_JOB_TYPES}})),
  CONSTRAINT ck_outbox__delivery_status
    CHECK (delivery_status IN ({{OUTBOX_DELIVERY_STATUSES}})),
  CONSTRAINT ck_outbox__payload_hash_length CHECK (length(payload_hash) = 32),
  CONSTRAINT ck_outbox__send_attempt_count CHECK (send_attempt_count >= 0),
  -- Ranges are half-open and non-empty; concurrent departures therefore get
  -- disjoint ranges rather than overlapping ones.
  CONSTRAINT ck_outbox__range
    CHECK (after_event_sequence >= 0
           AND through_event_sequence > after_event_sequence),
  CONSTRAINT ck_outbox__delivery_shape CHECK (
    CASE delivery_status
      WHEN 'pending' THEN
        send_token IS NULL AND send_expires_at IS NULL AND sent_at IS NULL
        AND last_error_code IS NULL
      WHEN 'sending' THEN
        send_token IS NOT NULL AND send_expires_at IS NOT NULL AND sent_at IS NULL
      WHEN 'sent' THEN
        send_token IS NULL AND send_expires_at IS NULL AND sent_at IS NOT NULL
      WHEN 'abandoned' THEN
        send_token IS NULL AND send_expires_at IS NULL
        AND last_error_code IS NOT NULL
      ELSE false
    END
  )
);

-- Durable ambient execution identity. Its job key and payload hash must match
-- the outbox row, so a message whose payload was tampered with quarantines
-- instead of running.
CREATE TABLE public.ambient_job_executions (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  outbox_id UUID NOT NULL,
  job_key UUID NOT NULL,
  payload_hash BYTES NOT NULL,
  status STRING NOT NULL,
  processing_token UUID NULL,
  processing_expires_at TIMESTAMPTZ NULL,
  attempt_count INT4 NOT NULL DEFAULT 0,
  action_count INT4 NULL,
  error_code STRING NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_ambient_job_executions PRIMARY KEY (town_id, id),
  CONSTRAINT fk_ambient_job_executions__outbox
    FOREIGN KEY (town_id, outbox_id) REFERENCES public.outbox (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_ambient_job_executions__outbox UNIQUE (town_id, outbox_id),
  CONSTRAINT uq_ambient_job_executions__job_key UNIQUE (town_id, job_key),
  CONSTRAINT ck_ambient_job_executions__status
    CHECK (status IN ({{AMBIENT_EXECUTION_STATUSES}})),
  CONSTRAINT ck_ambient_job_executions__payload_hash_length
    CHECK (length(payload_hash) = 32),
  CONSTRAINT ck_ambient_job_executions__attempt_count CHECK (attempt_count >= 0),
  -- A tick may apply at most two actions, and a valid no-op completes with
  -- zero rather than being left unfinished.
  CONSTRAINT ck_ambient_job_executions__state_shape CHECK (
    CASE status
      WHEN 'processing' THEN
        processing_token IS NOT NULL AND processing_expires_at IS NOT NULL
        AND action_count IS NULL AND error_code IS NULL AND completed_at IS NULL
      WHEN 'completed' THEN
        processing_token IS NULL AND processing_expires_at IS NULL
        AND action_count BETWEEN 0 AND 2 AND error_code IS NULL
        AND completed_at IS NOT NULL
      WHEN 'quarantined' THEN
        processing_token IS NULL AND processing_expires_at IS NULL
        AND action_count IS NULL AND error_code IS NOT NULL
      ELSE false
    END
  )
);
