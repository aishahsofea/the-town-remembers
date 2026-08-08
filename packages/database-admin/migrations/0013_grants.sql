-- Least-privilege grants.
--
-- Three identities, three jobs, no overlap.
--
-- `app_runtime` is what a Lambda holds. It reads and writes game state and can
-- do nothing else: no DDL, no role administration, and no access to the
-- inspection schema, so a compromised request path cannot reshape the schema or
-- read the judge surface.
--
-- Deletes are withheld everywhere except `api_rate_limits`, the sole routine
-- delete Decision 005 permits. Nothing in the causal history can be erased by
-- the identity that writes it.
--
-- `inspection_reader` is the CockroachDB-managed MCP identity. It may read the
-- thirteen views and nothing else — not one base table — so no query through
-- that connection can reach an invite hash, a session hash, or a join secret.
--
-- Production passwords and the managed MCP connection belong to Phase 7. This
-- file grants capability, never a credential.

-- CockroachDB, like PostgreSQL before 15, grants CREATE on the public schema to
-- every role by default. Least privilege here means taking that back first;
-- otherwise `app_runtime` could add tables despite holding no explicit DDL
-- grant at all.
REVOKE CREATE ON SCHEMA public FROM public;

GRANT USAGE ON SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.towns,
  public.story_entities,
  public.actors,
  public.players,
  public.npcs,
  public.npc_contact_edges,
  public.town_creation_requests,
  public.join_requests,
  public.player_sessions,
  public.player_visits,
  public.world_facts,
  public.case_solutions,
  public.inspectables,
  public.items,
  public.player_capabilities,
  public.clues,
  public.clue_claim_effects,
  public.clue_discoveries,
  public.claims,
  public.claim_relations,
  public.claim_drafts,
  public.npc_interactions,
  public.claim_transmissions,
  public.episodes,
  public.episode_references,
  public.npc_beliefs,
  public.belief_evidence,
  public.npc_player_relationships,
  public.relationship_changes,
  public.promises,
  public.case_board_entries,
  public.case_attempts,
  public.town_resolutions,
  public.player_actions,
  public.world_events,
  public.agent_runs,
  public.model_cost_reservations,
  public.outbox,
  public.ambient_job_executions
TO app_runtime;

-- Expired token buckets may be pruned after 24 hours. This is the only table
-- the runtime identity may delete from.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_rate_limits TO app_runtime;

-- The migration ledger is readable so an application can report which schema
-- version it is running against, but it may not rewrite recorded history.
GRANT SELECT ON TABLE public.schema_migrations TO app_runtime;

GRANT USAGE ON SCHEMA inspection TO inspection_reader;

GRANT SELECT ON TABLE
  inspection.npc_beliefs,
  inspection.belief_evidence,
  inspection.claim_paths,
  inspection.relationship_timeline,
  inspection.promise_status,
  inspection.object_history,
  inspection.objective_truth,
  inspection.case_progress,
  inspection.world_event_timeline,
  inspection.agent_runs,
  inspection.idempotency_status,
  inspection.ambient_jobs,
  inspection.access_operations
TO inspection_reader;
