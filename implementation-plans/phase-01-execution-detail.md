# Phase 1 — Execution Detail

- **Status:** Complete. Execution record for
  [Phase 1 — Persistence and Authored Seed](phase-01-persistence-and-authored-seed.md)
- **Scope:** Measured database capabilities, package layout, migration file plan,
  exact seed inventory, module contracts, test cases, and command definitions for
  `P1-01` through `P1-21`
- **Authority:** This document refines *how* Phase 1 is built. It never redefines
  *what* decisions 001–011 accept. Where the phase plan and an accepted decision
  disagree, the decision wins and the discrepancy is recorded in section 10.

## 0. Completion state

All twenty-one goals are met. `pnpm validate` passes end to end, including 496
tests of which 148 run against a real CockroachDB node.

| Work | Commits |
|---|---|
| `P1-01` CockroachDB harness and capability probe | `01311f5`, `c3da1f4` |
| `P1-02`/`P1-03` Migration runner, ledger, roles | `88b1142`, `3a66905` |
| `P1-04`–`P1-10` The forty tables and deferred keys | `a897ffc`, `082a973`, `0757ded`, `baa7843` |
| `P1-11` Required indexes and the catalog audit | `d2e18a0` |
| `P1-19` Inspection views and least-privilege grants | `5282c75` |
| `P1-12`/`P1-14` Bounded pool and serializable transactions | `b9b7f58` |
| `P1-15`/`P1-16` Content registry and validation | `57a54f7` |
| `P1-17`/`P1-18` Town materialization and seed fixtures | `5674282` |
| `P1-20` Invariant, vector, concurrency, and inspection suites | `1c6cac7`, `2c2c387` |
| `P1-13` Generated Kysely interface | `b079d2d` |
| `P1-21` Documentation | `2c2c387`, `b079d2d` |

Deviations from the plan below, each made during execution and each recorded
where it was made:

1. **Migration order swapped.** `0004` is claims and memory, `0005` is authored
   truth. `world_facts` and `clue_claim_effects` reference `claims`, so putting
   claims first removed four deferred foreign keys rather than staging them.
2. **`episode_references` gained a surrogate key.** Without one CockroachDB adds
   a hidden `rowid`, which would appear in the catalog audit as an unexplained
   column.
3. **Two provenance rules became foreign keys.** A stored `parent_eligible`
   computed column proved sufficient to make "no hop-4 transmission may become a
   parent" a key rather than a repository validator, and a
   `recipient_actor_type` discriminator does the same for the NPC hop-3 ceiling.
   Both were verified against the engine before being relied on.
4. **`D1-D` reversed: types are generated, not hand-declared.** Generating from
   the committed snapshot gives a chain the audit already anchors, where a
   hand-written interface would be an independent claim needing its own proof.
5. **The database suite runs one file at a time.** Six concurrent migration runs
   against one local node turned a fast suite into a 120-second timeout, and
   CockroachDB serializes schema changes regardless.
6. **Constraint assertions read the driver's `constraint` field.** CockroachDB
   prints the check *expression* in the message, so message matching would break
   whenever a rendered domain list changed.

## 1. Feasibility spike

Phase 1 depends on database behavior that the accepted decisions assume but do
not prove. The following was measured before planning, not inferred.

Target: `cockroach-v25.4.3.darwin-11.0-arm64`, `start-single-node --insecure`.

| Question | Result |
|---|---|
| Is a native `darwin-arm64` binary published? | Yes, `binaries.cockroachdb.com/cockroach-v25.4.3.darwin-11.0-arm64.tgz`. `aarch64` is not a valid name; `arm64` is |
| `VECTOR(256)` column | Supported |
| `CREATE VECTOR INDEX ix ON t (town_id, npc_id, embedding)` | Supported |
| The same index with `WHERE embedding_status = 'ready'` | **Supported.** Decision 005's non-predicated fallback is not required at this version |
| `ORDER BY embedding <-> $1` with prefix equality filters | Supported |
| Vector literals | Text form `'[0.5,…]'::VECTOR(256)`. `array_fill()` does not exist |
| Composite FK to `(town_id, id, entity_type)` with a checked constant column | Supported |
| Partial unique index (`… WHERE status = 'active'`) | Supported |
| `CREATE ROLE`, `CREATE SCHEMA`, `GRANT` on a single node | Supported |
| DDL inside an explicit transaction | **Auto-commits by default.** `autocommit_before_ddl` defaults to `on` in v25.4, so `BEGIN; CREATE TABLE …` silently commits |
| DDL inside a transaction with `SET autocommit_before_ddl = false` | Truly transactional. A `ROLLBACK` discarded both `CREATE TABLE` statements |
| `SHOW default_transaction_isolation` | `serializable` |

Two of these change the plan. The predicated vector index removes the `P1-11`
fallback branch from the critical path, and `autocommit_before_ddl` makes
"transaction-safe migration execution where CockroachDB supports it" an explicit
session setting rather than a hope.

## 2. Implementation decisions

Structural choices Phase 1 is permitted to make, recorded so later phases
inherit them.

