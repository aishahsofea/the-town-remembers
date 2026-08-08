-- The read-only inspection schema.
--
-- These views exist for judges and developers, not for player requests. Their
-- job is to make a causal claim checkable: not "Nessa believes the bell was in
-- the garden" but "she believes it because Mara told her, who heard it from a
-- player, weighted 32 at a trust snapshot of 20, on event 41".
--
-- Two rules govern every view here.
--
-- Nothing credential-bearing may appear. No invite hash, session hash, join
-- secret, raw processing token, cookie, prompt text, or unvalidated model
-- output. Opaque operation keys and claim-expiry times may appear, because
-- they authenticate nobody.
--
-- Every view carries human-readable stable keys and display names beside its
-- opaque IDs, and orders deterministically, so two runs of the same query
-- produce the same reading.

-- Current belief with the proposition spelled out.
CREATE VIEW inspection.npc_beliefs AS
SELECT
  b.town_id,
  ch.entity_key AS npc_key,
  a.display_name AS npc_name,
  c.normalized_key AS claim_key,
  subject.entity_key AS subject_key,
  c.predicate,
  object.entity_key AS object_key,
  c.polarity,
  c.context_key,
  b.score,
  b.label,
  b.revision,
  e.sequence_no AS updated_event_sequence,
  b.updated_at
FROM public.npc_beliefs b
JOIN public.npcs n ON n.town_id = b.town_id AND n.id = b.npc_id
JOIN public.actors a ON a.town_id = n.town_id AND a.id = n.id
JOIN public.story_entities ch
  ON ch.town_id = n.town_id AND ch.id = n.character_entity_id
JOIN public.claims c ON c.town_id = b.town_id AND c.id = b.claim_id
JOIN public.story_entities subject
  ON subject.town_id = c.town_id AND subject.id = c.subject_entity_id
JOIN public.story_entities object
  ON object.town_id = c.town_id AND object.id = c.object_entity_id
JOIN public.world_events e ON e.town_id = b.town_id AND e.id = b.updated_event_id;

-- Why that score is what it is, one contribution per row.
CREATE VIEW inspection.belief_evidence AS
SELECT
  ev.town_id,
  npc_actor.display_name AS npc_name,
  c.normalized_key AS claim_key,
  ev.evidence_kind,
  ev.signed_weight,
  ev.trust_snapshot,
  ev.hop_count,
  clue.clue_key,
  source_actor.display_name AS independent_source_name,
  ev.corroboration_threshold,
  ev.mirrors_evidence_id,
  ev.reverses_evidence_id,
  ev.rule_version,
  e.sequence_no AS event_sequence,
  e.event_type,
  ev.created_at
FROM public.belief_evidence ev
JOIN public.actors npc_actor
  ON npc_actor.town_id = ev.town_id AND npc_actor.id = ev.npc_id
JOIN public.claims c ON c.town_id = ev.town_id AND c.id = ev.claim_id
JOIN public.world_events e ON e.town_id = ev.town_id AND e.id = ev.event_id
LEFT JOIN public.clues clue ON clue.town_id = ev.town_id AND clue.id = ev.clue_id
LEFT JOIN public.actors source_actor
  ON source_actor.town_id = ev.town_id
 AND source_actor.id = ev.independent_source_actor_id;

-- Who said what to whom, and where they got it.
CREATE VIEW inspection.claim_paths AS
SELECT
  t.town_id,
  t.id AS transmission_id,
  c.normalized_key AS claim_key,
  speaker.display_name AS speaker_name,
  speaker.actor_type AS speaker_type,
  recipient.display_name AS recipient_name,
  t.recipient_actor_type,
  t.source_kind,
  t.hop_count,
  t.parent_transmission_id,
  t.root_transmission_id,
  alleged.display_name AS alleged_source_name,
  e.sequence_no AS event_sequence,
  e.origin_kind,
  t.ordinal,
  t.created_at
FROM public.claim_transmissions t
JOIN public.claims c ON c.town_id = t.town_id AND c.id = t.claim_id
JOIN public.actors speaker
  ON speaker.town_id = t.town_id AND speaker.id = t.speaker_actor_id
JOIN public.actors recipient
  ON recipient.town_id = t.town_id AND recipient.id = t.recipient_actor_id
