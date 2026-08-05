# Phase 1 — Persistence and Authored Seed

- **Status:** Detailed implementation plan
- **Depends on:** Phase 0 exit gate
- **Produces:** The accepted 40-table CockroachDB model, inspection surface,
  and repeatable `bell-mystery-v1` town materialization
- **Task ID prefix:** `P1-`

## 1. Objective and user-visible proof

Make CockroachDB the durable source for authoritative game state, subjective
memory, complete causal history, and retry/recovery state exactly as defined by
the accepted schema contract.

The proof is an operator/test workflow that creates a fresh CockroachDB
database, applies all forward migrations, materializes a new
`bell-mystery-v1` town from versioned TypeScript content, and queries the
required `inspection` views. The resulting town must contain the exact authored
entities, initial custody, observations, communications, beliefs, provenance,
and private solution while exposing no credential material. Re-running
migrations is safe, and creating another town from the same content produces
an isolated equivalent seed without cross-town identities or references.

This phase does not yet expose the proof through the public HTTP API. A Phase 1
CLI/test harness may print the created opaque town ID and an inspection summary;
it must not print raw invite/session/join secrets or database credentials.

## 2. Scope

### In scope

- Forward SQL migrations for all 40 accepted tables, their closed domains,
  checks, composite foreign keys, uniqueness, partial indexes, and timestamps.
- CockroachDB `VECTOR(256)` storage and the required town/NPC-prefixed vector
  index.
- `migration_admin`, `app_runtime`, and read-only inspection grants without
  placing operator or inspection credentials in application configuration.
- A small `pg`/Kysely client boundary, generated or declared database types,
  parameterized-query conventions, deadlines, pool bounds, and CockroachDB
  serialization retry support.
- Versioned TypeScript source data for `bell-mystery-v1`, its mapping to
  `mvp-rules-v1`, content validation, and a transactionally repeatable town
  materializer.
- All required seed `system_seed` events, episodes, transmissions, evidence,
  beliefs, contact edges, item custody, clues, gates, copy keys, and solution.
- The accepted `inspection` schema and views.
- Migration, constraint, grant, town-isolation, seed, retry, vector, and
  inspection tests against CockroachDB rather than mocks.
- Operational documentation for local/test migration and seed workflows.

### Explicitly out of scope

- Public town-creation, invite, join, session, player action, or player-view
  handlers; Phase 3 connects the persisted ledgers to HTTP.
- Deterministic gameplay calculations beyond verifying accepted seed totals;
  Phase 2 implements reusable rule functions and state-transition planning.
- Bedrock, embeddings generation, vector recall ranking, SQS, Recovery Lambda,
  or ambient execution.
- Production CockroachDB cluster creation, AWS Secrets Manager population,
  deployed Lambda connectivity, managed MCP configuration, or cloud smoke
  tests; Phase 7 owns them.
- A content management system, a second mystery, procedural content, or seed
  mutation of an existing town.
- Runtime deletion. Only expired `api_rate_limits` may later be pruned under the
  accepted 24-hour exception.

## 3. Prerequisites and accepted contracts

### Required Phase 0 outputs

- `P0-02` package boundaries and dependency direction.
- `P0-03` strict TypeScript build conventions.
- `P0-04` versioned JSON contracts for persisted action responses.
- `P0-06` canonical serialization and hashing utilities.
- `P0-07` separation of operator-only migration configuration from Lambda
  runtime configuration.
- `P0-12`/`P0-13` test and CI entry points.

### Normative accepted sources

- Decision 005 is authoritative for the 40 tables, value conventions,
  nullability, identity, state machines, indexes, transaction boundaries,
  grants, views, and verification priorities.
- Decisions 002, 003, and 007 fix Kysely/`pg`, public TLS, short serializable
  transactions, retry/deadline/pool bounds, and credential separation.
- Decision 006 fixes JSON request/response shapes persisted by operational
  ledgers and the distinction between town creation, join, and player action
  identities.