| ID | Decision | Rationale |
|---|---|---|
| `D1-A` | The test database is a pinned CockroachDB binary (`v25.4.3`) downloaded into a gitignored `.cockroach/`, run as `start-single-node --insecure`. Not Docker | The Docker daemon is not reliably running on the development machine, an arm64 binary is published, and a single node satisfies every schema, constraint, grant, vector, and serialization-conflict check the phase promises |
| `D1-B` | Every migration file runs inside one transaction with `autocommit_before_ddl = false`, together with its ledger row | Section 1 shows the default silently commits partial DDL, which would leave a half-migrated schema with no ledger entry |
| `D1-C` | The vector index is created with its `embedding_status = 'ready'` predicate, and recall queries still filter `embedding_status = 'ready'` explicitly | The predicate is supported here, but the query-side filter keeps the accepted fallback shape correct on any cluster that lacks it |
| `D1-D` | Kysely types are generated from the committed schema snapshot and drift-tested against it, not hand-declared (revised during execution; see section 0) | The audit already proves the snapshot matches a freshly migrated database, so generating from it extends a chain that is anchored. Branded types and update narrowing come from the generator's own rules rather than from a generator's defaults |
| `D1-E` | Four new workspace packages: `database`, `database-admin`, `content`, `town-seed` | One package per artifact row of the phase plan. `content` has no database dependency, so authored data stays testable without a cluster, and only `database-admin` may read the operator credential |
| `D1-F` | `claimKeyV1()` lives in `packages/content` and is implemented as `domainSeparatedPreimage("claim-key:v1", tuple)` from `@the-town-remembers/serialization` | Decision 005 defines `claim-key:v1` as the representation, not its hash. Phase 0 already exported the pre-image builder separately for exactly this |
| `D1-G` | New configuration category `runtime-config/database` supplies `TTR_DATABASE_URL` for `app_runtime`. `TTR_MIGRATION_DATABASE_URL` stays operator-only. `TTR_TEST_DATABASE_URL` joins the test category | Keeps the three credentials in three categories with three import boundaries the workspace check can enforce |
| `D1-H` | Constraint naming: `pk_<table>`, `uq_<table>__<cols>`, `ix_<table>__<cols>`, `ck_<table>__<rule>`, `fk_<table>__<target>`; views are `inspection.<name>` | Deterministic names make the catalog audit an equality check instead of a pattern match |
| `D1-I` | Every closed string domain is declared once in `packages/database/src/domains.ts` and rendered into SQL `CHECK` text by the migration authoring step; a test asserts each SQL check lists exactly the TypeScript union | Decision 005 chose `STRING` + `CHECK` over enum types; without this the two drift silently |
| `D1-J` | Migration ledger `public.schema_migrations(version, name, checksum, applied_at)`. A checksum change on an applied version is a hard failure with a forward-fix instruction | Forward-only migrations with no destructive reset as the normal recovery path |
| `D1-K` | Database tests are a new vitest project `database`, opt-out only through `TTR_SKIP_DB_TESTS=1`. `pnpm validate` refuses that opt-out | The phase plan requires the exit gate to run them against real CockroachDB |
| `D1-L` | The disposable scope is one CockroachDB *database* per test file, named `ttr_test_<random>`. Teardown drops only names matching that prefix | A validated target means a typo cannot drop a real database |
| `D1-M` | `contradicts` claim relations are stored in both directions; `entails` is stored one way | Decision 005 makes `(claim_a, claim_b, kind)` unique and directional, while contradiction is semantically symmetric. Two rows make mirror lookup a single-direction query with no special case |
| `D1-N` | The content registry declares `seedEvents` as an explicitly ordered array. `sequence_no` is index + 1, and `occurred_at` comes from the authored offset | Decision 009 says ties break on "stable event and episode IDs", but the IDs are generated per town. An authored order is deterministic *and* reviewable |
| `D1-O` | `world_events` typed columns are populated only when the event concerns exactly one value of that kind. An `authored_observation` covering three claims leaves `claim_id` null and names all three through `episode_references` | Decision 005 calls typed columns "important domain references", not a complete projection. Picking an arbitrary first claim would invent authority |
| `D1-P` | Seed materialization takes `createdAt` as a typed input and derives every offset from it. Nothing inside the transaction reads a clock | Repeatability tests must compare two towns exactly |

## 3. Dependency selection

Only these new external dependencies enter the workspace in Phase 1.

| Package | Where | Why |
|---|---|---|
| `pg` | `packages/database` | Decision 002 fixes `pg` as the driver |
| `@types/pg` | root | Typings for the above |
| `kysely` | `packages/database` | Decision 002 fixes Kysely as the query builder |

No AWS SDK, secrets client, or model client is installed. The CockroachDB binary
is downloaded by a script into a gitignored directory; it is not an npm
dependency, so `pnpm install --frozen-lockfile` stays offline-equivalent.

## 4. Planned file layout

```text
.cockroach/                       gitignored: pinned binary and disposable store

scripts/
  cockroach.mjs                   ensure / start / stop / status for the pinned binary
  cockroach.test.mjs
  db-doctor.mjs                   version and capability probe
  db-migrate.mjs                  operator migration entry point
  db-seed.mjs                     test-only seed CLI

packages/database/src/
  index.ts
  domains.ts        every closed string domain, shared by SQL checks and types
  brands.ts         Uuid, Sha256Bytes, UsdCost, Utc, Vector256 branded types
  codecs.ts         pg <-> TypeScript conversion for the above
  payloads.ts       versioned Zod schemas for JSONB write boundaries
  schema.ts         the Kysely `Database` interface: 40 tables, 13 views
  client.ts         bounded pg pool factory for app_runtime
  transaction.ts    serializable retry and ambiguous-commit primitives
  errors.ts         stable error categories carrying no SQL values
  telemetry.ts      safe connection and transaction events

packages/database-admin/
  migrations/       0001…0013 forward-only .sql files
  src/
    index.ts
    operator-client.ts   the only reader of runtime-config/operator
    ledger.ts            schema_migrations create, read, append, checksum
    runner.ts            ordered forward-only application
    introspection.ts     catalog readers used by the schema audit
    expected-schema.ts   the accepted inventory as data

packages/content/src/
  index.ts
  versions.ts       CONTENT_VERSION, RULES_VERSION and their mapping
  claim-key.ts      the frozen claim-key:v1 encoder
  entities.ts       characters, locations, items, motives
  claims.ts         the twelve-claim catalog and its relations
  world.ts          world facts and the private solution
  npcs.ts           profiles, contact edges, disclosure tiers, greetings
  inspectables.ts   inspectables, clues, clue claim effects
  seed-events.ts    the ordered eleven seed events, episodes, transmissions
  promises.ts       promise terms versions and offers
  copy.ts           fallbacks, denials, endings, presentation and asset keys
  registry.ts       the frozen assembled registry, looked up by version
  validate.ts       static validation over the assembled registry

packages/town-seed/src/
  index.ts
  plan.ts           pure content + inputs -> an ordered row plan
  materialize.ts    one transaction that writes the plan
  summary.ts        the safe inspection summary
  ids.ts            stable-key -> generated UUID map

packages/test-support/src/database/
  harness.ts        disposable database lifecycle
  catalog.ts        assertion helpers over introspection results
```

## 5. The forward migration set