JOIN public.world_events e ON e.town_id = t.town_id AND e.id = t.event_id
LEFT JOIN public.actors alleged
  ON alleged.town_id = t.town_id AND alleged.id = t.alleged_source_actor_id;

CREATE VIEW inspection.relationship_timeline AS
SELECT
  rc.town_id,
  npc_actor.display_name AS npc_name,
  player_actor.display_name AS player_name,
  rc.trust_delta,
  rc.suspicion_delta,
  rc.reason_kind,
  c.normalized_key AS claim_key,
  clue.clue_key,
  item_entity.entity_key AS item_key,
  rc.promise_id,
  rc.rule_version,
  e.sequence_no AS event_sequence,
  rc.created_at
FROM public.relationship_changes rc
JOIN public.actors npc_actor
  ON npc_actor.town_id = rc.town_id AND npc_actor.id = rc.npc_id
JOIN public.actors player_actor
  ON player_actor.town_id = rc.town_id AND player_actor.id = rc.player_id
JOIN public.world_events e ON e.town_id = rc.town_id AND e.id = rc.event_id
LEFT JOIN public.claims c ON c.town_id = rc.town_id AND c.id = rc.claim_id
LEFT JOIN public.clues clue ON clue.town_id = rc.town_id AND clue.id = rc.clue_id
LEFT JOIN public.story_entities item_entity
  ON item_entity.town_id = rc.town_id AND item_entity.id = rc.item_id;

CREATE VIEW inspection.promise_status AS
SELECT
  p.town_id,
  p.id AS promise_id,
  npc_actor.display_name AS npc_name,
  player_actor.display_name AS player_name,
  p.kind,
  p.status,
  p.terms_version,
  c.normalized_key AS protected_claim_key,
  item_entity.entity_key AS item_key,
  accepted.sequence_no AS accepted_event_sequence,
  resolved.sequence_no AS resolved_event_sequence,
  p.created_at,
  p.updated_at
FROM public.promises p
JOIN public.actors npc_actor
  ON npc_actor.town_id = p.town_id AND npc_actor.id = p.npc_id
JOIN public.actors player_actor
  ON player_actor.town_id = p.town_id AND player_actor.id = p.player_id
JOIN public.world_events accepted
  ON accepted.town_id = p.town_id AND accepted.id = p.accepted_event_id
LEFT JOIN public.claims c ON c.town_id = p.town_id AND c.id = p.protected_claim_id
LEFT JOIN public.story_entities item_entity
  ON item_entity.town_id = p.town_id AND item_entity.id = p.item_id
LEFT JOIN public.world_events resolved
  ON resolved.town_id = p.town_id AND resolved.id = p.resolved_event_id;

-- Authoritative item state. A false rumour must never show up here.
CREATE VIEW inspection.object_history AS
SELECT
  i.town_id,
  entity.entity_key AS item_key,
  entity.display_name AS item_name,
  location.entity_key AS location_key,
  holder.display_name AS held_by_name,
  i.portable,
  i.revision,
  revealed.sequence_no AS revealed_event_sequence,
  i.updated_at
FROM public.items i
JOIN public.story_entities entity
  ON entity.town_id = i.town_id AND entity.id = i.id
LEFT JOIN public.story_entities location
  ON location.town_id = i.town_id AND location.id = i.location_entity_id
LEFT JOIN public.actors holder
  ON holder.town_id = i.town_id AND holder.id = i.held_by_actor_id
LEFT JOIN public.world_events revealed
  ON revealed.town_id = i.town_id AND revealed.id = i.revealed_event_id;

-- Authored facts and the private answer. Visible only to inspection access.
CREATE VIEW inspection.objective_truth AS
SELECT
  wf.town_id,
  'world_fact' AS truth_kind,
  wf.fact_key AS truth_key,
  wf.visibility,
  c.normalized_key AS detail_key,
  NULL::STRING AS secondary_key
FROM public.world_facts wf
JOIN public.claims c ON c.town_id = wf.town_id AND c.id = wf.claim_id
UNION ALL
SELECT
  s.town_id,
  'case_solution' AS truth_kind,
  culprit.entity_key AS truth_key,
  'hidden' AS visibility,
  motive.entity_key AS detail_key,
  location.entity_key AS secondary_key
FROM public.case_solutions s
JOIN public.story_entities culprit
  ON culprit.town_id = s.town_id AND culprit.id = s.culprit_entity_id
JOIN public.story_entities motive
  ON motive.town_id = s.town_id AND motive.id = s.motive_entity_id