- Decision 008 owns numerical rule meanings and seed score expectations.
- Decision 009 owns every `bell-mystery-v1` entity, stable key, authored string,
  item/clue binding, initial episode, initial belief, contact edge, claim
  relation, content/rules version, and seed-time causal event.
- Decisions 010 and 011 own prompt metadata, fallback copy, presentation keys,
  and other versioned content that the seed registry must reference without
  broadening the database's responsibilities.

The migration implementation may choose constraint/index names and forward
migration file numbering. It may not weaken the accepted entity boundaries,
cross-town protection, value domains, or required indexes.

## 4. Ordered workstreams and tasks

### Workstream A — Database harness, migration discipline, and roles

#### P1-01 — Establish the CockroachDB integration harness

**Depends on:** Phase 0 exit gate

**Deliverables**

- A documented local/CI mechanism for starting or targeting a disposable
  CockroachDB instance whose version supports `VECTOR(256)` and vector indexes.
- Separate connection inputs for migration administration and runtime tests;
  no checked-in credential values.
- Test helpers that create a uniquely named disposable database/schema scope,
  apply migrations, return bounded clients, and tear down only their validated
  target.
- A compatibility check that fails early on an unsupported CockroachDB version
  or missing vector capability.

**Acceptance checks**

- Database integration tests are skipped only through an explicit developer
  opt-out; the phase/CI exit job requires them.
- The harness never falls back to PostgreSQL, SQLite, an in-memory adapter, or
  mocks for schema acceptance.

#### P1-02 — Define forward-migration and schema conventions

**Depends on:** `P1-01`

**Deliverables**

- Ordered forward-only migration runner and migration ledger.
- SQL naming conventions for checks, composite foreign keys, unique/partial
  indexes, and `inspection` views.
- Transaction-safe migration execution where CockroachDB supports it and an
  explicit recovery procedure for non-transactional DDL.
- A schema-introspection assertion framework used by later tasks.

The runner must apply with the operator credential. Application startup must
never auto-migrate with `app_runtime`.

#### P1-03 — Create least-privilege roles and schema grants

**Depends on:** `P1-02`

**Deliverables**

- Migration/bootstrap SQL for `migration_admin`, `app_runtime`, and a read-only
  inspection role or grant target suitable for the CockroachDB-managed MCP
  connection.
- `app_runtime` DML/sequence rights required by repositories but no DDL or role
  administration.
- Inspection access limited to accepted `inspection` views, with no direct
  credential-bearing operational columns.
- Grant-verification tests that attempt allowed reads/writes and expected
  denials.

Production passwords and managed-MCP connection setup remain Phase 7 work.

### Workstream B — The 40-table schema

The task groups below assign logical ownership, not necessarily one SQL file
per group. Several accepted relationships are cyclic: visits reference actions,
events reference their action/job origins, and many domain rows reference their
causal events. Create the tables and typed columns in dependency order, then add
the deferred cyclic foreign keys in `P1-10` once both sides exist. `P1-11` must
prove the final migrated graph contains every accepted foreign key; no
relationship remains application-only merely because its DDL was staged.

#### P1-04 — Migrate town, entity, and actor identity

**Depends on:** `P1-02`

**Tables:** `towns`, `story_entities`, `actors`, `players`, `npcs`,
`npc_contact_edges`

**Deliverables**

- Accepted status domains and resolution-field presence rules on `towns`.
- Composite town-owned identities and type-discriminated story-entity and actor
  foreign keys.
- Actor subtype checks, one NPC per authored character, actor/name uniqueness,
  directional contact trust range, and no self-contact edge.
- Indexes supporting normalized display-name lookup and entity stable keys.

**Acceptance checks**

- A player actor cannot acquire an NPC subtype, an NPC cannot portray an item,
  Lark can exist without an actor, and an actor parent without its required
  subtype is detected by the inspection invariant.
- No child row can point at an identity in another town.

#### P1-05 — Migrate creation, join, session, rate-limit, and visit state

**Depends on:** `P1-04`

**Tables:** `town_creation_requests`, `join_requests`, `player_sessions`,
`api_rate_limits`, `player_visits`