| File | Owner task | Contents |
|---|---|---|
| `0001_bootstrap.sql` | `P1-02`, `P1-03` | `schema_migrations`, `inspection` schema, `app_runtime` / `inspection_reader` roles |
| `0002_town_identity.sql` | `P1-04` | `towns`, `story_entities`, `actors`, `players`, `npcs`, `npc_contact_edges` |
| `0003_operations.sql` | `P1-05` | `town_creation_requests`, `join_requests`, `player_sessions`, `api_rate_limits`, `player_visits` |
| `0004_authored_truth.sql` | `P1-06` | `world_facts`, `case_solutions`, `inspectables`, `items`, `player_capabilities`, `clues`, `clue_claim_effects`, `clue_discoveries` |
| `0005_claims_memory.sql` | `P1-07` | `claims`, `claim_relations`, `claim_drafts`, `npc_interactions`, `claim_transmissions`, `episodes`, `episode_references` |
| `0006_beliefs.sql` | `P1-08` | `npc_beliefs`, `belief_evidence`, `npc_player_relationships`, `relationship_changes` |
| `0007_progress.sql` | `P1-09` | `promises`, `case_board_entries`, `case_attempts`, `town_resolutions` |
| `0008_operations_ledger.sql` | `P1-10` | `player_actions`, `world_events`, `agent_runs`, `model_cost_reservations`, `outbox`, `ambient_job_executions` |
| `0009_deferred_keys.sql` | `P1-10` | Every cyclic foreign key that could not be declared inline |
| `0010_indexes.sql` | `P1-11` | Every entry under Decision 005 "Required indexes" not already implied |
| `0011_vector_index.sql` | `P1-11` | The predicated vector index on `episodes` |
| `0012_inspection_views.sql` | `P1-19` | The thirteen accepted views |
| `0013_grants.sql` | `P1-03`, `P1-19` | Final `app_runtime` DML and `inspection_reader` read grants |

Table count check: `6 + 5 + 8 + 7 + 4 + 4 + 6 = 40`.

## 6. Task-level execution detail

### `P1-01` — CockroachDB integration harness

`scripts/cockroach.mjs` exposes `ensure`, `start`, `stop`, `status`. `ensure`
downloads the pinned tarball to `.cockroach/` when the binary is absent and
verifies `cockroach version` reports the pinned build. `start` runs
`start-single-node --insecure` on `TTR_TEST_DB_PORT` (default `26257`) with its
store under `.cockroach/data`, and is idempotent.

`packages/test-support/src/database/harness.ts` exports:

- `createDisposableDatabase()` → connects with the admin DSN, creates
  `ttr_test_<12 random base36 chars>`, applies every migration, and returns
  `{ name, adminUrl, runtimeUrl, dispose() }`.
- `dispose()` asserts the name matches `/^ttr_test_[a-z0-9]{12}$/` before
  issuing `DROP DATABASE`. A name that fails the check throws instead of
  dropping.

Opt-out is `TTR_SKIP_DB_TESTS=1`, which makes the `database` project report
skipped suites. `pnpm validate` sets `TTR_REQUIRE_DB_TESTS=1`, and the global
setup throws when both are present.

**Acceptance**

1. `pnpm db:doctor` on a running node prints the version and four capability
   results and exits `0`.
2. `pnpm db:doctor` against a target without `VECTOR` support exits non-zero and
   names the missing capability (proved with an injected probe result).
3. `dispose()` refuses a name outside the prefix.
4. No PostgreSQL, SQLite, in-memory, or mock adapter exists anywhere in the
   database packages; a source scan test asserts it.

### `P1-02` — Forward-migration discipline

`ledger.ts` creates `public.schema_migrations(version STRING PRIMARY KEY, name
STRING NOT NULL, checksum STRING NOT NULL, applied_at TIMESTAMPTZ NOT NULL)`.
`checksum` is `sha256Base64Url` of the file text.

`runner.ts` reads `migrations/*.sql` sorted by version, and for each unapplied
file opens one transaction with `SET LOCAL autocommit_before_ddl = false`,
executes the file, appends the ledger row, and commits. An applied version whose
checksum differs aborts before any statement runs.

**Acceptance**

1. Applying to an empty database creates all 40 tables and 13 views.
2. Re-running applies nothing and reports each version as already applied.
3. A migration whose second statement fails leaves neither its objects nor its
   ledger row.
4. Editing an applied file makes the next run fail with the version name and the
   forward-fix instruction, and applies nothing.

### `P1-03` — Roles and grants

`0001_bootstrap.sql` creates `app_runtime` and `inspection_reader` with
`NOLOGIN` (Phase 7 attaches real credentials). `0013_grants.sql` grants
`app_runtime` `USAGE` on `public`, `SELECT, INSERT, UPDATE` on every table, and
no `DELETE` except `api_rate_limits`, no DDL, and no role administration.
`inspection_reader` receives `USAGE` on `inspection` and `SELECT` on its
thirteen views only.

**Acceptance** — connecting as each role and asserting:

| Role | Allowed | Denied |
|---|---|---|
| `app_runtime` | insert/select/update on `towns`; delete on `api_rate_limits` | `CREATE TABLE`, `DROP TABLE`, `CREATE ROLE`, delete on `world_events`, select on any `inspection` view |
| `inspection_reader` | select on all thirteen views | select on any base table, insert into any view, any DDL |
| `migration_admin` | DDL | — |

### `P1-04` — Town, entity, and actor identity

Six tables. The constraints this task must produce, beyond column types:

- `towns`: status in `{active, awaiting_resolution, resolved, retired}`;
  `resolved_at` non-null exactly when `status = 'resolved'` or `'retired'`;
  the three resolution-reservation fields all null while `active` and all
  present while `awaiting_resolution`; non-negative `revision`,
  `last_event_sequence`, `ambient_scheduled_through_sequence`;
  `ambient_scheduled_through_sequence <= last_event_sequence`;
  `invite_token_hash` unique and exactly 32 bytes.
- `story_entities`: `entity_type` in `{character, location, item, motive}`;
  unique `(town_id, entity_key)`; unique `(town_id, id, entity_type)`.
- `actors`: `actor_type` in `{player, npc}`; unique
  `(town_id, display_name_normalized)`; unique `(town_id, id, actor_type)`.
- `players`: PK `(town_id, id)`, FK to `actors(town_id, id, actor_type)` with
  `actor_type` a checked constant `'player'`.
- `npcs`: same pattern with `'npc'`; `character_entity_id` FK to
  `story_entities(town_id, id, entity_type)` with constant `'character'`;
  unique `(town_id, character_entity_id)`; `location_entity_id` FK with constant
  `'location'`.
