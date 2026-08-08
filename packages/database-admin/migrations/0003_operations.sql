-- Operational ledgers: town creation, first-time join, sessions, rate limits,
-- and visits.
--
-- Town creation and join happen before an authenticated player exists, so they
-- cannot reuse the `player_actions` ledger. Each is a durable record of one
-- attempt with a processing claim and a saved terminal result, which is what
-- makes a lost response replayable without re-running its effects.
--
-- Every state-presence rule below is a check, so a row that says it is
-- `processing` cannot also carry a saved response, and a row that says it
-- completed cannot be missing one. Repository behavior for these records
-- belongs to the route-owning phases; the schema's job is to make the invalid
-- intermediate states unrepresentable.

-- Global rather than town-owned: the town does not exist yet when the first
-- attempt arrives.
CREATE TABLE public.town_creation_requests (
  idempotency_key UUID NOT NULL,
  request_hash BYTES NOT NULL,
  content_version STRING NOT NULL,
  security_key_version STRING NOT NULL,
  status STRING NOT NULL,
  processing_token UUID NULL,
  processing_expires_at TIMESTAMPTZ NULL,
  attempt_count INT4 NOT NULL DEFAULT 0,
  town_id UUID NULL,
  response_status INT4 NULL,
  response_payload JSONB NULL,
  error_code STRING NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,

  CONSTRAINT pk_town_creation_requests PRIMARY KEY (idempotency_key),
  CONSTRAINT fk_town_creation_requests__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  CONSTRAINT ck_town_creation_requests__status
    CHECK (status IN ({{REQUEST_LEDGER_STATUSES}})),
  CONSTRAINT ck_town_creation_requests__request_hash_length
    CHECK (length(request_hash) = 32),
  CONSTRAINT ck_town_creation_requests__attempt_count CHECK (attempt_count >= 0),
  -- A processing claim exists only while processing, and never alongside a
  -- saved result: an expired worker whose claim was replaced cannot commit.
  CONSTRAINT ck_town_creation_requests__claim CHECK (
    CASE status
      WHEN 'processing' THEN
        processing_token IS NOT NULL AND processing_expires_at IS NOT NULL
      ELSE processing_token IS NULL AND processing_expires_at IS NULL
    END
  ),
  CONSTRAINT ck_town_creation_requests__terminal_fields CHECK (
    CASE status
      WHEN 'processing' THEN
        town_id IS NULL AND response_status IS NULL AND response_payload IS NULL
        AND error_code IS NULL AND completed_at IS NULL
      WHEN 'completed' THEN
        town_id IS NOT NULL AND response_status IS NOT NULL
        AND response_payload IS NOT NULL AND error_code IS NULL
        AND completed_at IS NOT NULL
      WHEN 'failed' THEN
        response_status IS NOT NULL AND response_payload IS NOT NULL
        AND error_code IS NOT NULL AND completed_at IS NOT NULL
      ELSE false
    END
  )
);

-- The join-attempt secret is a short-lived credential, distinct from the
-- ordinary idempotency key. Only its hash is stored, and closing the replay
-- window clears even that.
CREATE TABLE public.join_requests (
  town_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  request_hash BYTES NOT NULL,
  join_secret_hash BYTES NULL,
  status STRING NOT NULL,
  processing_token UUID NULL,
  processing_expires_at TIMESTAMPTZ NULL,
  attempt_count INT4 NOT NULL DEFAULT 0,
  player_id UUID NULL,
  initial_visit_id UUID NULL,
  replay_expires_at TIMESTAMPTZ NULL,
  bootstrap_confirmed_at TIMESTAMPTZ NULL,
  replay_closed_at TIMESTAMPTZ NULL,
  replay_closed_reason STRING NULL,
  session_issue_count INT4 NOT NULL DEFAULT 0,
  response_status INT4 NULL,
  response_payload JSONB NULL,
  error_code STRING NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,

  CONSTRAINT pk_join_requests PRIMARY KEY (town_id, idempotency_key),
  CONSTRAINT fk_join_requests__town
    FOREIGN KEY (town_id) REFERENCES public.towns (id) ON DELETE RESTRICT,
  CONSTRAINT fk_join_requests__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_join_requests__status CHECK (status IN ({{REQUEST_LEDGER_STATUSES}})),
  CONSTRAINT ck_join_requests__request_hash_length CHECK (length(request_hash) = 32),
  CONSTRAINT ck_join_requests__join_secret_hash_length
    CHECK (join_secret_hash IS NULL OR length(join_secret_hash) = 32),
  CONSTRAINT ck_join_requests__attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_join_requests__claim CHECK (
    CASE status
      WHEN 'processing' THEN
        processing_token IS NOT NULL AND processing_expires_at IS NOT NULL
      ELSE processing_token IS NULL AND processing_expires_at IS NULL
    END
  ),
  CONSTRAINT ck_join_requests__terminal_fields CHECK (
    CASE status
      WHEN 'processing' THEN
        player_id IS NULL AND response_status IS NULL AND response_payload IS NULL
        AND error_code IS NULL AND completed_at IS NULL
      WHEN 'completed' THEN
        player_id IS NOT NULL AND response_status IS NOT NULL
        AND response_payload IS NOT NULL AND error_code IS NULL
        AND completed_at IS NOT NULL
      WHEN 'failed' THEN
        response_status IS NOT NULL AND response_payload IS NOT NULL
        AND error_code IS NOT NULL AND completed_at IS NOT NULL
      ELSE false
    END
  ),
  -- One request may mint at most three simultaneous bootstrap sessions. The
  -- fourth replay closes the window instead.
  CONSTRAINT ck_join_requests__session_issue_count CHECK (
    CASE status
      WHEN 'processing' THEN session_issue_count = 0
      WHEN 'completed' THEN session_issue_count BETWEEN 1 AND 3
      ELSE session_issue_count >= 0
    END
  ),
  CONSTRAINT ck_join_requests__replay_closed_reason
    CHECK (replay_closed_reason IS NULL
           OR replay_closed_reason IN ({{JOIN_REPLAY_CLOSED_REASONS}})),
  -- Closure is one fact recorded in two columns; neither may appear alone.
  CONSTRAINT ck_join_requests__replay_closure
    CHECK ((replay_closed_at IS NULL) = (replay_closed_reason IS NULL)),
  -- Closing for confirmation, expiry, or exhaustion always clears the secret,
  -- so a closed request cannot authenticate anyone.
  CONSTRAINT ck_join_requests__closed_secret_cleared
    CHECK (replay_closed_at IS NULL OR join_secret_hash IS NULL)
);