**Deliverables**

- All processing-claim and terminal-field checks for creation and join
  ledgers, including content/security-version freezing.
- Join replay closure, secret-hash presence, issue-count `0..3`, session
  status, and cookie-issuance metadata constraints.
- Token-bucket storage and pruning index without raw IP fields.
- At-most-one-active-visit partial uniqueness, checked location type, visit
  bounds, action references, and end-reason consistency.
- Required stale-work, replay-expiry, session, rate-limit, and active-visit
  indexes.

Repository behavior for these records is deferred until the route-owning
phases; this task makes invalid states unrepresentable where the schema contract
requires it.

#### P1-06 — Migrate authored truth, evidence, and item state

**Depends on:** `P1-04`

**Tables:** `world_facts`, `case_solutions`, `inspectables`, `items`,
`player_capabilities`, `clues`, `clue_claim_effects`, `clue_discoveries`

**Deliverables**

- One private solution per town with type-safe culprit, motive, location, and
  required item references.
- Type-safe inspectable locations/linked items, exactly-one item custody,
  immutable reveal identity, item revisions, and capability lifecycle checks.
- Unique authored clue keys, exact clue kinds, signed clue-effect domains, and
  one discovery per player/clue.
- Foreign keys that make the item row authoritative while allowing a linked
  inspectable to become unavailable after custody moves.

#### P1-07 — Migrate claims, dialogue records, provenance, and memory

**Depends on:** `P1-04`

**Tables:** `claims`, `claim_relations`, `claim_drafts`, `npc_interactions`,
`claim_transmissions`, `episodes`, `episode_references`

**Deliverables**

- Database-enforced claim predicate/type matrix, polarity, context, normalized
  key uniqueness, and relation domain.
- Claim-draft lifecycle and presence checks binding a draft to player, visit,
  NPC, normalization action, expiry, and optional exact alleged source.
- Immutable accepted interaction records and response modes.
- Transmission source-kind presence rules, speaker/recipient separation,
  event/ordinal identity, parent/root consistency support, and hop range through
  terminal NPC-to-player hop `4`.
- Immutable episode identity/reference fields, importance `0..100`, embedding
  status/vector consistency, and the sole allowed pending/failed-to-ready
  derived-vector update path.

Cross-row provenance rules that SQL cannot express cleanly remain repository
validators and Phase 2 pure functions; integration tests still prove they
cannot be bypassed through supported writes.

#### P1-08 — Migrate beliefs and relationship ledgers

**Depends on:** `P1-06`, `P1-07`

**Tables:** `npc_beliefs`, `belief_evidence`, `npc_player_relationships`,
`relationship_changes`

**Deliverables**

- Score ranges, labels, revisions, and current-row uniqueness.
- Append-only evidence kinds with exact source-column presence checks for
  testimony, clues, corroboration, mirrors, and reversals.
- Repeat-protection partial uniqueness for independent testimony, clue effects,
  mirrors, reversals, corroboration thresholds, and relationship triggers.
- Typed relationship reasons and source references, with trust/suspicion range
  constraints and event-linked current state.
- Accepted lookup/timeline indexes.

#### P1-09 — Migrate promises and case progress

**Depends on:** `P1-06`, `P1-07`, `P1-08`

**Tables:** `promises`, `case_board_entries`, `case_attempts`,
`town_resolutions`

**Deliverables**

- Promise kind/subject exclusivity, irreversible state, typed accepted/resolved
  events, terms version, and partial uniqueness for active promises.
- Board entry/verification-shape checks for evidence, testimony, hearsay, and
  notes, plus note-length validation at the application write boundary where
  grapheme counting is required.
- Type-safe immutable accusation tuples and one irreversible resolution per
  town.
- Timeline indexes and foreign keys to contributions, transmissions, attempts,
  and events.

#### P1-10 — Migrate action, event, model-run, and ambient operations

**Depends on:** `P1-05`, `P1-07`, `P1-09`

**Tables:** `player_actions`, `world_events`, `agent_runs`,
`model_cost_reservations`, `outbox`, `ambient_job_executions`