- `npc_contact_edges`: PK `(town_id, from_npc_id, to_npc_id)`;
  `from_npc_id <> to_npc_id`; `trust_score` between `-100` and `100`.

**Acceptance**

1. Inserting a `players` row whose actor has `actor_type = 'npc'` fails.
2. Inserting an `npcs` row pointing at a `location` entity as its character
   fails.
3. A second `npcs` row for one character fails.
4. Two actors normalizing to the same display name fail.
5. A `npc_contact_edges` row with equal endpoints fails.
6. Every child FK carries `town_id`; the audit proves no town-owned FK omits it.
7. Lark exists as a `character` story entity with no `actors` row.

### `P1-05` — Creation, join, session, rate-limit, and visit state

- `town_creation_requests`: PK `idempotency_key`; status in
  `{processing, completed, failed}`; processing token and expiry present exactly
  while `processing`; `town_id`/`response_status`/`response_payload` present
  exactly when `completed`; `error_code` present exactly when `failed`;
  `attempt_count >= 0`.
- `join_requests`: unique `(town_id, idempotency_key)`;
  `session_issue_count` `0` while processing and `1..3` when completed;
  `replay_closed_reason` in `{confirmed, expired, exhausted}` and present
  exactly with `replay_closed_at`; a closed request has
  `join_secret_hash IS NULL`.
- `player_sessions`: unique `(town_id, token_hash)`; status in
  `{active, revoked}`.
- `api_rate_limits`: PK `(scope_kind, scope_key, bucket_kind)`;
  `tokens_milli >= 0`; no raw IP column exists — the audit asserts the column
  set contains no `ip`-named column.
- `player_visits`: status in `{active, ended}`; partial unique index on
  `(town_id, player_id) WHERE status = 'active'`; `end_reason` in
  `{left_town, town_resolved}` present exactly when `ended`; `ended_at`,
  `end_revision`, `ended_by_action_id` likewise; `location_entity_id` FK with
  constant `'location'`.

**Acceptance** — one negative test per presence rule, plus: two active visits
for one player fail; an ended visit without `end_reason` fails; a completed join
request with `session_issue_count = 4` fails.

### `P1-06` — Authored truth, evidence, and item state

- `world_facts`: unique `(town_id, fact_key)` and `(town_id, claim_id)`;
  visibility in `{hidden, discoverable, public}`.
- `case_solutions`: PK `town_id`; four typed FKs with constants `character`,
  `motive`, `location`, `item`.
- `inspectables`: unique `(town_id, inspectable_key)`; `location_entity_id` FK
  constant `'location'`; nullable `linked_entity_id` FK constant `'item'`.
- `items`: PK `(town_id, id)`; `id` also FKs `story_entities` with constant
  `'item'`; exactly one of `location_entity_id` and `held_by_actor_id` non-null;
  `revision >= 0`.
- `player_capabilities`: unique `(town_id, player_id, capability_key)`; status in
  `{granted, revoked}`; `revoked_event_id` present exactly when `revoked`.
- `clues`: unique `(town_id, clue_key)`; `clue_kind` in
  `{physical_trace, document, object_state}`.
- `clue_claim_effects`: unique `(town_id, clue_id, claim_id)`; `effect_kind` in
  `{supports, contradicts}`; `signed_weight <> 0`.
- `clue_discoveries`: unique `(town_id, clue_id, player_id)`.

`items.revealed_event_id` immutability is enforced by the repository layer and
proved by a direct-SQL negative test in `P1-20`; a `CHECK` cannot see the old
row.

### `P1-07` — Claims, dialogue records, provenance, and memory

- `claims`: unique `(town_id, normalized_key)`; `predicate` in
  `{was_at, moved, damaged, is_at, acted_for}`; `polarity` in
  `{positive, negative}`; a single `CHECK` encoding the full predicate/type
  matrix:

  ```text
  (predicate='was_at'    AND subject_entity_type='character' AND object_entity_type='location')
  OR (predicate='moved'  AND subject_entity_type='character' AND object_entity_type='item')
  OR (predicate='damaged'AND subject_entity_type='character' AND object_entity_type='item')
  OR (predicate='is_at'  AND subject_entity_type='item'      AND object_entity_type='location')
  OR (predicate='acted_for' AND subject_entity_type='character' AND object_entity_type='motive')
  ```

- `claim_relations`: unique `(town_id, claim_a_id, claim_b_id, relation_kind)`;
  `relation_kind` in `{contradicts, entails}`; `claim_a_id <> claim_b_id`.
- `claim_drafts`: status in `{pending, confirmed, cancelled, expired}`;
  `confirmed_by_action_id` and `confirmed_claim_id` present exactly when
  `confirmed`; the same predicate/type matrix check as `claims`.
- `npc_interactions`: unique `player_action_id`; `input_kind` in
  `{ask, tell, show, give, promise}`; `response_mode` in
  `{selected, repaired, fallback, authored}`.
- `claim_transmissions`: unique `(town_id, event_id, ordinal)`;
  `speaker_actor_id <> recipient_actor_id`; `hop_count` between `0` and `4`;
  `source_kind` in
  `{original_assertion, direct_observation, repeated_testimony, alleged_hearsay}`
  with presence checks:

  | `source_kind` | Required | Forbidden | `hop_count` |
  |---|---|---|---|
  | `original_assertion` | — | parent, episode | `= 0` |
  | `direct_observation` | `source_episode_id` | parent | `= 0` |
  | `repeated_testimony` | `parent_transmission_id` | episode | `>= 1` |
  | `alleged_hearsay` | `alleged_source_actor_id` | parent, episode | `>= 1` |

  plus `root_transmission_id = id` exactly when `parent_transmission_id IS NULL`.
- `episodes`: unique `(town_id, npc_id, event_id, episode_kind)`;
  `importance` `0..100`; `embedding_status` in `{pending, ready, failed}`;
  `embedding IS NOT NULL` exactly when `ready`; `episode_kind` in the six
  accepted values.
- `episode_references`: `reference_kind` in
  `{participant, location, item, motive, claim}`; exactly one of `entity_id`
  and `claim_id` non-null; `claim_id` non-null exactly when
  `reference_kind = 'claim'`; unique on both populated shapes.

### `P1-08` — Beliefs and relationship ledgers