JOIN public.story_entities location
  ON location.town_id = s.town_id AND location.id = s.location_entity_id;

-- Discoveries, attempts, the evidence gate, and the final choice.
CREATE VIEW inspection.case_progress AS
SELECT
  cl.town_id,
  'clue_discovery' AS progress_kind,
  cl.clue_key AS subject_key,
  cl.required_for_resolution,
  player_actor.display_name AS player_name,
  NULL::STRING AS outcome,
  e.sequence_no AS event_sequence,
  d.created_at
FROM public.clue_discoveries d
JOIN public.clues cl ON cl.town_id = d.town_id AND cl.id = d.clue_id
JOIN public.actors player_actor
  ON player_actor.town_id = d.town_id AND player_actor.id = d.player_id
JOIN public.world_events e ON e.town_id = d.town_id AND e.id = d.event_id
UNION ALL
SELECT
  ca.town_id,
  'case_attempt' AS progress_kind,
  suspect.entity_key AS subject_key,
  false AS required_for_resolution,
  player_actor.display_name AS player_name,
  ca.outcome,
  e.sequence_no AS event_sequence,
  ca.created_at
FROM public.case_attempts ca
JOIN public.story_entities suspect
  ON suspect.town_id = ca.town_id AND suspect.id = ca.suspect_entity_id
JOIN public.actors player_actor
  ON player_actor.town_id = ca.town_id AND player_actor.id = ca.player_id
JOIN public.world_events e ON e.town_id = ca.town_id AND e.id = ca.event_id
UNION ALL
SELECT
  tr.town_id,
  'resolution' AS progress_kind,
  tr.choice AS subject_key,
  false AS required_for_resolution,
  player_actor.display_name AS player_name,
  'chosen' AS outcome,
  e.sequence_no AS event_sequence,
  tr.created_at
FROM public.town_resolutions tr
JOIN public.actors player_actor
  ON player_actor.town_id = tr.town_id AND player_actor.id = tr.chosen_by_player_id
JOIN public.world_events e ON e.town_id = tr.town_id AND e.id = tr.event_id;

-- The ordered causal spine.
CREATE VIEW inspection.world_event_timeline AS
SELECT
  e.town_id,
  e.sequence_no,
  e.event_type,
  e.origin_kind,
  e.ambient_eligible,
  e.effect_key,
  e.effect_index,
  actor.display_name AS actor_name,
  target.display_name AS target_actor_name,
  subject.entity_key AS subject_entity_key,
  location.entity_key AS location_entity_key,
  c.normalized_key AS claim_key,
  clue.clue_key,
  e.promise_id,
  e.occurred_at
FROM public.world_events e
LEFT JOIN public.actors actor
  ON actor.town_id = e.town_id AND actor.id = e.actor_id
LEFT JOIN public.actors target
  ON target.town_id = e.town_id AND target.id = e.target_actor_id
LEFT JOIN public.story_entities subject
  ON subject.town_id = e.town_id AND subject.id = e.subject_entity_id
LEFT JOIN public.story_entities location
  ON location.town_id = e.town_id AND location.id = e.location_entity_id
LEFT JOIN public.claims c ON c.town_id = e.town_id AND c.id = e.claim_id
LEFT JOIN public.clues clue ON clue.town_id = e.town_id AND clue.id = e.clue_id;

-- Model invocations with their cost admission. Prompt *versions* and the
-- prompt hash appear; prompt text and raw output do not exist to expose.
CREATE VIEW inspection.agent_runs AS
SELECT
  r.town_id,
  r.id AS agent_run_id,
  r.purpose,
  r.model,
  r.inference_profile,
  r.prompt_version,
  r.target_prompt_version,
  r.task_input_version,
  r.output_schema_version,
  r.validation_policy_version,
  r.input_tokens,
  r.output_tokens,
  r.cache_read_tokens,
  r.cache_write_tokens,
  r.latency_ms,
  r.estimated_cost,
  r.outcome,
  r.validation_error_code,
  res.status AS reservation_status,
  res.maximum_cost AS reserved_maximum_cost,
  res.actual_cost AS settled_cost,
  res.price_version,
  e.sequence_no AS event_sequence,
  r.created_at
FROM public.agent_runs r
LEFT JOIN public.model_cost_reservations res
  ON res.town_id = r.town_id AND res.agent_run_id = r.id