**Deliverables**

- Player-action kinds, processing/retryable/completed/failed field presence,
  one processing action per player, request identity, and retry/stale indexes.
- World-event origins, typed references, sequence/effect uniqueness, accepted
  event types, numbered player/ambient effects, and versioned JSON payload
  boundary.
- All deferred cyclic foreign keys among actions, visits, events, interactions,
  episodes, evidence, relationships, promises, case records, current-state
  event references, outbox, and ambient executions.
- Agent-run purposes, outcomes, prompt/input/schema/validator metadata,
  embedding-versus-structured presence rules, token/latency/cost domains, and
  causal sources.
- Durable model-cost admission reservations keyed by source/purpose/attempt,
  with UTC billing month, worst-case amount, reserved/settled/released states,
  action/job/event/non-game source identity, immutable price version,
  actual-cost settlement, optional run linkage, and indexes for serializable
  monthly admission. An ambiguous invocation retains its maximum reservation.
- Outbox delivery states, send claims, canonical range columns, job identity,
  and transition deadlines.
- Ambient execution identity, matching outbox job/payload hash, processing/
  completed/quarantined shapes, action count `0..2`, and stale-work indexes.

**Application-bound JSON checks**

Repository writers must validate `player_actions.request_payload`, saved
response payload, `world_events.payload`, and `outbox.payload` with their
versioned Zod contracts before executing SQL. JSONB is not a substitute for
the accepted typed envelopes.

#### P1-11 — Add all remaining required indexes and schema-audit tests

**Depends on:** `P1-04` through `P1-10`

**Deliverables**

- Every index listed under Decision 005's “Required indexes,” including the
  vector index on ready episode embeddings with `town_id` and `npc_id` prefix
  columns and the monthly/source indexes required for model-cost admission.
- Catalog-based tests proving tables, columns, types, constraints, foreign-key
  town scoping, indexes, and views match the accepted inventory.
- A documented fallback for CockroachDB versions that cannot predicate the
  vector index: index the supported shape and require query-side
  `embedding_status = 'ready'` exclusion exactly as Decision 005 permits.

### Workstream C — Kysely access and transaction safety

#### P1-12 — Implement the bounded database client

**Depends on:** `P1-03`, `P1-11`

**Deliverables**

- `pg` pool factory used by runtime packages with `sslmode=verify-full`, a
  three-second connection timeout, and maximum pool size two per warm Lambda
  environment.
- Statement timeout set to the smaller of three seconds and the remaining
  operation budget; transaction deadline no greater than five seconds or the
  remaining budget.
- Separate operator client construction unavailable to runtime packages.
- Safe connection telemetry containing category, latency, and stable error
  code but never a connection string, password, SQL parameter, or credential.

Local test configuration may use the disposable harness's certificate mode;
production defaults must fail closed to full verification.

#### P1-13 — Generate and govern Kysely database types

**Depends on:** `P1-11`, `P1-12`

**Deliverables**

- Database interface covering all 40 tables and read-only inspection views.
- A reproducible generation/introspection command or, if generation cannot
  model CockroachDB vector/composite details, a reviewed declared mapping plus
  drift tests.
- Narrow row/select/insert/update types that keep immutable/history tables from
  exposing general update methods.
- Branded or dedicated adapters for UUID, bytes, decimal cost, JSONB, UTC time,
  and `VECTOR(256)`.

#### P1-14 — Implement serializable transaction and ambiguous-commit helpers

**Depends on:** `P1-12`, `P1-13`

**Deliverables**

- `SERIALIZABLE` transaction wrapper that retries SQLSTATE `40001` at most
  three times with jitter around 25 ms, 75 ms, and 225 ms, subject to the
  operation deadline.
- Full-body replay semantics that re-check every conditional write.
- An explicit ambiguous-commit result requiring the caller to read its durable
  operation identity before any retry; no blind write retry.
- Instrumentation for retry count, timeout category, and terminal stable error
  code without SQL values.