- `npc_beliefs`: PK `(town_id, npc_id, claim_id)`; `score` `-100..100`; `label`
  in `{convinced, leaning, doubtful}` and consistent with the score band;
  `revision >= 0`.
- `belief_evidence`: `evidence_kind` in the seven accepted values, with presence
  checks:

  | `evidence_kind` | Required non-null | Forbidden |
  |---|---|---|
  | `direct_observation` | `episode_id` | transmission, clue, mirrors, reverses |
  | `player_testimony` | `transmission_id`, `source_root_transmission_id`, `independent_source_actor_id`, `trust_snapshot`, `hop_count` | clue, mirrors, reverses, threshold |
  | `npc_testimony` | same as above | same as above |
  | `physical_clue` | `clue_id` | transmission, mirrors, reverses, threshold |
  | `corroboration` | `corroboration_threshold` in `{2,3}`, `independent_source_actor_id` | clue, mirrors, reverses |
  | `contradiction` | exactly one of `clue_id` or `mirrors_evidence_id` | reverses, threshold |
  | `source_reversal` | `reverses_evidence_id` | mirrors, threshold |

  `reverses_evidence_id` is unique when present.
- `npc_player_relationships`: PK `(town_id, npc_id, player_id)`; both scores
  `-100..100`.
- `relationship_changes`: `reason_kind` in the six accepted values with the
  accepted column-presence bindings.

### `P1-09` — Promises and case progress

- `promises`: `kind` in `{keep_secret, return_item}`; exactly one of
  `protected_claim_id` / `item_id`, matching `kind`; status in
  `{active, fulfilled, broken}`; `resolved_event_id` present exactly when not
  `active`.
- `case_board_entries`: `entry_kind` in
  `{verified_evidence, testimony, hearsay, note}`; `verification_status` paired
  one-to-one with the entry kind; presence checks per entry kind; at most one
  verified-evidence row per clue and one row per transmission. The 1–280
  grapheme bound on `note_text` is validated by the write boundary and a SQL
  length sanity check of `1..1120` bytes.
- `case_attempts`: unique `player_action_id`; typed suspect/motive/location FKs;
  `outcome` in `{incorrect, correct}`.
- `town_resolutions`: PK `town_id`; `choice` in
  `{expose_cover_up, restore_bell_quietly}`.

### `P1-10` — Actions, events, model runs, and ambient operations

- `player_actions`: unique `(town_id, player_id, idempotency_key)`;
  `action_kind` in the thirteen accepted kinds; status in
  `{processing, retryable, completed, failed}`; the four state-presence rules
  exactly as Decision 005 states them, including `retryable` requiring
  `response_status = 409`, `error_code = 'ACTION_CONFLICT'`, a payload, and
  `retry_after_at`; partial unique `(town_id, player_id) WHERE status =
  'processing'`.
- `world_events`: unique `(town_id, sequence_no)` and `(town_id, effect_key)`;
  `origin_kind` in `{player_action, ambient_job, system_seed}` with exactly the
  matching origin FK non-null and both null for `system_seed`; `effect_index >=
  0`; `event_type` in the twenty accepted types; partial unique
  `(town_id, player_action_id, effect_index)` and
  `(town_id, ambient_job_execution_id, effect_index)`.
- `agent_runs`: `purpose` in the six accepted values; `outcome` in the six
  accepted values; at least one causal source non-null; the prompt-hash and
  contract-version fields required for the four structured purposes and null for
  the two embedding purposes; `target_prompt_version` non-null exactly for
  `structured_repair`; non-negative token, latency, and cost values.
- `model_cost_reservations`: exactly one of the four source identifiers;
  `town_id` non-null exactly for the three town-scoped sources; status in
  `{reserved, settled, released}`; a settled row has both `actual_cost` and
  `settled_at`, a reserved row neither, a released row `actual_cost = 0`;
  `actual_cost <= maximum_cost`; partial unique source/purpose/attempt indexes.
- `outbox`: `delivery_status` in `{pending, sending, sent, abandoned}`; send
  token and expiry present exactly while `sending`; `sent_at` present exactly
  when `sent`; `last_error_code` present exactly when `abandoned`;
  `after_event_sequence < through_event_sequence`; unique `(town_id, job_key)`
  and `(town_id, visit_id, job_type)`.
- `ambient_job_executions`: status in `{processing, completed, quarantined}`;
  claim fields present exactly while `processing`; `action_count` `0..2` present
  exactly when `completed`; `error_code` present exactly when `quarantined`;
  unique `(town_id, outbox_id)` and `(town_id, job_key)`.

`0009_deferred_keys.sql` then adds every FK that references `world_events`,
`player_actions`, `ambient_job_executions`, `player_visits`, `npc_interactions`,
`episodes`, `belief_evidence`, `promises`, and `case_attempts` from tables
created earlier.

`packages/database/src/payloads.ts` supplies the Zod schemas the repository
layer must run before writing `player_actions.request_payload`,
`player_actions.response_payload`, `world_events.payload`, and `outbox.payload`.
Seed events use `{ version: "world-event/1", contentVersion, seedEventKey }`.

### `P1-11` — Remaining indexes and the schema audit

`expected-schema.ts` holds the accepted inventory as data: table names, per-table
column name/type/nullability, check-constraint names, foreign keys with their
column lists, unique and partial indexes, and view names. `introspection.ts`
reads `information_schema` and `pg_catalog` and returns the same shape.
`schema-audit.test.ts` asserts deep equality in both directions, so an
undocumented object fails as loudly as a missing one.

Additional audit assertions:

1. Exactly 40 base tables in `public` plus `schema_migrations`.
2. Exactly 13 views in `inspection`.
3. Every FK whose referenced table is town-owned includes `town_id` as its first
   column on both sides.
4. The vector index exists on `episodes` with prefix columns `town_id, npc_id`
   and the ready predicate.
5. No column name matches `/^ip$|_ip$|raw_/`.

### `P1-12` — Bounded database client

`client.ts` builds a `pg.Pool` with `max: 2`, `connectionTimeoutMillis: 3000`,
`statement_timeout` set to `min(3000, remaining budget)`, and
`idle_in_transaction_session_timeout: 5000`. TLS: when
`TTR_ENV !== "local"` the DSN must contain `sslmode=verify-full`, and the loader
throws otherwise. Local may use `sslmode=disable`.

