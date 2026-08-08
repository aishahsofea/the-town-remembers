-- Foreign keys whose two sides are mutually dependent.
--
-- Several accepted relationships are cyclic: visits reference the action that
-- opened them, events reference the action or job that produced them, and most
-- domain rows reference the event that caused them. Declaring these inline
-- would require creating a table before something it points at, so they are
-- added here, once both sides exist.
--
-- Every relationship in the accepted model is a real foreign key by the end of
-- this file. None stays application-only merely because its DDL was staged.

-- The town's resolution reservation points at the winning attempt and its
-- owner, both of which are town-owned rows created much later in a town's life.
ALTER TABLE public.towns
  ADD CONSTRAINT fk_towns__winning_case_attempt
    FOREIGN KEY (id, winning_case_attempt_id)
    REFERENCES public.case_attempts (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.towns
  ADD CONSTRAINT fk_towns__resolution_owner
    FOREIGN KEY (id, resolution_owner_player_id)
    REFERENCES public.players (town_id, id) ON DELETE RESTRICT;

-- A completed active-town join creates the first visit, and the request keeps
-- the reference so a replayed response can name it.
ALTER TABLE public.join_requests
  ADD CONSTRAINT fk_join_requests__initial_visit
    FOREIGN KEY (town_id, initial_visit_id)
    REFERENCES public.player_visits (town_id, id) ON DELETE RESTRICT;

-- A visit is opened and closed by actions, and actions belong to visits.
ALTER TABLE public.player_visits
  ADD CONSTRAINT fk_player_visits__started_by_action
    FOREIGN KEY (town_id, started_by_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.player_visits
  ADD CONSTRAINT fk_player_visits__ended_by_action
    FOREIGN KEY (town_id, ended_by_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.claim_drafts
  ADD CONSTRAINT fk_claim_drafts__normalization_action
    FOREIGN KEY (town_id, normalization_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.claim_drafts
  ADD CONSTRAINT fk_claim_drafts__confirmed_by_action
    FOREIGN KEY (town_id, confirmed_by_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.npc_interactions
  ADD CONSTRAINT fk_npc_interactions__player_action
    FOREIGN KEY (town_id, player_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.npc_interactions
  ADD CONSTRAINT fk_npc_interactions__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

-- Every experience, communication, discovery, and score change names the event
-- that caused it. This is what makes the causal history reconstructable from
-- the ledger rather than from timestamps.
ALTER TABLE public.episodes
  ADD CONSTRAINT fk_episodes__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.claim_transmissions
  ADD CONSTRAINT fk_claim_transmissions__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.items
  ADD CONSTRAINT fk_items__revealed_event
    FOREIGN KEY (town_id, revealed_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.player_capabilities
  ADD CONSTRAINT fk_player_capabilities__granted_event
    FOREIGN KEY (town_id, granted_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.player_capabilities
  ADD CONSTRAINT fk_player_capabilities__revoked_event
    FOREIGN KEY (town_id, revoked_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.clue_discoveries
  ADD CONSTRAINT fk_clue_discoveries__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.npc_beliefs
  ADD CONSTRAINT fk_npc_beliefs__updated_event
    FOREIGN KEY (town_id, updated_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.belief_evidence
  ADD CONSTRAINT fk_belief_evidence__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.npc_player_relationships
  ADD CONSTRAINT fk_npc_player_relationships__updated_event
    FOREIGN KEY (town_id, updated_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.relationship_changes
  ADD CONSTRAINT fk_relationship_changes__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.relationship_changes
  ADD CONSTRAINT fk_relationship_changes__promise
    FOREIGN KEY (town_id, promise_id)
    REFERENCES public.promises (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.promises
  ADD CONSTRAINT fk_promises__accepted_event
    FOREIGN KEY (town_id, accepted_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.promises
  ADD CONSTRAINT fk_promises__resolved_event
    FOREIGN KEY (town_id, resolved_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.case_board_entries
  ADD CONSTRAINT fk_case_board_entries__source_event
    FOREIGN KEY (town_id, source_event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.case_attempts
  ADD CONSTRAINT fk_case_attempts__player_action
    FOREIGN KEY (town_id, player_action_id)
    REFERENCES public.player_actions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.case_attempts
  ADD CONSTRAINT fk_case_attempts__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.town_resolutions
  ADD CONSTRAINT fk_town_resolutions__event
    FOREIGN KEY (town_id, event_id)
    REFERENCES public.world_events (town_id, id) ON DELETE RESTRICT;

-- An ambient job produces events, and its execution row is created from the
-- outbox row that a departure event produced.
ALTER TABLE public.world_events
  ADD CONSTRAINT fk_world_events__ambient_execution
    FOREIGN KEY (town_id, ambient_job_execution_id)
    REFERENCES public.ambient_job_executions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT fk_agent_runs__ambient_execution
    FOREIGN KEY (town_id, ambient_job_execution_id)
    REFERENCES public.ambient_job_executions (town_id, id) ON DELETE RESTRICT;

ALTER TABLE public.model_cost_reservations
  ADD CONSTRAINT fk_model_cost_reservations__ambient_execution
    FOREIGN KEY (town_id, ambient_job_execution_id)
    REFERENCES public.ambient_job_executions (town_id, id) ON DELETE RESTRICT;