- Deterministic tests using injected jitter/clock and CockroachDB integration
  tests that force a real serialization conflict.

### Workstream D — Versioned authored content and town materialization

#### P1-15 — Encode the `bell-mystery-v1` content registry

**Depends on:** `P0-04`, `P0-05`; may start alongside schema work

**Deliverables**

- Immutable TypeScript content object keyed by `bell-mystery-v1`, explicitly
  mapped to `mvp-rules-v1`.
- Exact authored values from Decision 009: four characters, three NPCs, four
  locations, three motives, four items, stable claim catalog/relations,
  disclosure tiers, contact graph, inspectables, seven clues/effects, promise
  terms, accusation option order, ending data, fallback dialogue, scene keys,
  portrait keys, and presentation copy.
- Fixed relative seed times and stable ordering keys for the accident,
  pre-story communications, bell move, protective decision, and three dawn
  observations.
- Registry access by frozen content version; no “latest” lookup when operating
  on an existing town.

Database rows store relational state and content keys. Full versioned authored
copy may remain in the TypeScript registry where Decision 005 assigns it; this
task must not introduce a CMS or duplicate arbitrary prose into JSONB.

#### P1-16 — Build static content validation

**Depends on:** `P1-15`

**Deliverables**

- Validation for unique stable keys and all same-version references.
- Claim predicate/type/context/polarity validation and deterministic relation
  symmetry/duplicate checks.
- The shared `claim-key:v1` encoder fixed by Decision 005, using canonical JSON
  over entity types, frozen entity keys, predicate, polarity, and context; seed
  fixtures prove identical propositions cannot diverge between content and
  runtime normalization or collide through display-copy/UUID differences.
- Validation of solution IDs, item custody, linked inspectables, clue effects,
  required clues, NPC locations, contact edges, disclosure references,
  promise subjects/terms versions, asset keys, fallback keys, and accusation
  option order.
- Starting-knowledge boundary assertions: Mara has no chapel location, Nessa
  has no cart-load knowledge, and Corin alone has the complete truth.
- Content fingerprints or fixtures that make accidental accepted-copy drift
  reviewable.

No Phase 2 calculations are duplicated here. Rule-dependent reachability and
balance validation are added in `P2-19` against this registry. Claim identity
is deliberately earlier than those calculations because Phase 1 must insert
canonical seeded claims before Phase 2 begins.

#### P1-17 — Implement transactional town materialization

**Depends on:** `P1-14`, `P1-16`

**Deliverables**

- A town factory that takes the frozen content version, creation timestamp,
  and caller-supplied secure invite-token hash/operational identity as typed
  inputs and inserts one complete seed transactionally.
- Opaque generated town-owned IDs with a returned stable-key-to-ID map used
  only inside materialization/testing; gameplay never depends on UUID shape.
- Seed rows for authoritative truth/current state and all initial causal
  history, including distinct `system_seed` `authored_observation` events for
  every direct observation and one `system_seed` `claim_transmitted` event for
  each pre-story communication.
- Correct episode/transmission/evidence links, direct-observation `+80`
  evidence, Corin-to-Mara `+44` testimony, Corin-to-Nessa `+40` testimony,
  initial belief labels, item custody/reveal state, and zero player records.
- Every seeded claim key is produced through the shared `claim-key:v1` encoder;
  no seed-only precomputed or display-text-derived identity path is allowed.
- After the final `system_seed` event is inserted, set
  `ambient_scheduled_through_sequence = last_event_sequence` in the same
  transaction. Authored backstory is inspectable history but is already outside
  every future player-triggered ambient range; every seed event stores
  `ambient_eligible = false` as an additional contract assertion.
- Atomic failure: a validation or insert failure leaves no partial town.

The service does not derive or expose invite plaintext. Phase 3 supplies the
versioned HMAC and durable public town-creation request behavior.

#### P1-18 — Add repeatable seed and inspection fixtures

**Depends on:** `P1-17`, `P1-20`

**Deliverables**

- CLI/test fixture that creates a fresh town and returns only its town ID plus
  a safe inspection summary.