`telemetry.ts` emits `{ event: "db_operation", category, durationMs, retries,
errorCode }` only. Its input type has no field for a DSN, SQL text, parameter, or
password, matching the Phase 0 structural-redaction convention.

The operator pool lives in `packages/database-admin/src/operator-client.ts` and
is the only module importing `runtime-config/operator`. The workspace boundary
check is extended so that `database` may import only `runtime-config/database`.

### `P1-13` — Kysely types

`schema.ts` declares one interface per table using `Selectable`/`Insertable`/
`Updateable` narrowing:

- Append-only tables (`world_events`, `belief_evidence`, `relationship_changes`,
  `claim_transmissions`, `clue_discoveries`, `case_attempts`, `npc_interactions`,
  `episode_references`, `agent_runs`) expose no `Updateable` type at all.
- `episodes` exposes an `Updateable` containing only `embedding` and
  `embedding_status`.
- `inspection.*` views are read-only interfaces.

`brands.ts` defines `Uuid`, `Sha256Bytes` (32 bytes), `UsdCost` (string-backed
decimal), `Utc` (Date with a brand), `Vector256` (`readonly number[]` of length
256). `codecs.ts` converts each to and from `pg` representations, including the
`'[…]'` vector text form measured in section 1.

`type-drift.test.ts` compares the declared column set and nullability of every
table against `introspection.ts` output.

### `P1-14` — Serializable transactions

```ts
withSerializableTransaction(pool, deadline, async (tx) => { … })
```

Retries SQLSTATE `40001` at most three times. Delay `i` is
`base[i] * (0.5 + random())` with `base = [25, 75, 225]` ms, clamped so the next
attempt still fits inside the deadline; otherwise the call fails with
`category: "deadline_exceeded"`. The callback is re-run whole, so every
conditional write re-checks its precondition.

A commit whose acknowledgement is lost resolves to
`{ outcome: "ambiguous", operationKey }`. The type has no success branch, so a
caller cannot ignore it: it must read the durable ledger through
`resolveAmbiguousCommit()` before any retry.

**Acceptance**

1. With an injected clock and jitter, four attempts occur and the delays are
   exactly `25, 75, 225` ms scaled by the injected factor.
2. A deadline shorter than the next delay stops early and reports
   `deadline_exceeded`, not a fourth attempt.
3. Two real concurrent transactions updating the same row produce a genuine
   `40001` that the wrapper retries to success.
4. An ambiguous result cannot be consumed as success — a type-level fixture plus
   a runtime test that the helper throws when retried without a ledger read.

### `P1-15` / `P1-16` — Content registry and validation

The registry is one deeply frozen object. Its exact inventory, which the
validators assert:

| Collection | Count | Notes |
|---|---:|---|
| Characters | 4 | Lark has no NPC |
| Locations | 4 | map order `0..3`, Old Chapel locked |
| Items | 4 | one non-portable |
| Motives | 3 | |
| Story entities total | 15 | items are also story entities |
| NPCs | 3 | fixed locations |
| Contact edges | 4 | Mara→Nessa 30, Mara→Corin 40, Nessa→Mara 20, Corin→Mara 20 |
| Claims | 12 | |
| Claim relations | 6 | three symmetric contradictions, both directions (`D1-M`) |
| World facts | 8 | 1 public, 7 discoverable |
| Inspectables | 8 | one reveals an item and no clue |
| Clues | 7 | 3 required for resolution |
| Clue claim effects | 12 | every weight `±70` |
| Disclosure tier bindings | 14 | |
| Seed events | 11 | 9 `authored_observation`, 2 `claim_transmitted` |
| Seed episodes | 11 | 9 `direct_observation`, 2 `heard_claim` |
| Episode references | 39 | |
| Seed transmissions | 2 | |
| Seed belief evidence | 19 | 11 direct, 2 testimony, 6 mirrors |
| Seed beliefs | 19 | Mara 6, Corin 9, Nessa 4 |
| Promise terms versions | 2 | `keep-lark-accident-secret-v1`, `return-chapel-key-v1` |
| Fallback dialogue lines | 12 | 3 NPCs × 4 interaction kinds |
| Authored denial lines | 6 | |
| Mechanical outcome lines | 4 | |
| Ending choices | 2 | |
| Contribution fragments | 6 | |
| `ending_false_claim_keys` | 3 | |

The ordered seed events:

| # | `seedEventKey` | Offset | Event type | Binds |
|---:|---|---|---|---|
| 1 | `corin_saw_the_accident` | `T-12h` | `authored_observation` | Corin episode, `lark_damaged_bell` `+80` |
| 2 | `mara_saw_the_accident` | `T-12h` | `authored_observation` | Mara episode, `lark_damaged_bell` `+80` |
| 3 | `mara_met_corin_at_inn` | `T-11h50m` | `authored_observation` | Mara episode, `corin_was_at_inn` `+80` |
| 4 | `corin_told_mara_he_would_protect_lark` | `T-11h50m` | `claim_transmitted` | transmission, Mara `heard_claim` episode, `corin_protected_lark` `+44` |
| 5 | `corin_told_nessa_the_safety_story` | `T-11h30m` | `claim_transmitted` | transmission, Nessa `heard_claim` episode, `corin_acted_for_safety` `+40` |
| 6 | `corin_chose_to_protect_lark` | `T-11h` | `authored_observation` | Corin episode, `corin_protected_lark` `+80` |
| 7 | `corin_moved_the_bell` | `T-11h` | `authored_observation` | Corin episode, `corin_moved_bell` / `bell_at_chapel` / `bell_at_chapel_current` `+80` each |
| 8 | `nessa_saw_corins_cart` | `T-11h` | `authored_observation` | Nessa episode, `corin_was_at_chapel` `+80` |
| 9 | `mara_saw_the_empty_frame` | `T-30m` | `authored_observation` | Mara episode, `bell_not_at_square` `+80` |
| 10 | `corin_saw_the_empty_frame` | `T-30m` | `authored_observation` | Corin episode, `bell_not_at_square` `+80` |
| 11 | `nessa_saw_the_empty_frame` | `T-30m` | `authored_observation` | Nessa episode, `bell_not_at_square` `+80` |

The six mirror evidence rows implied by Decision 008's rule that supporting
evidence of weight `W` appends `-W` to every explicitly contradicted claim:

