/**
 * The accepted schema inventory, as data.
 *
 * Decision 005 settles on forty tables and thirteen inspection views. Listing
 * them here rather than counting whatever the migrations happened to produce is
 * the difference between an audit and a tautology: adding an undocumented table
 * has to fail as loudly as losing a documented one.
 */

/** The forty tables Decision 005 settles on, grouped as that document groups them. */
export const ACCEPTED_TABLES = Object.freeze([
  // Town and identity
  "towns",
  "story_entities",
  "actors",
  "players",
  "npcs",
  "npc_contact_edges",
  // Operational ledgers
  "town_creation_requests",
  "join_requests",
  "player_sessions",
  "api_rate_limits",
  "player_visits",
  // Authored truth, evidence, and item state
  "world_facts",
  "case_solutions",
  "inspectables",
  "items",
  "player_capabilities",
  "clues",
  "clue_claim_effects",
  "clue_discoveries",
  // Claims, dialogue, provenance, and memory
  "claims",
  "claim_relations",
  "claim_drafts",
  "npc_interactions",
  "claim_transmissions",
  "episodes",
  "episode_references",
  // Beliefs and relationships
  "npc_beliefs",
  "belief_evidence",
  "npc_player_relationships",
  "relationship_changes",
  // Promises and case progress
  "promises",
  "case_board_entries",
  "case_attempts",
  "town_resolutions",
  // Actions, events, and operations
  "player_actions",
  "world_events",
  "agent_runs",
  "model_cost_reservations",
  "outbox",
  "ambient_job_executions",
] as const);

/** The migration ledger is infrastructure, not part of the accepted model. */
export const INFRASTRUCTURE_TABLES = Object.freeze(["schema_migrations"] as const);

export const ACCEPTED_VIEWS = Object.freeze([
  "npc_beliefs",
  "belief_evidence",
  "claim_paths",
  "relationship_timeline",
  "promise_status",
  "object_history",
  "objective_truth",
  "case_progress",
  "world_event_timeline",
  "agent_runs",
  "idempotency_status",
  "ambient_jobs",
  "access_operations",
] as const);

/**
 * Tables that are deliberately not town-scoped.
 *
 * `model_cost_reservations` is the accepted global billing exception: a monthly
 * spend ceiling cannot be enforced per town. `town_creation_requests` predates
 * the town it creates, and `api_rate_limits` protects unauthenticated routes
 * where no town is known yet.
 */
export const GLOBAL_TABLES = Object.freeze([
  "town_creation_requests",
  "api_rate_limits",
  "model_cost_reservations",
  "schema_migrations",
] as const);

/**
 * Column names that would indicate stored credential or raw-address material.
 * Source IPs exist only as rotating HMAC hashes, and raw model output is never
 * persisted, so a column named for either is a contract violation.
 */
export const FORBIDDEN_COLUMN_PATTERNS = Object.freeze([
  /^ip$/,
  /_ip$/,
  /^raw_/,
  /_plaintext$/,
  /^prompt_text$/,
  /password/,
] as const);