- A repeatability test creating two equivalent content-version towns with
  different opaque IDs and proving complete tenant isolation.
- A rollback test that injects a mid-materialization failure and observes no
  town or orphan row.
- Seed assertions covering exact stable-key sets, event ordering, causal
  origins, solution, initial custody, hidden/revealed state, and initial
  beliefs, plus exact claim-key fixtures and equality of the post-seed ambient
  boundary and final seed event sequence with all seed events ambient-ineligible.

This fixture is test-only. Production and demo towns are created through the
Phase 3 town-creation ledger and versioned invite derivation, never by exposing
or extending this direct materializer CLI.

### Workstream E — Inspection and exhaustive database verification

#### P1-19 — Create the read-only `inspection` schema

**Depends on:** `P1-11`, `P1-13`

**Deliverables**

- Accepted views:
  `inspection.npc_beliefs`, `inspection.belief_evidence`,
  `inspection.claim_paths`, `inspection.relationship_timeline`,
  `inspection.promise_status`, `inspection.object_history`,
  `inspection.objective_truth`, `inspection.case_progress`,
  `inspection.world_event_timeline`, `inspection.agent_runs`,
  `inspection.idempotency_status`, `inspection.ambient_jobs`, and
  `inspection.access_operations`.
- Human-inspectable stable keys/display names alongside opaque IDs where useful,
  deterministic causal ordering, explicit origin/event relationships, and safe
  cost-reservation/settlement status joined into `inspection.agent_runs`.
- Exclusion of invite/session/join hashes, cookies, raw processing tokens,
  database secrets, raw prompts, invalid model output, and credential material.
- Grants proving inspection is read-only and player runtime does not depend on
  these views.

#### P1-20 — Prove schema invariants on CockroachDB

**Depends on:** `P1-03`, `P1-11`, `P1-14`, `P1-17`, `P1-19`

**Deliverables**

- Integration tests for every cross-town foreign key family and every closed
  domain/state presence check.
- High-risk constraint tests for actor/entity subtypes, normalized-name
  collisions, exactly-one item custody, active visits/promises, clue discovery,
  action/event effect identity, draft isolation, testimony/reversal/mirror
  uniqueness, model-cost reservation admission/settlement, ambient ranges, and
  resolution uniqueness.
- Concurrent tests showing conditional constraints allow only one unique-item
  owner, one active player action, and one town resolution.
- Vector insert/index/query tests proving town/NPC prefix filtering and
  ready-embedding exclusion.
- Grant tests and inspection-view reconstruction on seeded data.

#### P1-21 — Document migration, seed, audit, and recovery operations

**Depends on:** `P1-18`, `P1-20`

**Deliverables**

- Commands for starting/targeting the test database, migrating, validating,
  creating a seed town, querying inspection views, and cleaning only the
  disposable test target.
- Forward-fix procedure for a failed migration; no destructive reset as the
  normal recovery path.
- Schema-change checklist requiring accepted-contract review, migration,
  Kysely drift update, grant review, seed compatibility, and integration tests.
- Safe logging guidance and a note that production credentials, cluster
  creation, and managed MCP setup remain Phase 7.

## 5. Artifacts

| Area | Artifacts |
|---|---|
| SQL | Ordered forward migrations, role/grant bootstrap, 40 tables, constraints, indexes, vector index, inspection views |
| Database package | Bounded `pg` pool, Kysely types, query helpers, serializable retry/ambiguous-commit primitives |
| Content package | Immutable `bell-mystery-v1` registry, `mvp-rules-v1` mapping, static validators, content fixtures |
| Seeding | Transactional town materializer and test-only seed fixture; no production invite bypass |
| Verification | Catalog audit, grant tests, CockroachDB integration suites, concurrency/vector/tenant/inspection seed tests |
| Documentation | Migration/seed/audit/recovery runbook and schema-change checklist |

## 6. Dependencies and sequencing