| NPC | Target claim | Weight | Mirrors |
|---|---|---:|---|
| Mara | `lark_did_not_damage_bell` | `-80` | Mara's accident observation |
| Corin | `lark_did_not_damage_bell` | `-80` | Corin's accident observation |
| Corin | `corin_acted_for_safety` | `-80` | Corin's protective decision |
| Corin | `bell_at_reeds_garden` | `-80` | Corin's chapel-location observation |
| Mara | `corin_acted_for_safety` | `-44` | Corin's testimony to Mara |
| Nessa | `corin_protected_lark` | `-40` | Corin's testimony to Nessa |

Resulting labels, which the seed test asserts exactly:

- Mara — `lark_damaged_bell` 80 `convinced`, `corin_was_at_inn` 80 `convinced`,
  `bell_not_at_square` 80 `convinced`, `corin_protected_lark` 44 `leaning`,
  `lark_did_not_damage_bell` −80 `doubtful`, `corin_acted_for_safety` −44
  `doubtful`.
- Corin — `lark_damaged_bell`, `corin_moved_bell`, `bell_at_chapel`,
  `bell_at_chapel_current`, `corin_protected_lark`, `bell_not_at_square` all 80
  `convinced`; `lark_did_not_damage_bell`, `corin_acted_for_safety`,
  `bell_at_reeds_garden` all −80 `doubtful`.
- Nessa — `corin_was_at_chapel` 80 `convinced`, `bell_not_at_square` 80
  `convinced`, `corin_acted_for_safety` 40 `leaning`, `corin_protected_lark`
  −40 `doubtful`.

Those match every belief Decision 009 states in prose, and add only mirrors that
Decision 008's contradiction rule requires (see 10.1).

`validate.ts` proves:

1. Stable keys are unique per collection and every cross-reference resolves.
2. Every claim satisfies the predicate/type matrix, and `claimKeyV1` over the
   twelve claims yields twelve distinct keys.
3. `claim_relations` are symmetric for `contradicts` and contain no self-pair.
4. Clue effects reference seeded claims; every weight is `±70`.
5. Solution IDs are `corin_hale` / `protect_lark` / `old_chapel` /
   `festival_bell` with the right entity types.
6. Item custody: exactly one of location or holder per item.
7. Starting-knowledge boundaries — Mara's seed episodes and beliefs contain no
   `old_chapel` reference; Nessa's contain no `festival_bell` reference; Corin's
   cover the complete truth tuple.
8. `seedEvents` offsets are non-decreasing, and every episode, transmission, and
   evidence row names an existing `seedEventKey`.
9. Every fallback, denial, mechanical-outcome, ending, and fragment key is
   present, and no authored copy contains `<`, `>`, or a claim key.
10. A frozen fixture file records `domainSeparatedDigest("content-v:1",
    registry)` so accidental copy drift shows up as one reviewable line.

### `P1-17` / `P1-18` — Materialization and fixtures

```ts
materializeTown(db, {
  contentVersion: "bell-mystery-v1",
  createdAt: Utc,
  inviteTokenHash: Sha256Bytes,
  creationRequestId: Uuid,
}): Promise<{ townId: Uuid; stableKeyIds: ReadonlyMap<string, Uuid> }>
```

`plan.ts` is pure: content plus inputs produce an ordered list of typed row
groups. `materialize.ts` opens one serializable transaction and writes them in
FK order, then sets `last_event_sequence = 11` and
`ambient_scheduled_through_sequence = 11`. Every seed event carries
`ambient_eligible = false`, `origin_kind = 'system_seed'`, both origin FKs null,
`effect_index = 0`, and `effect_key = 'seed:bell-mystery-v1:<seedEventKey>'`.

`summary.ts` returns `{ townId, contentVersion, counts, beliefLabels }` and
nothing else. A redaction test asserts the summary and CLI output contain no
`invite`, `token`, `hash`, `secret`, or `password` key at any depth.

**Acceptance**

1. Row counts equal the section 6 inventory exactly.
2. Every `normalized_key` equals `claimKeyV1` over its tuple.
3. Belief scores and labels equal the table above.
4. `towns.ambient_scheduled_through_sequence = towns.last_event_sequence = 11`
   and every seed event is ambient-ineligible.
5. Two towns from one content version share no UUID across every town-owned
   table, yet their stable-key projections are deeply equal.
6. An injected failure at the last insert group leaves zero rows in all 40
   tables.
7. Zero `players`, `player_visits`, `player_actions`, `clue_discoveries`,
   `case_board_entries` rows exist after seeding.

### `P1-19` — Inspection views

Thirteen views, each selecting stable keys and display names alongside opaque
IDs, with deterministic ordering. A shared column denylist test asserts none of
the thirteen exposes a column whose name matches
`/hash|token|cookie|secret|password|credential|prompt_text|raw_/`, and a data
test asserts no value equals a known seeded invite hash.

### `P1-20` — Schema invariants on CockroachDB

Test files, all in the `database` vitest project:

| File | Covers |
|---|---|
| `schema-audit.test.ts` | `P1-11` inventory equality |
| `grants.test.ts` | `P1-03` matrix |
| `tenant-isolation.test.ts` | every cross-town FK family rejects a foreign `town_id` |
| `constraints.test.ts` | one negative case per closed domain and presence rule |
| `concurrency.test.ts` | unique item custody, one processing action, one resolution |
| `transaction-retry.test.ts` | forced `40001`, bounded retries, deadline stop |
| `ambiguous-commit.test.ts` | ledger read required before retry |
| `vector.test.ts` | insert, index use, town/NPC prefix, ready-only exclusion |
| `seed.test.ts` | `P1-17` acceptance list |
| `seed-isolation.test.ts` | two-town isolation and equivalence |
| `inspection.test.ts` | view reconstruction and secret exclusion |

### `P1-21` — Documentation

`CONTRIBUTING.md` gains a database section: starting the pinned node, migrating,
seeding, querying inspection, and cleaning only the disposable target; the
forward-fix procedure for a failed migration; and the schema-change checklist
(accepted-contract review → migration → `expected-schema.ts` → Kysely types →
grants → seed compatibility → integration tests). `README.md` gains the new
commands. A note records that production credentials, cluster creation, and
managed MCP setup remain Phase 7.

## 7. Commands