LEFT JOIN public.world_events e ON e.town_id = r.town_id AND e.id = r.world_event_id;

-- Operation keys, claim state, and numbered effects. Opaque keys and claim
-- expiry may appear; processing tokens may not.
CREATE VIEW inspection.idempotency_status AS
SELECT
  pa.town_id,
  'player_action' AS operation_kind,
  pa.id AS operation_id,
  pa.idempotency_key::STRING AS operation_key,
  pa.action_kind AS operation_subkind,
  pa.status,
  pa.outcome,
  pa.attempt_count,
  pa.processing_expires_at,
  pa.retry_after_at,
  (
    SELECT count(*) FROM public.world_events e
     WHERE e.town_id = pa.town_id AND e.player_action_id = pa.id
  ) AS effect_count,
  pa.created_at,
  pa.completed_at
FROM public.player_actions pa
UNION ALL
SELECT
  aje.town_id,
  'ambient_job' AS operation_kind,
  aje.id AS operation_id,
  aje.job_key::STRING AS operation_key,
  'ambient_tick' AS operation_subkind,
  aje.status,
  NULL::STRING AS outcome,
  aje.attempt_count,
  aje.processing_expires_at,
  NULL::TIMESTAMPTZ AS retry_after_at,
  (
    SELECT count(*) FROM public.world_events e
     WHERE e.town_id = aje.town_id AND e.ambient_job_execution_id = aje.id
  ) AS effect_count,
  aje.created_at,
  aje.completed_at
FROM public.ambient_job_executions aje;

-- Disjoint event ranges, delivery state, and quarantine.
CREATE VIEW inspection.ambient_jobs AS
SELECT
  o.town_id,
  o.job_key,
  o.job_type,
  o.visit_id,
  o.after_event_sequence,
  o.through_event_sequence,
  o.delivery_status,
  o.send_attempt_count,
  o.last_error_code AS delivery_error_code,
  o.not_before,
  o.transition_deadline_at,
  o.sent_at,
  aje.status AS execution_status,
  aje.attempt_count AS execution_attempt_count,
  aje.action_count,
  aje.error_code AS execution_error_code,
  aje.completed_at,
  source.sequence_no AS source_event_sequence
FROM public.outbox o
JOIN public.world_events source
  ON source.town_id = o.town_id AND source.id = o.source_event_id
LEFT JOIN public.ambient_job_executions aje
  ON aje.town_id = o.town_id AND aje.outbox_id = o.id;

-- Access and admission decisions with no credential material at all: no invite
-- hash, no join secret, no session token hash, no rate-limit scope key.
CREATE VIEW inspection.access_operations AS
SELECT
  tcr.town_id,
  'town_creation' AS operation_kind,
  tcr.idempotency_key::STRING AS operation_key,
  tcr.status,
  tcr.attempt_count,
  tcr.error_code,
  NULL::STRING AS detail,
  0 AS counter,
  tcr.created_at
FROM public.town_creation_requests tcr
UNION ALL
SELECT
  jr.town_id,
  'join' AS operation_kind,
  jr.idempotency_key::STRING AS operation_key,
  jr.status,
  jr.attempt_count,
  jr.error_code,
  jr.replay_closed_reason AS detail,
  jr.session_issue_count AS counter,
  jr.created_at
FROM public.join_requests jr
UNION ALL
SELECT
  ps.town_id,
  'session' AS operation_kind,
  ps.id::STRING AS operation_key,
  ps.status,
  0 AS attempt_count,
  NULL::STRING AS error_code,
  player_actor.display_name AS detail,
  0 AS counter,
  ps.created_at
FROM public.player_sessions ps
JOIN public.actors player_actor
  ON player_actor.town_id = ps.town_id AND player_actor.id = ps.player_id
UNION ALL
-- Aggregated so no bucket identity, and therefore no hashed source address,
-- can be read back out of this view.
SELECT
  NULL::UUID AS town_id,
  'rate_limit' AS operation_kind,
  rl.scope_kind || ':' || rl.bucket_kind AS operation_key,
  'observed' AS status,
  0 AS attempt_count,
  NULL::STRING AS error_code,
  NULL::STRING AS detail,
  count(*)::INT4 AS counter,
  max(rl.updated_at) AS created_at
FROM public.api_rate_limits rl
GROUP BY rl.scope_kind, rl.bucket_kind;