```text
Phase 0 -> P1-01 -> P1-02 -> P1-03
P1-02 -> P1-04
P1-04 -> P1-05
P1-04 -> P1-06
P1-04 -> P1-07
P1-06 + P1-07 -> P1-08 -> P1-09
P1-05 + P1-07 + P1-09 -> P1-10
P1-04..P1-10 -> P1-11 -> P1-12 -> P1-13 -> P1-14
P0-04 + P0-05 -> P1-15 -> P1-16
P1-14 + P1-16 -> P1-17
P1-11 + P1-13 -> P1-19
P1-03 + P1-11 + P1-14 + P1-17 + P1-19 -> P1-20
P1-17 + P1-20 -> P1-18
P1-18 + P1-20 -> P1-21
```

Schema groups `P1-05`, `P1-06`, and `P1-07` can be developed in parallel
after identity tables stabilize. Content tasks `P1-15` and `P1-16` can proceed
in parallel with SQL. Town materialization waits for both the transaction
boundary and the validated content registry. Inspection views wait for the
complete schema but should precede final seed acceptance so the proof uses the
actual judge-facing read model.

## 7. Verification matrix

Commands below are planned interfaces introduced by this phase.

| Concern | Verification | Planned command |
|---|---|---|
| Database compatibility | Real CockroachDB version/vector capability check | `pnpm db:doctor:test` |
| Fresh migration | Apply all migrations to an empty disposable database | `pnpm db:migrate:test` |
| Repeat migration | Re-run the migration command with no drift or duplicate DDL | `pnpm db:migrate:test` |
| Schema inventory | Assert 40 tables, exact required views, columns, types, constraints, FKs, and indexes | `pnpm test:db -- schema-audit` |
| Roles and secrets | Verify migration/runtime/inspection grants and denied credential-bearing access | `pnpm test:db -- grants` |
| Cross-town isolation | Reject cross-town references for every FK family and scope queries | `pnpm test:db -- tenant-isolation` |
| State invariants | Exercise subtype, custody, state-machine, presence, uniqueness, and JSON writer checks | `pnpm test:db -- constraints` |
| Serialization | Force `40001`, verify bounded full-body retries and deadline stop | `pnpm test:db -- transaction-retry` |
| Ambiguous commit | Require ledger read before a possible retry | `pnpm test:db -- ambiguous-commit` |
| Concurrency | Race item ownership, processing-action uniqueness, and resolution insert | `pnpm test:db -- concurrency` |
| Vector boundary | Insert/query 256-dimension episodes; enforce town/NPC/ready filters | `pnpm test:db -- vector` |
| Content | Validate all stable keys, claim-key encoding, references, copy bindings, starting knowledge, and versions | `pnpm test:content` |
| Seed | Materialize fresh town, verify exact initial state/history, post-seed ambient boundary, and all-or-nothing rollback | `pnpm db:seed-test` |
| Repeatable isolation | Materialize two equivalent towns and prove no shared town-owned IDs/references | `pnpm test:db -- seed-isolation` |
| Inspection | Reconstruct seed beliefs, evidence, provenance, custody, truth, and events; reject writes and secrets | `pnpm test:db -- inspection` |
| Whole phase | Phase 0 gates plus all required CockroachDB/content tests | `pnpm validate` |

CI must run the required database suite against CockroachDB. Unit-only or mock
coverage cannot satisfy the phase exit gate.

## 8. Risks, decisions, and fallback strategy