| Script | Definition |
|---|---|
| `db:up` | `node scripts/cockroach.mjs start` |
| `db:down` | `node scripts/cockroach.mjs stop` |
| `db:doctor` | `node scripts/db-doctor.mjs` |
| `db:migrate` | `node scripts/db-migrate.mjs` |
| `db:seed` | `node scripts/db-seed.mjs` |
| `test:db` | `vitest run --project database` |
| `test:content` | `vitest run --project content` |

`validate` becomes: `format:check`, `check:boundaries`, `test:tooling`,
`typecheck`, `lint`, `test` (now including `content` and `database` projects),
`build`, `check:bundle`, `cdk:synth`, `test:e2e`.

## 8. Goals

Phase 1 is finished when every goal below is objectively true.

| Goal | Proof |
|---|---|
| `G1` | `pnpm db:doctor` reports the pinned version and passes four capability probes; an unsupported target fails with a named capability |
| `G2` | `pnpm db:migrate` applies every migration to an empty database, and a second run applies nothing |
| `G3` | A failed migration leaves neither objects nor a ledger row; an edited applied file aborts before any statement |
| `G4` | The catalog audit proves exactly 40 tables, 13 inspection views, and the complete accepted constraint, FK, and index inventory in both directions |
| `G5` | Every town-owned foreign key includes `town_id`, and a cross-town reference is rejected for every FK family |
| `G6` | `app_runtime`, `inspection_reader`, and `migration_admin` hold exactly their accepted rights; every denial in the `P1-03` matrix is proved |
| `G7` | The Kysely `Database` interface matches the migrated catalog, and append-only tables expose no update type |
| `G8` | Serializable retry performs at most three retries on the accepted jitter schedule, stops on the deadline, and recovers a real `40001` |
| `G9` | An ambiguous commit cannot be consumed as success and forces a durable ledger read |
| `G10` | `pnpm test:content` proves key uniqueness, reference closure, claim-key identity, starting-knowledge boundaries, and copy bindings |
| `G11` | `bell-mystery-v1` maps immutably to `mvp-rules-v1`, and the content fingerprint fixture matches |
| `G12` | Materialization commits the exact section-6 inventory atomically; an injected failure leaves zero rows |
| `G13` | Eleven `system_seed` events exist with the accepted types, all ambient-ineligible, and `ambient_scheduled_through_sequence = last_event_sequence = 11` |
| `G14` | Every seeded belief score and label equals the `P1-16` table, and every `normalized_key` equals `claimKeyV1` of its tuple |
| `G15` | Two towns from one content version share no town-owned identity yet project equal stable-key state |
| `G16` | Constraint tests reject every closed-domain and presence violation; concurrency tests permit one item owner, one processing action, one resolution |
| `G17` | Vector insert, index, and query are town/NPC scoped and exclude non-ready embeddings |
| `G18` | The thirteen inspection views reconstruct the seed and expose no hash, token, cookie, secret, or raw prompt |
| `G19` | `pnpm db:seed` prints only an opaque town ID and a safe summary |
| `G20` | Migration, seed, audit, recovery, and schema-change procedures are documented |
| `G21` | `pnpm validate` passes as one command from a clean checkout, with the database suite required |

## 9. Execution order and commit plan

```text
P1-01 -> P1-02 -> P1-03
P1-02 -> P1-04 -> {P1-05, P1-06, P1-07}
P1-06 + P1-07 -> P1-08 -> P1-09
P1-05 + P1-07 + P1-09 -> P1-10 -> P1-11 -> P1-12 -> P1-13 -> P1-14
P1-15 -> P1-16                       (parallel with all SQL work)
P1-14 + P1-16 -> P1-17
P1-11 + P1-13 -> P1-19
P1-03 + P1-11 + P1-14 + P1-17 + P1-19 -> P1-20 -> P1-18 -> P1-21
```

Each task lands as its own commit once its own tests pass. Tasks that add a
migration file commit the migration, its types, and its tests together, because
none of the three is meaningful alone.

## 10. Discrepancies found while planning

### 10.1 Seed mirror evidence is implied but not enumerated

Decision 009 enumerates the beliefs each NPC holds at seed but does not mention
contradiction mirrors. Decision 008 states without qualification that supporting
evidence of weight `W` appends a `-W` mirror for every explicit `contradicts`
relation, and Decision 005 repeats it. Because the seed inserts real
`belief_evidence` rows over seeded `claim_relations`, the rule applies, so the
seed writes the six mirrors listed in `P1-16`.

They are additive: every belief Decision 009 names keeps exactly its stated score
and label. If the accepted intent were instead that mirrors begin only with live
play, that is a Decision 008 amendment, not an implementation choice.

### 10.2 `nessa_saw_corins_cart` has no explicit offset

Decision 009 fixes five offsets by name and lists nine episodes. The cart
observation is not named in the offset sentence. It is placed at `T-11h` with
the move, because it is an observation *of* the move; the alternative `T-11h30m`
is when Nessa was asked to open the chapel, which is a different episode
(`nessa_heard_safety_story`).

### 10.3 Seed tie-breaking cannot use generated IDs

Decision 009 says ties in seed ordering "use stable event and episode IDs", but
those IDs are generated per town, so two towns would order ties differently and
the repeatability test in `P1-18` could not pass. `D1-N` replaces the tie-break
with an authored order in the content registry, which is deterministic and
reviewable. The observable result — a stable sequence within each offset group —
is what the decision asks for.

### 10.4 `claim_relations` directionality

Decision 005 makes `(ordered claim pair, relation kind)` unique, which is
directional, while `contradicts` is semantically symmetric and Decision 009
writes each contradiction once. `D1-M` stores both directions so mirror lookup
never has to test two column orders. This adds rows, not meanings.

### 10.5 Note length cannot be checked in SQL

Decision 005 bounds `case_board_entries.note_text` to 1–280 grapheme clusters.
CockroachDB has no grapheme-aware length function, so the bound is enforced by
the write boundary using the Phase 0 `Intl.Segmenter` helper, with a coarse SQL
byte-length check as a backstop. `P1-20` proves the bound through the repository
path and proves that direct SQL alone cannot be relied on.

### 10.6 The public schema grants CREATE to everyone by default

CockroachDB follows PostgreSQL before 15: every role holds `CREATE` on the
`public` schema unless it is revoked. `app_runtime` could therefore add tables
while holding no explicit DDL grant at all. The grant test caught it, and
`0013_grants.sql` now revokes that first. Least privilege here means taking
something away before granting anything.