CREATE TABLE public.player_sessions (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_id UUID NOT NULL,
  join_request_id UUID NOT NULL,
  token_hash BYTES NOT NULL,
  status STRING NOT NULL,
  last_cookie_issued_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_player_sessions PRIMARY KEY (town_id, id),
  CONSTRAINT fk_player_sessions__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_player_sessions__join_request
    FOREIGN KEY (town_id, join_request_id)
    REFERENCES public.join_requests (town_id, idempotency_key) ON DELETE RESTRICT,
  CONSTRAINT uq_player_sessions__token_hash UNIQUE (town_id, token_hash),
  CONSTRAINT ck_player_sessions__status CHECK (status IN ({{SESSION_STATUSES}})),
  CONSTRAINT ck_player_sessions__token_hash_length CHECK (length(token_hash) = 32),
  -- There is no inactivity expiry: an active session is accepted until it is
  -- revoked or the town retires. Only the cookie reissue time lives here.
  CONSTRAINT ck_player_sessions__cookie_issued_after_creation
    CHECK (last_cookie_issued_at >= created_at)
);

-- Token buckets. Source addresses appear only as rotating HMAC hashes, so
-- there is deliberately no column that could hold a raw IP.
CREATE TABLE public.api_rate_limits (
  scope_kind STRING NOT NULL,
  scope_key BYTES NOT NULL,
  bucket_kind STRING NOT NULL,
  tokens_milli INT8 NOT NULL,
  last_refill_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT pk_api_rate_limits PRIMARY KEY (scope_kind, scope_key, bucket_kind),
  CONSTRAINT ck_api_rate_limits__scope_kind
    CHECK (scope_kind IN ({{RATE_LIMIT_SCOPE_KINDS}})),
  CONSTRAINT ck_api_rate_limits__bucket_kind
    CHECK (bucket_kind IN ({{RATE_LIMIT_BUCKET_KINDS}})),
  CONSTRAINT ck_api_rate_limits__tokens_non_negative CHECK (tokens_milli >= 0)
);

-- Current player location belongs to an active visit, not to the persistent
-- player identity, so leaving town is an explicit, closable event.
CREATE TABLE public.player_visits (
  town_id UUID NOT NULL,
  id UUID NOT NULL,
  player_id UUID NOT NULL,
  current_location_entity_id UUID NOT NULL,
  current_location_entity_type STRING NOT NULL DEFAULT 'location',
  status STRING NOT NULL,
  start_revision INT8 NOT NULL,
  end_revision INT8 NULL,
  started_by_action_id UUID NOT NULL,
  ended_by_action_id UUID NULL,
  end_reason STRING NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NULL,

  CONSTRAINT pk_player_visits PRIMARY KEY (town_id, id),
  CONSTRAINT fk_player_visits__player
    FOREIGN KEY (town_id, player_id) REFERENCES public.players (town_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_player_visits__location_entity_type
    CHECK (current_location_entity_type = 'location'),
  CONSTRAINT fk_player_visits__location
    FOREIGN KEY (town_id, current_location_entity_id, current_location_entity_type)
    REFERENCES public.story_entities (town_id, id, entity_type) ON DELETE RESTRICT,
  CONSTRAINT ck_player_visits__status CHECK (status IN ({{VISIT_STATUSES}})),
  CONSTRAINT ck_player_visits__end_reason
    CHECK (end_reason IS NULL OR end_reason IN ({{VISIT_END_REASONS}})),
  CONSTRAINT ck_player_visits__start_revision CHECK (start_revision >= 0),
  -- Ending a visit records its reason, closing action, revision, and time
  -- together; an active visit records none of them.
  CONSTRAINT ck_player_visits__end_fields CHECK (
    CASE status
      WHEN 'active' THEN
        end_revision IS NULL AND ended_by_action_id IS NULL
        AND end_reason IS NULL AND ended_at IS NULL
      WHEN 'ended' THEN
        end_revision IS NOT NULL AND ended_by_action_id IS NOT NULL
        AND end_reason IS NOT NULL AND ended_at IS NOT NULL
      ELSE false
    END
  ),
  CONSTRAINT ck_player_visits__bounds CHECK (
    (ended_at IS NULL OR ended_at >= started_at)
    AND (end_revision IS NULL OR end_revision >= start_revision)
  )
);

-- At most one active visit per player. Starting while one exists returns the
-- existing visit rather than creating a second.
CREATE UNIQUE INDEX uq_player_visits__active
  ON public.player_visits (town_id, player_id)
  WHERE status = 'active';