| Risk or decision | Plan | Fallback / escalation |
|---|---|---|
| Local/CI CockroachDB provisioning is not specified | Decide the disposable test mechanism in `P1-01` and pin a compatible version | A remote disposable test database is acceptable if credentials are isolated and cleanup targets are validated; PostgreSQL substitutes are not |
| CockroachDB partial vector-index syntax differs by version | Detect capability in `P1-01` and use the accepted query-side ready filter when a predicate is unsupported | Record the exact index form and revisit only with measured query evidence |
| Some cross-row provenance/state rules cannot be expressed as checks | Enforce relationally where possible and expose all supported writes through validated repositories | Add transaction-time validators plus direct-SQL negative tests; do not remove composite FKs or uniqueness |
| Type generation may mishandle `VECTOR`, `BYTES`, `DECIMAL`, or composite keys | Add explicit adapters and schema-drift assertions | Maintain reviewed declared Kysely types if generation is less reliable than a checked mapping |
| Inspection view column lists are not fully enumerated in Decision 005 | Design the smallest fields needed to explain each accepted causal path and test secret exclusions | Treat adding credential-bearing/raw-untrusted fields as prohibited; seek a contract amendment if a judge workflow needs new authority |
| Repeatable seed could be mistaken for stable UUID reuse | Make authored keys/content/order stable while generating opaque town-local IDs | Tests compare semantic stable-key projections, never equality of UUIDs across towns |
| Role creation may require cluster-level authority unavailable in CI | Separate role-bootstrap verification from per-database migration while retaining a required environment that proves grants before phase exit | Never run application tests as the migration administrator as a shortcut |
| Exact schema and content implementation may expose a contract contradiction | Stop the affected task and reconcile Decisions 005/008/009 together | Do not encode divergent behavior in SQL, TypeScript seed, or tests |

Fallbacks may preserve an episode with `embedding_status = 'pending'` or
`failed`, but may not omit the episode, widen vector scope, or change objective
truth. A seed failure rolls back; it never leaves a partially playable town.

## 9. Exit checklist

- [ ] `P1-01` through `P1-21` are complete with artifact links.
- [ ] A fresh CockroachDB target migrates successfully and the migration command
  is safe to run again.
- [ ] Catalog audit proves all 40 accepted tables, required constraints,
  composite town-scoped foreign keys, indexes, and 13 inspection views exist.
- [ ] `app_runtime` has only required runtime rights; the inspection identity is
  read-only; application packages cannot access operator credentials.
- [ ] Kysely types and adapters match the migrated schema, including
  `VECTOR(256)`, `BYTES`, `DECIMAL`, JSONB, and composite identities.
- [ ] Serializable retry stops at the accepted bound and ambiguous commits read
  the durable ledger before retrying.
- [ ] `bell-mystery-v1` validates and maps immutably to `mvp-rules-v1`.
- [ ] Town materialization commits all exact seed state/history atomically and
  emits all required `system_seed` causal events.
- [ ] Seeded and dynamically normalized propositions share the frozen
      `claim-key:v1` encoder, and the seed fixture rejects key drift or
      collision.
- [ ] The completed seed sets `ambient_scheduled_through_sequence` equal to the
      final seed `last_event_sequence`, all seed events are ambient-ineligible,
      and the first player Leave cannot schedule authored backstory.
- [ ] Initial beliefs, evidence weights, provenance, item custody, required
  clues, solution, knowledge boundaries, and content keys match Decision 009.
- [ ] Two seeded towns are semantically equivalent but share no town-owned
  identity or reference.
- [ ] Invalid cross-town/domain/state data is rejected, and concurrency tests
  permit only one winner for unique state.
- [ ] Vector queries are town/NPC scoped and exclude non-ready embeddings.
- [ ] Inspection views reconstruct the seed and expose no hashes, cookies,
  secrets, raw processing tokens, prompts, or invalid model output.
- [ ] The full database/content suite passes against CockroachDB in the required
  phase-exit environment.

## 10. Handoff to Phase 2

Phase 2 consumes the immutable content registry, database-shaped domain types,
and tested persistence invariants, but implements gameplay rules as pure code.
Specifically it reuses:

- `P1-13` types/adapters for exact persisted inputs and planned effects;
- `P1-15`/`P1-16` stable keys, rules-version mapping, gates, content bindings,
  option order, and authored fallback coverage;
- `P1-17` seed snapshots as initial-state rule fixtures; and
- `P1-19` inspection semantics for causal explanations.

Phase 2 must not make database queries from rule functions or duplicate SQL
constraints as a separate authority. It should return deterministic effect
plans that later application services commit through Phase 1 repositories. Any
balance or content change creates a new accepted version rather than modifying
`mvp-rules-v1` or `bell-mystery-v1` in place.
