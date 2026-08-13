# Phase 3 — Execution Detail

- **Status:** Detailed execution plan for
  [Phase 3 — First Playable Vertical Slice](phase-03-first-playable-vertical-slice.md).
  Not yet started.
- **Scope:** Concrete package layout, exact module contracts grounded in the
  already-shipped Phase 0/1/2 code, task-level module and acceptance detail,
  command definitions, and goals for `P3-01` through `P3-19`.
- **Authority:** This document refines *how* Phase 3 is built. It never
  redefines *what* decisions 001–011 accept. Where the phase plan or an
  accepted decision is silent or ambiguous, this document records the
  implementation choice and the reasoning in section 9. Where the phase plan
  and an accepted decision disagree, the decision wins.
- **Baseline:** `main` at `3e691f0` (Phase 2 merged via PR #1). Every claim in
  section 1 was verified by reading that source, not by re-deriving it from the
  decision documents.

## 1. Grounding

Phase 3 is the first phase that adds a *live* external boundary the earlier
phases only described: an HTTP server holding a session, a bounded connection
pool inside a request, and a browser that must not show state before the server
committed it. There is no new third-party service, so there is no capability
spike — but there is a large amount of already-shipped code Phase 3 must call
rather than reinvent, and three genuine holes it must fill first.

### 1.1 The three holes

These are not defects in the earlier phases. They are exactly the work the
phase boundary deferred, and each one blocks a Phase 3 task until it is closed.

**There is no query layer.** Phase 1's `P1-13` deliverable is named
"repositories", and Phase 3's prerequisites restate that as "Repositories that
enforce composite `town_id` scope". What actually shipped is narrower:
`packages/database/src/schema.ts` (generated Kysely interfaces),
`brands.ts`, `domains.ts`, `client.ts` (`createRuntimePool`), and
`transaction.ts` (`runSerializable` / `resolveAmbiguousCommit`). There is not
one `SELECT` or `INSERT` against a gameplay table anywhere in `packages/`
outside `packages/town-seed/src/materialize.ts` and `summary.ts`, both of which
write raw parameterized SQL through `TransactionContext.query`. Phase 3 writes
the entire read and write layer for the seven Phase 3 routes, and `D3-B` fixes
its shape.

**There is no security configuration category.** `packages/runtime-config` has
`game`, `ambient`, `recovery`, `database`, `deployment`, `test`, and `operator`.
None of them declares a judge code, an invite-derivation key, a session-token
pepper, or an IP-hash secret, and `.env.example` names none of them. `P3-03`
cannot verify a bearer code and `P3-03`/`P3-04`/`P3-07` cannot derive an invite,
a session token, or a rotating IP hash until `D3-C` adds that category. The
existing `SECRET_VARIABLE_PATTERN` in `runtime-config/shared.ts` and
`browser-config/index.ts` already contains `JUDGE`, `SESSION`, `SECRET`,
`TOKEN`, `SIGNING`, and `COOKIE`, so every name the new category introduces is
automatically rejected from the browser bundle — the guard exists before the
values it guards.

**`HttpRequest` carries no headers, body, cookies, or source address.**
`apps/game-api/src/http/types.ts` is `{ method: string; path: string }`, and its
own comment says so deliberately: *"Phase 3 widens this type when authenticated
routes arrive."* Every Phase 3 route needs at least one of `Authorization`,
`Cookie`, `Idempotency-Key`, `Join-Attempt-Secret`, `If-None-Match`, `Origin`,
`Content-Type`, the JSON body, and the source IP. `D3-M` widens it once, in a
shape that keeps the closed log-event union in `observability/log.ts` unable to
carry any of it.

### 1.2 What Phase 3 reuses rather than rebuilds

Reading `packages/http-contracts/src/*.ts`, `packages/rules/src/**`,
`packages/database/src/*.ts`, `packages/town-seed/src/*.ts`,
`packages/test-support/src/**`, and `apps/game-api/src/**` directly turns up
working code Phase 3 must call:

| Need | Already exists at |
|---|---|
| All seven route templates and the API version | `http-contracts/routes.ts#ROUTE_TEMPLATES`, `#API_VERSION` (`"v1"`), `#API_BASE_PATH`, `#UNMATCHED_ROUTE_TEMPLATE` |
| Every request/response schema for creation, preview, join | `http-contracts/town.ts#{TownCreationRequestSchema, TownCreationResponseSchema, InvitePreviewResponseSchema, JoinRequestSchema, JoinResponseSchema}`, `#JOIN_MODES` |
| The complete `PlayerView` schema and every component schema | `http-contracts/player-view.ts#PlayerViewSchema`, `#TOWN_STATUSES`, `#NPC_STANCES`, `#ENCOUNTER_ACTION_KINDS`, `#RESOLUTION_CHOICES`, `#PROMISE_KINDS` |
| The strict action request union and per-kind completed envelope | `http-contracts/actions.ts#ActionRequestSchema`, `#ActionResultSchemaByKind`, `#CompletedActionResponseSchema`, `#ProcessingActionResponseSchema`, `#ActionStatusResponseSchema`, `#ACTION_KINDS`, `#MODEL_BACKED_ACTION_KINDS` |
| Problem body, status policy, stable codes, type-URL derivation | `http-contracts/problem.ts#{ProblemResponseSchema, PROBLEM_CODES, PROBLEM_STATUS_POLICY, problemTypeUrl}` |
| Grapheme-cluster text bounds, display-name rules, ID/time/key regexes | `http-contracts/primitives.ts#{plainText, countGraphemeClusters, DisplayNameSchema, IdSchema, IsoTimeSchema, IdempotencyKeySchema, JoinAttemptSecretSchema, ViewVersionSchema, AssetKeySchema}` |
| Problem construction that validates before serializing | `apps/game-api/src/http/problem.ts#{buildProblem, problemResponse}` |
| Server-generated opaque request ID (never read from the request) | `apps/game-api/src/http/request-id.ts#createRequestId` |
| Router skeleton, trailing-slash normalization, base headers, 404-for-everything | `apps/game-api/src/http/router.ts#{handleRequest, baseHeaders, normalizePath, ROUTES}` |
| Closed, redaction-by-construction log event union | `apps/game-api/src/observability/log.ts#{logEvent, GameApiLogEvent, LoggableRoute}` |
| Bounded pool with Decision 007's limits and TLS fail-closed | `database/client.ts#{createRuntimePool, statementTimeoutMs}` |
| Serializable transaction, three bounded retries, honest ambiguity | `database/transaction.ts#{runSerializable, resolveAmbiguousCommit, SerializableResult}` |
| Generated row shapes, branded column types, closed domains | `database/schema.ts`, `database/brands.ts`, `database/domains.ts` (via `./schema`, `./brands`, `./domains` subpaths) |
| Canonical JSON and domain-separated digests | `serialization/canonical-json.ts`, `serialization/digest.ts#{domainSeparatedDigest, sha256Base64Url, base64UrlUtf8}` |
| `viewVersion` / `ETag` hashing, already byte-exact for Decision 006 | `rules/projection/view-version.ts#computeViewVersion` (`domainSeparatedDigest("player-view:v1", hashProjection)`) |
| Every stable projection order and the full `PlayerView` assembler | `rules/projection/player-view.ts#{projectMap, projectCurrentLocation, projectEncounters, projectInventory, projectDiscoveredClues, projectPlayerView}`, `rules/kernel/ordering.ts` |
| The four Phase 3 action planners | `rules/actions/deterministic.ts#{planStartVisit, planTravel, planInspect, planLeaveVisit}` |
| Terminal completed-response builders | `rules/projection/action-result.ts#{buildSucceededResponse, buildDeniedResponse}` |
| Ambient range arithmetic and per-event-type eligibility | `rules/world/visits.ts#{computeAmbientEventRange, planLeave, computeAmbientEligible, canStartNewVisit}` |
| Locked-location and evidence-gate copy, and the confrontation gate | `content/entities.ts#LOCKED_LOCATION_MESSAGE`, `content/evidence.ts#EVIDENCE_GATE_LOCKED_MESSAGE`, `rules/board/case.ts#isConfrontationGateOpen` |
| Transactional town materialization from frozen content | `town-seed/materialize.ts#materializeTown` — its header states it derives no invite and that "Production and demo towns are created through the Phase 3 town-creation ledger" |
| Disposable migrated CockroachDB per test file | `test-support/database/harness.ts#createDisposableDatabase`, `#shouldRunDatabaseTests` |
| Exact-bytes stdout capture and the forbidden-field catalog | `test-support/log-capture.ts#captureStdout`, `test-support/redaction.ts#{SENSITIVE_TEST_MARKERS, FORBIDDEN_LOG_PROPERTIES, findSensitiveMarkers}` |
| Every Phase 3 table, its constraints, and least-privilege grants | migrations `0003_operations.sql` (`town_creation_requests`, `join_requests`, `player_sessions`, `api_rate_limits`, `player_visits`), `0008_operations_ledger.sql` (`player_actions` incl. `uq_player_actions__one_processing`, `world_events` incl. `uq_world_events__player_effect`), `0013_grants.sql` |
| Neutral asset placeholder, unknown-key fallback, failure sink | `apps/web/src/assets/{manifest,placeholder}.ts#{resolveAssetKey, onAssetLookupFailure}` |

`P3-01`'s phase-plan deliverable — "Strict runtime schemas and TypeScript types
for invite preview, join, `PlayerView`, Phase 3 action requests/results,
processing responses, and `ProblemResponse`" — is therefore already shipped in
full by Phase 0. `P3-01` in this plan is re-scoped accordingly (see §5) to the
part that genuinely does not exist: the transport helpers, the widened request
type, and a conformance suite that proves the shipped schemas actually match
what the handlers will emit.

### 1.3 What Decisions 005/006/007/011 do not define

Real gaps found by reading the contracts, resolved by a `D3-` decision below
and re-collected in section 9. These are the kind of detail an implementation
plan is supposed to pin down.

- The invite token's format, length, and HMAC preimage. Decision 006 says only
  "a versioned HMAC of the creation key using the application security secret"
  (`D3-D`).
- The session cookie's exact name. Decision 006 says "named from the opaque
  town ID" (`D3-E`).
- The token-bucket refill algorithm and the unit of `api_rate_limits.tokens_milli`.
  The rates and bursts are fixed; the arithmetic, the storage unit, and the
  admission statement are not (`D3-F`). The table's primary key is
  `(scope_kind, scope_key, bucket_kind)` with **no `town_id` column**, so the
  per-player and per-town scopes must fold the town into `scope_key`.
- How a source IP becomes a rotating HMAC hash: the rotation period, the key
  derivation, and the stored width (`D3-G`).
- The `request_hash` preimage. Decision 005 names its *inputs* ("API version,
  action kind, relational targets, and canonical payload") but not the byte
  encoding (`D3-H`).
- Whether `packages/content` or the web bundle owns `sceneKey`/`portraitKey`
  and the player-safe `roleLabel`, `mysteryTitle`, `tagline`, and
  `description`. Decision 011 §"Required player-view presentation fields" says
  they come from the frozen content version; `packages/content` currently has
  none of them (`D3-J`, `D3-K`).
- What `inspect` does about the shared verified-evidence board entry and the
  revealed item. Decision 006 requires both; `rules/actions/deterministic.ts#planInspect`
  emits only an `inspected` event origin and a `clue_discoveries` insert
  (`D3-I`, §9.1).
- What the Phase 3 `leave` branch does if the range turns out to contain an
  eligible event. The phase plan forbids a fake `waiting` and forbids a silent
  Phase 3 fixture that produces one, but names no behavior (`D3-Q`).

## 2. Implementation decisions

Structural choices Phase 3 is permitted to make, recorded so Phases 4–6 inherit
them instead of rediscovering them.

| ID | Decision | Rationale |
|---|---|---|
| `D3-A` | One new workspace package, `packages/game-server`, holding the transport-agnostic `http/`, `application/`, and `persistence/` layers. `apps/game-api` shrinks to three files that were always adapters: `handler.ts` (Lambda), `local-server.ts` (`node:http`), and `main.ts` | `vitest.config.ts`'s coverage `include` is `packages/*/src/**/*.ts` with a 90% threshold on all four metrics. Leaving Phase 3's ~5,000 lines of application logic in `apps/game-api/src` would put the largest body of new code in the repository outside the only coverage gate it has. It also lets Phase 5's ambient worker call the same executor rather than growing a second command path, which `P3-19`'s handoff explicitly asks for |
| `D3-B` | `packages/game-server` writes raw parameterized SQL through `TransactionContext.query`, typed by `Selectable<XTable>` / `Insertable<XTable>` from `@the-town-remembers/database/schema`. No Kysely query builder is instantiated anywhere | `town-seed/materialize.ts` and `summary.ts` already established this idiom against the same generated types, `transaction.ts`'s `TransactionContext` exposes only `query(sql, parameters)`, and adding a second data-access style would mean two places to audit for a missing `town_id` predicate. `kysely` stays a type-only dependency, exactly as `D2-N` set up for `packages/rules` |
| `D3-C` | A new configuration category, `packages/runtime-config/src/security.ts` exported at `./security`, holding `TTR_JUDGE_CODE`, `TTR_INVITE_SIGNING_KEYS`, `TTR_SESSION_TOKEN_PEPPER`, and `TTR_IP_HASH_SECRET`. `check-workspace-boundaries.mjs` gains a validator, parallel to the existing `./operator` rule, that permits `./security` only in `packages/game-server` and `apps/game-api` | §1.1. Every one of those names already matches `SECRET_VARIABLE_PATTERN`, so `browser-config` rejects a `VITE_`-prefixed variant by construction. `TTR_INVITE_SIGNING_KEYS` is a comma-separated `<version>:<base64url-32-bytes>` list whose **first** entry is the active key and whose remaining entries stay decryptable for replay — Decision 006 requires every historical derivation-key version to remain retrievable while a creation record uses it |
| `D3-D` | The invite token is `base64url(HMAC-SHA256(key_v, "invite:v1\n" + creationIdempotencyKey))`, 43 characters. `towns.invite_token_hash` stores `SHA-256(token)` as 32 bytes; `town_creation_requests.security_key_version` stores `v`. Preview looks up by hash only. The `201` body's `inviteUrl` is reconstructed on every first response and replay from the creation key plus the recorded key version | §1.3. The preimage is domain-separated in the same style as every other digest in the repo, the output width matches `JoinAttemptSecretSchema`/`ViewVersionSchema`'s 43-character base64url shape, and `towns.invite_token_hash`'s existing `length(...) = 32` check constrains the stored side. The plaintext never enters `towns`, `town_creation_requests.response_payload`, or a log |
| `D3-E` | The session cookie is named `ttr_town_<townId>` with `Path=/api/v1/towns/<townId>`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Max-Age=31536000` | Decision 006 says "named from the opaque town ID". The rejected alternative — a derived digest of the town ID — hides nothing, because the same town ID is already in the cookie's own `Path` and in every request line, and it would make a debugging session require a hash computation |
| `D3-F` | `api_rate_limits.tokens_milli` holds tokens × 1000. Admission is one statement inside the caller's serializable transaction: refill `floor(elapsedMs × ratePerMinute × 1000 / 60000)`, clamp to `burst × 1000`, admit iff the clamped value `>= 1000`, then subtract `1000` and set `last_refill_at`. `scope_key` is `SHA-256` of a domain-separated preimage that names the scope: `"rate-scope:v1\n" + scopeKind + "\n" + townId + "\n" + subjectId` | §1.3. Milli-tokens make the refill exact in integers, so a burst of 10 at 30/minute cannot drift. The composite key has no `town_id` column, so folding the town into `scope_key` is the only way a per-player bucket in one town cannot be consumed by activity in another |
| `D3-G` | An IP hash is `HMAC-SHA256(HKDF(TTR_IP_HASH_SECRET, "ip-window:v1\n" + floor(epochMs / 86_400_000)), ip)`, stored as the full 32 bytes in `scope_key`. The raw address never leaves the request handler and has no field in any log event | §1.3. A daily window means an old bucket cannot be correlated to a new one after rotation, and it lines up with the 15-minute bucket periods without a bucket ever spanning two windows in a way that matters. `Sha256Bytes` is already the declared type of `api_rate_limits.scope_key` |
| `D3-H` | `request_hash` is `domainSeparatedDigest("action-request:v1", { apiVersion, kind, targetActorId, targetEntityId, payload })`, with the sibling domains `"town-creation-request:v1"` and `"join-request:v1"`. Cookie, idempotency key, join secret, and every transport header are structurally absent from the hashed object, not filtered out of it | §1.3. Reuses the Phase 0 primitive whose canonical-JSON key sorting already makes the digest independent of property order, and puts the exclusion in the shape of the input rather than in a reviewer's attention |
| `D3-I` | `rules/actions/deterministic.ts#planInspect` is **extended** — inside Phase 3, as part of `P3-11` — to emit the `case_board_entries` insert for `new_to_town` and the `items` conditional state change for a portable reveal. The orchestration layer never synthesizes a game effect the rules package did not plan | Decision 006 requires `inspect` to produce the first shared verified board record and a `revealedItem` with `custody`, and `packages/rules/README.md` states the package is "the single authority for all gameplay decisions and state transitions". Putting either rule in `packages/game-server` would create exactly the second authority Phase 2 exists to prevent. See §9.1 |
| `D3-J` | `packages/content` gains `src/presentation.ts`: `MYSTERY_TITLE`, `TAGLINE`, `SPOILER_SAFE_DESCRIPTION`, `OPENING_NARRATION` (all four already authored verbatim in Decision 009), `LOCATION_SCENE_KEYS`, `NPC_PORTRAIT_KEYS`, and `NPC_ROLE_LABELS`. The role labels are **new authored copy** — `Innkeeper`, `Town guard`, `Herbalist` | Decision 011 requires these to come from the frozen content version and to be part of the hashed projection. Decision 009's own "Role" column reads *"Innkeeper and Lark's protective older sister"* and *"Town guard who moved the bell"* — those are design notes that name Lark and state Corin's involvement, and Decision 009 separately requires the opening not to expose either. They cannot be player-visible `roleLabel` values. See §9.2 |
| `D3-K` | Agreement between `content`'s asset keys and `apps/web/src/assets/manifest.ts` is enforced by a new `scripts/check-asset-keys.mjs` in the `validate` pipeline, not by a shared import | `apps/web` cannot depend on `@the-town-remembers/content`: content depends on `@the-town-remembers/serialization`, and `scripts/check-bundle-safety.mjs`'s `FORBIDDEN_SUBSTRINGS` contains both `@the-town-remembers/serialization` and `node:crypto`, which `serialization/digest.ts` imports. A drift script is the same shape as the existing `db-types.mjs` + drift-test idiom |
| `D3-L` | `vitest.config.ts` gains an `api` project for `packages/game-server/src/**/*.test.ts`; DB-backed suites use the filename suffix `*.db.test.ts` and are added to the existing `database` project's `include`. Coverage `include` gains nothing — `packages/game-server/src/**` is already matched by `packages/*/src/**/*.ts` | The `database` project owns `globalSetup`, `fileParallelism: false`, and the 30s/120s timeouts that a real CockroachDB suite needs; duplicating that configuration in a second project would let the two drift. `apps/game-api`'s remaining adapter tests stay in `runtime-shells` |
| `D3-M` | `apps/game-api/src/http/types.ts#HttpRequest` widens to `{ method, path, headers: ReadonlyMap<string, string>, body: string \| undefined, sourceIp: string \| undefined }`, with `headers` lowercased and restricted at the adapter to an eight-name allowlist (`authorization`, `content-type`, `origin`, `cookie`, `idempotency-key`, `join-attempt-secret`, `if-none-match`, `accept`) | The type's own comment reserves this change for Phase 3. An allowlist rather than a pass-through means an unexpected header has no representation to travel in, which is the same technique `observability/log.ts` already uses for log fields. `GameApiLogEvent` stays a closed union and gains no field that could hold any of it |
| `D3-N` | The executor loads **per-kind narrow inputs** (`loadStartVisitInputs`, `loadTravelInputs`, `loadInspectInputs`, `loadLeaveInputs`), not a generic `loadCanonicalTownSnapshot` | Read directly: `planTravel` takes `{ currentLocationId, destinationLocationId, destinationKnown, destinationAccess, visitId, townId, townRevision }` and `planInspect` takes seven scalars. None of the four Phase 3 planners accepts `CanonicalTownSnapshot`. Loading the whole snapshot would mean seven table reads to answer a question two of them answer, inside a 24-second budget with a two-connection pool. `packages/rules/README.md`'s `loadCanonicalTownSnapshot` example is illustrative of the *pattern*, not a required function signature |
| `D3-O` | On `runSerializable` returning `outcome: "ambiguous"`, the executor calls `resolveAmbiguousCommit` with a read of `player_actions` by `(town_id, player_id, idempotency_key)` — never a blind retry, and never a second effect application | `transaction.ts`'s own contract: the ambiguous branch deliberately carries no value so the caller must consult its durable identity. `uq_player_actions__idempotency_key` makes that read authoritative |
| `D3-P` | `packages/game-server/src/application/actions/enabled.ts#ENABLED_ACTION_KINDS` is `["start_visit", "travel", "inspect", "leave"]`, checked after schema parsing and **before** any `player_actions` row is created. Everything else in `ACTION_KINDS` returns a stable `422` | The phase plan requires a stable `422` for well-formed unsupported kinds with no action row and no placeholder effect. A single exported constant is what Phase 4 and Phase 6 edit — one line each — rather than a scattered set of `switch` defaults |
| `D3-Q` | Phase 3's `leave` computes the real eligible-event count. A nonzero count is an **internal invariant violation**: the executor commits nothing and returns `500`. It never returns `waiting`, and it never writes an outbox row it has no worker for | The phase plan forbids a fake `waiting` and forbids a silent Phase 3 fixture producing that branch. A `500` with no effects is the honest failure; a `waiting` with no queue would strand the player permanently. `P3-12`'s acceptance suite proves the count is zero by construction for the four enabled kinds by enumerating all 20 `EVENT_TYPES` against `rules/world/visits.ts#computeAmbientEligible` |
| `D3-R` | Monthly cookie reissuance is a conditional `UPDATE player_sessions SET last_cookie_issued_at = $now WHERE town_id = $1 AND id = $2 AND last_cookie_issued_at <= $now - INTERVAL '30 days'`; `Set-Cookie` is emitted only when that statement reports exactly one affected row | Decision 006 requires one concurrent response to be elected. Making the election the update's own `WHERE` clause means two concurrent readers cannot both decide they are the one, without a separate lock |
| `D3-S` | Join bootstrap confirmation runs on the first authenticated player-view **before** the `If-None-Match` short-circuit, so a `304` confirms just as a `200` does | Decision 006 says the first authenticated view "(`200` or `304`)" closes the replay path and destroys the join-secret hash. Placing the confirmation after the ETag comparison would leave a browser that polled with a stale-but-matching ETag able to keep minting sessions |
| `D3-T` | `apps/web` gets a hand-written router (`src/routing/`) over `history.pushState`/`popstate`, not a routing library | `/join/:inviteToken` must call `history.replaceState` **synchronously, before the first fetch**, and `P3-13`'s acceptance test asserts that ordering against the real network log. Inserting a library's own mount-time initialization between the token read and the replacement is the one thing that ordering cannot tolerate. Eight routes, no nesting, no data loaders — the whole router is smaller than its configuration would be. `apps/web`'s only runtime dependencies stay `react` and `react-dom` |

## 3. Dependency selection

No new external runtime dependency. One new workspace package enters the graph,
and three existing packages gain a dependency edge.

| Package | Where | Why |
|---|---|---|
| `@the-town-remembers/game-server` *(new)* | consumed by `apps/game-api` | Transport-agnostic application + persistence layers (`D3-A`) |
| `@the-town-remembers/database` (bare barrel) | `packages/game-server` | `createRuntimePool`, `runSerializable`, `resolveAmbiguousCommit`, `DatabaseError` — this is the runtime, so unlike `packages/rules` it *needs* the client |
| `@the-town-remembers/rules` | `packages/game-server` | The four Phase 3 planners, every projector, `computeViewVersion` |
| `@the-town-remembers/content` | `packages/game-server` | Frozen authored strings, `sceneKey`/`portraitKey`/`roleLabel`, locked-location copy |
| `@the-town-remembers/town-seed` | `packages/game-server` | `materializeTown` inside the creation ledger's transaction |
| `@the-town-remembers/http-contracts` | `packages/game-server` | Every request/response schema, parsed at both the transport and the persistence boundary |
| `@the-town-remembers/serialization` | `packages/game-server` | `domainSeparatedDigest` for fingerprints, invite derivation, rate-scope keys |
| `@the-town-remembers/runtime-config` (`./game`, `./database`, `./security`) | `packages/game-server` | Budgets, pool limits, and the new secret category (`D3-C`) |
| `@the-town-remembers/rules` | `apps/game-api` — **not added** | The adapter must stay a transport translation; everything gameplay-shaped is reached through `game-server` |
| `kysely` (type-only) | `packages/game-server` devDependency | `Selectable<T>` / `Insertable<T>` narrowing, same as `D2-N` |
| `pg` (type-only) | `packages/game-server` devDependency | `Pool` in the injected-dependency signatures; the pool itself is constructed by `database/client.ts` |

`scripts/check-workspace-boundaries.mjs` changes:

- one new `EXPECTED_PACKAGES` entry — `path: "packages/game-server"`, `kind: "library"`,
  `exports: STANDARD_EXPORTS`, `allowedDependencies` exactly the eight workspace
  packages above;
- `apps/game-api`'s `allowedDependencies` gains `GAME_SERVER` and nothing else
  (it keeps `HTTP_CONTRACTS`, `MODEL_CONTRACTS`, `SERIALIZATION`, `RUNTIME_CONFIG`);
- a new `RUNTIME_CONFIG_EXPORTS` entry `"./security"`; and
- a new validator, `validateSecurityConfigImport`, modelled on the existing
  `validateRuntimeConfigImport`/`FORBIDDEN_DATABASE_SPECIFIERS_FOR_RULES` pair,
  rejecting `@the-town-remembers/runtime-config/security` anywhere except
  `packages/game-server` and `apps/game-api`.

`apps/web` gains no workspace dependency. It keeps `HTTP_CONTRACTS` and
`BROWSER_CONFIG`, which is what makes `D3-K`'s drift script necessary.

## 4. Planned file layout

```text
packages/game-server/src/
  index.ts

  http/
    request.ts            WidenedHttpRequest re-export, header allowlist, cookie parse
    negotiate.ts           content-type / Origin / Accept enforcement
    headers.ts              cache, Vary, ETag, security, Retry-After, Location builders
    cookies.ts               D3-E name derivation, Set-Cookie serialization, parsing
    errors.ts                 AppError -> ProblemResponse mapper (one place, no stack)
    router.ts                  route table + dispatch for all seven templates
    *.test.ts

  security/
    judge-code.ts           constant-time bearer comparison
    invite.ts                 D3-D derivation, hashing, reconstruction, key-version lookup
    session-token.ts           256-bit mint, pepper, hash-only storage
    ip-hash.ts                  D3-G rotating HMAC
    fingerprint.ts               D3-H request_hash for the three ledgers
    *.test.ts

  persistence/
    towns.ts                readTownForUpdate, bumpRevision, allocateEventSequence
    creation-ledger.ts       town_creation_requests claim / replay / complete
    join-ledger.ts            join_requests claim / replay / close / session count
    sessions.ts                authenticate, reissue (D3-R), revoke
    players.ts                  create player + actor + zeroed relationships
    visits.ts                    active visit read, start, end
    actions.ts                    player_actions state machine (D3-O)
    events.ts                      world_events append with player:<key>:<index> keys
    discoveries.ts                  clue_discoveries + case_board_entries
    rate-limits.ts                   D3-F token bucket
    view-queries.ts                   the explicit player-view read set
    *.db.test.ts

  application/
    deadline.ts             absolute deadline plumbing, the four-second reserve
    town-creation.ts         judge auth -> ledger -> materializeTown -> invite URL
    invite-preview.ts         hash-only lookup -> spoiler-safe preview
    join.ts                    name normalization, uniqueness, atomic first visit
    player-view/
      build.ts                  assembles rules' projectors into one PlayerView
      etag.ts                    computeViewVersion + If-None-Match + D3-S
      *.test.ts
    actions/
      enabled.ts               D3-P allowlist
      executor.ts               the shared five-step command executor
      ledger.ts                  claim / takeover / supersede / replay decisions
      inputs/
        start-visit.ts           D3-N per-kind loaders
        travel.ts
        inspect.ts
        leave.ts
      commit.ts                  effect-plan -> parameterized writes, one revision
      *.test.ts

  observability/
    events.ts               closed structured-event union for game-server
    metrics.ts               counters/histograms, no high-cardinality dimension
    *.test.ts

apps/game-api/src/
  handler.ts              Lambda adapter -> WidenedHttpRequest (unchanged shape)
  local-server.ts          node:http adapter -> WidenedHttpRequest
  main.ts
  http/types.ts             D3-M widened request/response types
  http/request-id.ts        unchanged
  observability/log.ts      unchanged closed union
  *.test.ts

apps/web/src/
  routing/
    router.tsx              D3-T history-based router, eight routes
    guards.tsx               player-view-driven route guards
  api/
    client.ts               fetch wrapper: same-origin, credentials, problem parsing
    playerView.ts            polling + If-None-Match + visibility schedule
    actions.ts                POST + 202 polling + takeover + conflict
  journal/
    db.ts                   IndexedDB open/put/delete for PendingActionJournal
    channel.ts               BroadcastChannel coordination
    machine.ts                the Decision 011 recovery state machine
  screens/
    JoinBootstrap.tsx        /join/:inviteToken -> replaceState -> /join
    Join.tsx                  preview, resume, display-name form
    Shell.tsx                  header, places rail, casebook, drawers
    Map.tsx
    Location.tsx
    Away.tsx
    Board.tsx                  read-only shell only in this phase
  components/
    PendingBar.tsx
    ResultCard.tsx
    LockedNotice.tsx
  assets/manifest.ts        unchanged; key list checked by scripts/check-asset-keys.mjs

packages/content/src/
  presentation.ts           D3-J titles, tagline, description, scene/portrait keys,
                             player-safe role labels, opening narration

packages/runtime-config/src/
  security.ts               D3-C judge code, invite keys, session pepper, IP secret

scripts/
  check-asset-keys.mjs      D3-K content <-> web manifest drift
  check-asset-keys.test.mjs
```

## 5. Task-level execution detail

### Workstream A — Transport and safe contracts

#### `P3-01` — Transport helpers, widened request, and contract conformance

**Depends on:** Phase 2 exit gate

**Re-scoped.** §1.2 establishes that every schema this task's phase-plan
deliverable names already shipped in Phase 0. What does not exist is the
transport machinery around them and any proof that a handler's output will
satisfy them.

**Modules**

- `apps/game-api/src/http/types.ts` — `D3-M`. `HttpRequest` gains `headers`,
  `body`, `sourceIp`. `HttpResponse` gains `cookies: readonly string[]` so a
  `Set-Cookie` cannot be flattened into the single-valued header map.
- `game-server/http/request.ts` — `HEADER_ALLOWLIST` (eight names),
  `readHeader`, `parseCookies` (RFC 6265 pair split, no decoding of values).
- `game-server/http/negotiate.ts` — `requireJsonContentType`,
  `requireExactOrigin(config.appOrigin)`, `parseJsonBody<T>(schema, raw)`
  returning a `FieldError[]` on failure with JSON Pointer paths.
- `game-server/http/headers.ts` — `noStoreHeaders()`,
  `privateNoCacheHeaders()` (`Cache-Control: private, no-cache` + `Vary: Cookie`),
  `etagHeader(viewVersion)` (quoted), `retryAfter(seconds)`,
  `locationHeader(actionStatusUrl)`, and the four security headers already in
  `router.ts#baseHeaders`.
- `game-server/http/errors.ts` — `AppError` (a `code`/`status`/`detail` carrier)
  and `toProblemResponse(error, requestId, actionId?)`, the single mapper.

**Acceptance**

1. `contracts` project: every `ActionResultSchemaByKind` member for the four
   enabled kinds round-trips a hand-written fixture, and each fixture is also
   accepted by `CompletedActionResponseSchema` under both `applied`/`no_change`
   and `denied` envelopes.
2. `PlayerViewSchema` accepts a fully-populated fixture and a
   fully-empty-but-valid fixture (empty board, `investigating` resolution with a
   `locked` gate, `null` ambient transition, `away` visit).
3. `parseJsonBody` rejects unknown properties, wrong types, a trailing comma,
   a `null` body, a `[]` body, and a 1 MiB body, each with a JSON Pointer that
   names the offending path and never echoes the submitted value.
4. `requireExactOrigin` rejects a missing `Origin`, a subdomain, a scheme
   mismatch, a port mismatch, and a trailing-slash variant.
5. `parseCookies` handles zero cookies, a quoted value, a duplicate name (first
   wins), and a value containing `=`.
6. A source scan asserts `HEADER_ALLOWLIST` and `GameApiLogEvent`'s field names
   are disjoint, so no allowlisted header has a log field to travel in.

#### `P3-02` — Router, uniform failure boundary, and route-template logging

**Depends on:** `P3-01`

**Modules**

- `game-server/http/router.ts` — the seven-entry route table. Path parameters
  are extracted by a small matcher against `ROUTE_TEMPLATES` (the `{townId}`
  form), never by a regex written at the call site.
- `apps/game-api/src/http/router.ts` — reduced to: build request ID, call
  `game-server`'s router, attach base headers, log, return. `IMPLEMENTED_ROUTE_TEMPLATES`
  becomes all seven.
- `game-server/observability/events.ts` — the closed event union for this
  package, mirroring `GameApiLogEvent`'s discipline.

**Acceptance**

1. Every unmatched path, and every matched path with a wrong method, returns
   the identical `404 RESOURCE_NOT_FOUND` body modulo `requestId` — asserted by
   comparing the two bodies with `requestId` blanked. There is no `405`;
   `PROBLEM_STATUS_POLICY` has no such key.
2. `/api/v1/health/` and `/api/v1/health` resolve identically; `/api/v1//health`
   does not.
3. Mutation and action-status responses carry `Cache-Control: no-store`;
   authenticated read responses carry `private, no-cache` and `Vary: Cookie`;
   every response carries `Referrer-Policy: no-referrer`,
   `X-Content-Type-Options: nosniff`, and a `req_`-prefixed `X-Request-Id`.
4. Every problem body has content type `application/problem+json; charset=utf-8`
   and validates against `ProblemResponseSchema`.
5. A thrown `Error("SELECT * FROM towns WHERE id = 'abc'")` inside a handler
   produces a `500` whose serialized body contains none of `SELECT`, `towns`,
   `abc`, `at `, or `.ts:`.
6. `captureStdout` around one request of each route asserts the emitted line
   parses as JSON, its `routeTemplate` is a member of `ROUTE_TEMPLATES`, and
   `findSensitiveMarkers` finds nothing after each of the eight
   `SENSITIVE_TEST_MARKERS` is injected into a header, the body, and the path.

### Workstream B — Invite, identity, and sessions

#### `P3-03` — Town creation and invite preview

**Depends on:** `P3-01`, `P3-02`; `D3-C`, `D3-D`

**Modules**

- `runtime-config/security.ts` (`D3-C`) plus its `./security` export,
  `.env.example` entries, and the boundary validator.
- `game-server/security/judge-code.ts` — `verifyJudgeCode` using
  `crypto.timingSafeEqual` over equal-length SHA-256 digests, so a length
  difference is not itself a timing signal.
- `game-server/security/invite.ts` — `deriveInviteToken(keyVersion, creationKey)`,
  `inviteTokenHash(token)`, `inviteUrl(appOrigin, token)`, `activeKeyVersion()`,
  `keyForVersion(v)`.
- `game-server/persistence/creation-ledger.ts` — claim/replay/complete against
  `town_creation_requests`, whose PK is `idempotency_key` alone (it is the one
  ledger with no town scope, because the town does not exist yet).
- `game-server/application/town-creation.ts` — the ordered flow: judge auth →
  rate bucket (`P3-07`) → claim → `materializeTown` → invite hash into
  `towns.invite_token_hash` → store `{ townId, status }` as the terminal
  response → reconstruct `inviteUrl` for the wire.
- `game-server/application/invite-preview.ts` — hash-only lookup; maps
  `towns.status` to `joinMode` (`active`→`play`, `awaiting_resolution`/`resolved`
  →`read_only`, `retired`→`closed`), with title/tagline/description from
  `content/presentation.ts`.

**Acceptance** (`*.db.test.ts` against real CockroachDB)

1. Two concurrent `POST /api/v1/towns` with the same key create exactly one
   `towns` row and one `town_creation_requests` row; both responses are
   byte-identical including `inviteUrl`.
2. A replay after a simulated key rotation (active version advanced to `v2`)
   still returns the `v1`-derived `inviteUrl`, proving `security_key_version`
   is read rather than assumed.
3. A replay with the same key but a different canonical body is `409
   IDEMPOTENCY_KEY_REUSED`. Since the body is exactly `{}`, this is exercised
   by a fingerprint whose `apiVersion` differs.
4. A wrong judge code, an absent `Authorization`, a non-`Bearer` scheme, and a
   correct code with a wrong `Origin` are each `401`/`403`/`403` with no
   `town_creation_requests` row created.
5. `town_creation_requests.response_payload` contains exactly
   `{"townId":…,"status":"active"}` — asserted by key comparison — and the raw
   invite token appears in **no** column of any table (a full-table scan over
   every `STRING`/`BYTES` column asserts the plaintext's absence).
6. `captureStdout` over the whole creation flow finds neither the judge code
   marker nor the invite token marker.
7. Preview by valid hash returns the six-field body and nothing else; preview
   for an unknown hash, a hash from a different town's derivation, and a
   retired town return `404`, `404`, and a `closed` preview respectively.
8. The preview response's keys, sorted, equal exactly
   `["description","joinMode","mysteryTitle","tagline","townId","townStatus"]`.

#### `P3-04` — First-time join and replay closure

**Depends on:** `P3-03`

**Modules**

- `game-server/application/join.ts` — NFKC normalization, whitespace collapse,
  trim, full case fold for uniqueness; grapheme bounds via
  `countGraphemeClusters`; `DisplayNameSchema` for the accepted displayed form.
- `game-server/persistence/join-ledger.ts` — the `join_requests` claim flow.
  The table already carries `join_secret_hash`, `replay_expires_at`,
  `session_issue_count`, `bootstrap_confirmed_at`, `replay_closed_reason`, and
  its own `ck_join_requests__closed_secret_cleared` check, so the ledger's job
  is to drive those columns, not to invent them.
- `game-server/persistence/players.ts` — one transaction creating `actors`
  (`actor_type = 'player'`, both raw and normalized display name), `players`,
  a zeroed `npc_player_relationships` row per authored NPC, one
  `player_sessions` row, and — only when `towns.status = 'active'` — the
  internally completed `start_visit` `player_actions` row, the Festival Square
  `player_visits` row, and the numbered `visit_started` `world_events` row.

**Acceptance**

1. Uniqueness: a player named `Mara Venn`, `mara venn`, `MARA  VENN` (double
   space), and `Ｍara Venn` (fullwidth M, NFKC-folds to `M`) are each rejected
   against the authored NPC actor. Two concurrent joins with the same name
   produce exactly one player and one `409`-class rejection, proved by a
   database-level unique violation rather than a read-then-write check.
2. Names of 1 and 25 grapheme clusters are rejected; 2 and 24 are accepted; a
   name whose 24 clusters are 40 UTF-16 code units is accepted, proving the
   bound counts graphemes.
3. Ten concurrent replays of one join key create one player, at most three
   `player_sessions` rows, and return `410 JOIN_REPLAY_EXHAUSTED` for the rest.
4. A replay after `bootstrap_confirmed_at` is set returns `410 JOIN_REPLAY_CLOSED`
   and sets no cookie; a replay after `replay_expires_at` returns
   `410 JOIN_REPLAY_EXPIRED` and sets no cookie. Both leave `join_secret_hash`
   `NULL`.
5. A replay presenting the correct key but a wrong `Join-Attempt-Secret` is
   `404`, not `401` — the ledger must not confirm that the key exists.
6. An `awaiting_resolution` or `resolved` town join creates the player and
   session but no `player_visits` row and no `start_visit` action;
   `initialVisit` is `null`.
7. A rolled-back join (forced by a constraint violation on the last insert)
   leaves zero `actors`, `players`, `player_sessions`, `player_visits`, and
   `world_events` rows.

#### `P3-05` — Town-scoped session authentication and refresh

**Depends on:** `P3-04`; `D3-E`, `D3-R`, `D3-S`

**Modules**

- `game-server/security/session-token.ts` — mint 256 bits from
  `crypto.randomBytes`, store only `SHA-256(pepper ‖ token)`.
- `game-server/http/cookies.ts` — `D3-E` name and attributes.
- `game-server/persistence/sessions.ts` — `authenticate(townId, tokenHash)`
  scoped to `(town_id, token_hash)` and `status = 'active'`, joined against
  `towns.status <> 'retired'`; `reissueIfDue` per `D3-R`;
  `confirmBootstrap(joinRequestId)` per `D3-S`.

**Acceptance**

1. A cookie minted for town A presented on town B's `player-view` path is
   `401`; the browser never sends it at all because of the `Path` scope, and
   the server rejects it anyway when replayed manually.
2. Two towns' cookies coexist in one cookie jar and each resumes its own
   identity, asserted through the real `node:http` adapter rather than a fake.
3. A revoked session is `401`; a retired town is `410`.
4. `last_cookie_issued_at` at 29 days emits no `Set-Cookie`; at 31 days
   exactly one of five concurrent authenticated requests emits it, and the
   other four return `200` with no `Set-Cookie` — asserted against real
   concurrent transactions, not a mocked clock branch.
5. A resolved town's `player-view` still performs the monthly reissue.
6. The first authenticated `player-view` that returns `304` (client sent a
   matching `If-None-Match`) still sets `bootstrap_confirmed_at` and clears
   `join_secret_hash` (`D3-S`).
7. The session token plaintext appears in no table, no log line, and no
   inspection view; only its hash is present, asserted by scanning every
   `BYTES` column for the 32-byte digest and every `STRING` column for the
   43-character token.

### Workstream C — Player-safe read model

#### `P3-06` — The version-one player-view projection

**Depends on:** `P3-05`, `P3-01`; `D3-J`, `D3-K`

**Modules**

- `packages/content/src/presentation.ts` (`D3-J`) and `scripts/check-asset-keys.mjs`
  (`D3-K`).
- `game-server/persistence/view-queries.ts` — one explicit function per
  projection region, each with a mandatory `town_id` parameter:
  `readTownHeader`, `readPlayerAndVisit`, `readMapAccess`, `readInspectables`,
  `readCoLocatedNpcs`, `readInventory`, `readDiscoveredClues`. There is no row
  serializer and no `SELECT *`.
- `game-server/application/player-view/build.ts` — feeds those reads into
  `rules/projection/player-view.ts`'s projectors. Phase 3 supplies:
  `activePromises: []`, `caseBoard: []`, `caseBoardContradictions: []`,
  `caseAttempts: []`, `ambientTransition: null`, and
  `resolution: { state: "investigating", accusationGate: { state: "locked", message: EVIDENCE_GATE_LOCKED_MESSAGE } }`.
  These are derived from state (no promises exist, no board entries exist, the
  gate is genuinely closed) rather than hard-coded — `isConfrontationGateOpen`
  is called with the real discovered-clue set.
- `game-server/application/player-view/etag.ts` — `computeViewVersion` over the
  projection minus `viewVersion`, then `If-None-Match` comparison.

**Acceptance**

1. `PlayerViewSchema.parse` accepts the built projection for: a joined player
   at Festival Square; the same player after travelling; the same player after
   an inspection; and an away player.
2. Shuffling every underlying query's row order (a deliberate `ORDER BY random()`
   in the test harness) produces a byte-identical response and an identical
   `ETag` — this is the direct test of the phase's stable-ordering promise.
3. A hidden-only change (writing a `npc_beliefs` score delta and a
   `relationship_changes` row directly) leaves the `ETag` unchanged.
4. `towns.revision` appears nowhere in the response — asserted by a recursive
   scan for the numeric value after setting it to a distinctive number.
5. The response contains no belief score, trust, or suspicion number: a
   recursive scan asserts every number in the body is a `mapOrder` or an
   `IsoTime`-adjacent field, against an explicit allowlist of numeric paths.
6. The locked Old Chapel returns `{ state: "locked", message: LOCKED_LOCATION_MESSAGE }`
   and no hint of either unlock route.
7. `encounters` contains only NPCs whose `npcs.location_entity_id` matches the
   visit's current location; `currentLocation` is `null` while away and
   `encounters` is `[]`.
8. `If-None-Match` with the current `viewVersion` returns `304` with no body
   and with the `Vary: Cookie` and `Cache-Control: private, no-cache` headers
   still present.
9. `scripts/check-asset-keys.mjs` fails when a key is added to
   `content/presentation.ts` and not to `apps/web/src/assets/manifest.ts`, and
   vice versa; its `node:test` companion covers both directions.

#### `P3-07` — Route-level rate limiting

**Depends on:** `P3-05`, `P3-06`; `D3-F`, `D3-G`

**Modules**

- `game-server/security/ip-hash.ts`, `game-server/persistence/rate-limits.ts`.
- Three configured buckets: `player_view` (30/min, burst 10, scope `player`),
  `town_creation` (5/15 min, burst 5, scope `ip_hash`), `join` (10/15 min,
  burst 10, scope `ip_hash`). `bucket_kind` values are already constrained by
  `ck_api_rate_limits__bucket_kind`; the `model_action` bucket is declared and
  left unused until Phase 4.

**Acceptance**

1. The 11th `player-view` inside one second is `429` with `Retry-After`; the
   31st inside a minute is `429`; after the stated `Retry-After` the next
   request succeeds.
2. Twenty concurrent `player-view` requests against a burst-10 bucket admit
   exactly ten, proved against real serializable transactions.
3. A `429` on `POST /api/v1/towns` creates no `town_creation_requests` row, so
   the same idempotency key succeeds afterwards.
4. A `429` on join creates no `join_requests` row.
5. An existing-session `player-view` resume and an existing town-creation or
   join **replay** are recognized before the new-operation bucket is consumed:
   a replay at a fully-drained `join` bucket still returns its saved response.
6. Invite preview consumes no application bucket (Decision 006, v1).
7. `api_rate_limits.scope_key` is 32 bytes in every row; no column anywhere
   holds a dotted or colonned address, asserted by scanning for the test IP
   literal.
8. Two players in the same town have independent `player_view` buckets, and
   the same player ID in two towns likewise — the direct test of `D3-F`'s
   town-folding.

### Workstream D — Durable action execution

#### `P3-08` — Action request identity and processing claims

**Depends on:** `P3-01`, `P3-05`; `D3-H`, `D3-O`, `D3-P`

**Modules**

- `game-server/security/fingerprint.ts` (`D3-H`).
- `game-server/persistence/actions.ts` — the `player_actions` state machine.
  The schema already enforces the hard parts: `uq_player_actions__idempotency_key`,
  `uq_player_actions__one_processing` (partial unique on `status = 'processing'`),
  and the column-presence checks per status. The repository's job is to drive
  those transitions with conditional statements, never with read-then-write.
- `game-server/application/actions/ledger.ts` — the decision table from
  Decision 006 §"Idempotency and conflicts", implemented as one pure function
  over `(existingRow, incomingFingerprint, now)` returning a
  `LedgerDecision` union: `create`, `replaySaved`, `respondProcessing`,
  `replayConflict`, `reclaim`, `takeover`, `rejectKeyReuse`, `blockInProgress`,
  `supersedeThenCreate`, `exhaust`.
- `game-server/application/actions/enabled.ts` (`D3-P`).
- Action-status route handler: ownership check → `404` for every other
  identity; `202` + `Retry-After: 2` + `Location` while processing; the saved
  status and body once terminal; the saved `409 ACTION_CONFLICT` while
  `retryable`. Reading never starts work.

**Acceptance** (`*.db.test.ts`)

1. `ledger.ts` is unit-tested exhaustively as a pure function: every row of
   Decision 006's table, plus the three `ACTION_IN_PROGRESS` /
   `ACTION_SUPERSEDED` / `ACTION_PROCESSING_EXHAUSTED` paths, is one named case.
2. Two concurrent identical POSTs produce one `player_actions` row, one
   execution, and two identical responses.
3. A response lost after commit (the test aborts the connection post-`COMMIT`)
   is recovered by the same key returning the saved body, with no second
   `world_events` row.
4. A stale worker holding an expired `processing_token` cannot commit after a
   takeover: its conditional completion matches zero rows and it raises rather
   than overwriting.
5. Three claimed attempts without a committed result cause the fourth owner to
   store a terminal `ACTION_PROCESSING_EXHAUSTED` with `outcome` null and no
   effects.
6. A second different key while one action is live returns `409 ACTION_IN_PROGRESS`
   with the blocking action's `Location`, and creates no row for the new key.
7. An **expired** blocking action is failed with `409 ACTION_SUPERSEDED` and
   the new action is created in the same transaction — asserted by observing
   both rows at one snapshot.
8. Same-key resolution happens before the blocker check: a replay of the
   *blocking* action's own key returns its status, not `ACTION_IN_PROGRESS`.
9. An ambiguous commit (simulated by killing the connection during `COMMIT`) is
   resolved by reading the ledger, and the effect count stays at one (`D3-O`).
10. `GET` on another player's action ID is `404`, identical to a nonexistent ID.
11. Every kind in `ACTION_KINDS` outside `ENABLED_ACTION_KINDS` returns `422`
    with no `player_actions` row.

#### `P3-09` — The atomic deterministic action executor

**Depends on:** `P3-08` and the Phase 2 planners; `D3-N`, `D3-O`

**Modules**

- `game-server/application/deadline.ts` — an `OperationDeadline` carrying
  `startedAtMs`, `applicationBudgetMs` (24s), `reservedCommitWindowMs` (4s),
  and `responseSerializationReserveMs` (500ms) from
  `runtime-config/reliability.ts#PLAYER_API_TIMING`. `preCommitDeadline()` and
  `commitStatementTimeoutMs()` derive from it; nothing recomputes those numbers.
- `game-server/application/actions/executor.ts` — the five-step order from
  `packages/rules/README.md`, from the caller's side:
  authenticate and validate → create/claim the record → load per-kind inputs
  (`D3-N`) → call the pure planner → build the completed response with
  `buildSucceededResponse`/`buildDeniedResponse` → validate it against
  `CompletedActionResponseSchema` → commit effects, numbered events, response,
  completion, and `towns.revision` in one transaction.
- `game-server/application/actions/commit.ts` — translates `EffectPlanEntry`
  into parameterized writes. This is where the Phase 2 handoff is finally
  bound: `InsertEffect.row` is a plain object, so `commit.ts` supplies the
  three columns `effects.ts` documents as the caller's (`id`, `town_id`,
  `created_at`) plus the foreign keys the planner could not know. A
  `ConditionalStateChangeEffect` carrying `expectedRevision` becomes a
  `WHERE revision = $n` predicate whose zero-row result aborts the **whole**
  plan.
- `game-server/persistence/events.ts` — `effect_key = "player:" + idempotencyKey + ":" + effectIndex`,
  matching Decision 005's derivation exactly, with `sequence_no` allocated from
  `towns.last_event_sequence` in the same statement that increments it.

**Acceptance**

1. Every committed action increments `towns.revision` by exactly one and
   allocates contiguous `sequence_no` values with no gap, under ten concurrent
   actions from two players.
2. `world_events.effect_key` is unique per `(town_id, effect_key)` and the
   partial unique index on `(town_id, player_action_id, effect_index)` is never
   violated; a deliberate duplicate-index plan is rejected by the database, not
   by application code.
3. A rule denial is stored as a `completed` row with `outcome = 'denied'`,
   `response_status = 200`, and a `DeniedActionResult` body; a replay returns it
   byte-identically and no `world_events` row exists.
4. `reasonCode` passes from `DecisionResult.reasonCode` to
   `DeniedActionResult.reasonCode` unchanged, satisfying the `/^[A-Z][A-Z0-9_]*$/`
   regex without translation (`D2-K`'s payoff).
5. A revision mismatch at commit discards the entire effect plan: a test that
   bumps `towns.revision` between load and commit asserts zero rows written
   across every table the plan touched.
6. Three serialization conflicts exhaust the bounded retry and store a
   `retryable` row with `409 ACTION_CONFLICT` and `retry_after_at = now + 1s`;
   a fourth identical request after that time reclaims `processing` under the
   same key, increments `attempt_count`, and clears the saved conflict.
7. No network or dependency call occurs inside a transaction — asserted by a
   source scan of `application/` and `persistence/` for `fetch(`, `http`, and
   `await pool.` inside a `runSerializable` callback.
8. `commitStatementTimeoutMs()` never exceeds the remaining application budget
   and never exceeds `DATABASE.maximumStatementTimeoutMs`.

#### `P3-10` — `start_visit` and `travel`

**Depends on:** `P3-06`, `P3-09`

**Modules**

- `application/actions/inputs/start-visit.ts` — resolves `townActive`,
  `hasActiveVisit`, `priorAmbientJobStatus` (always `"none"` in Phase 3, read
  from `outbox`/`ambient_job_executions` so the query is real rather than a
  constant), and `festivalSquareLocationId` from `story_entities`.
- `application/actions/inputs/travel.ts` — resolves `destinationKnown` from
  `story_entities` scoped to the town, and `destinationAccess` from the
  authored `initiallyOpen` flag plus any granted `player_capabilities` row.

**Acceptance**

1. A first `start_visit` after Leave returns `disposition: "started"` at
   Festival Square; an immediate second returns `already_active` with
   `outcome: "no_change"` and creates no second `player_visits` row.
2. `start_visit` in an `awaiting_resolution` town is denied with
   `TOWN_NOT_ACTIVE` as a `200` completed denial.
3. `travel` to the Old Chapel is denied with `LOCATION_LOCKED` and the exact
   `LOCKED_LOCATION_MESSAGE`; the message enumerates neither unlock route.
4. `travel` to a cross-town location ID, an item ID, and a random UUID all
   produce the same generic outcome — `DESTINATION_UNKNOWN` as a completed
   denial, never a `404` that distinguishes them, and never a difference in
   response timing large enough to be a probe (asserted by comparing response
   bodies, which is the property the contract actually promises).
5. `travel` to the current location returns `already_there` /
   `no_change` and emits no `world_events` row.
6. A successful `travel` emits exactly one `travelled` event and updates
   `player_visits.current_location_entity_id` in the same transaction as the
   revision bump.
7. Two concurrent `travel` requests from the same player: one commits, the
   other is `409 ACTION_IN_PROGRESS`.
8. An away player's `travel` is denied; the phase-plan case for a `frozen`
   visit is covered by an `awaiting_resolution` fixture.

#### `P3-11` — `inspect`, and the `planInspect` extension

**Depends on:** `P3-06`, `P3-09`; `D3-I`

**Modules**

- `packages/rules/src/actions/deterministic.ts` — `InspectInputs` gains
  `revealsItemId: string | null`, `revealedItemPortable: boolean`,
  `locationEntityId: string`, and `boardEntryAlreadyExists: boolean`.
  `planInspect` gains two effects: a `case_board_entries` insert
  (`entry_kind: "verified_evidence"`, `verification_status: "verified_physical"`)
  on `new_to_town` only, and an `items` conditional state change carrying
  `expectedRevision` (the table has a `revision` column) for a portable reveal.
  `packages/rules/src/actions/deterministic.test.ts` and the scenario fixtures
  are extended in the same commit.
- `application/actions/inputs/inspect.ts` — resolves those inputs, including
  the town-wide and player-scoped `clue_discoveries` existence checks.
- `game-server/persistence/discoveries.ts`.

**Acceptance**

1. The four discovery outcomes are each produced by a real fixture:
   `new_to_town` (first ever), `new_to_player` (second player), `already_discovered_by_player`
   (repeat), and `none` (an inspectable with no clue).
2. `new_to_town` creates exactly one `case_board_entries` row; `new_to_player`
   creates a second `clue_discoveries` row and **no** second board entry.
3. Two players inspecting the same undiscovered inspectable concurrently
   produce exactly one board entry, two discovery rows, and a `contributors`
   array of length two ordered by discovery sequence then player ID, whose
   first element equals `firstContributor`.
4. `already_discovered_by_player` writes nothing at all and returns
   `outcome: "no_change"`.
5. A portable reveal moves the item into `items.held_by_actor_id` and the item
   appears in the next `player-view`'s `inventory`; the Festival Bell
   (non-portable) returns `custody: { kind: "location", locationId: … }`, does
   not enter inventory, and leaves `items.held_by_actor_id` null.
6. Inspecting from a different location, and inspecting an inspectable in a
   locked location, are denied with `INSPECTABLE_NOT_FOUND` — the same code an
   unknown ID produces.
7. The inspect result's `clue` field carries only `clueId`, `title`,
   `description`, `firstContributor`, and `contributors`; the underlying
   `clue_claim_effects` rows and any belief consequence are absent.
8. A `packages/rules` regression test asserts the extended `planInspect` still
   emits nothing when `hasInspectable` is false.

#### `P3-12` — `leave` on an ineligible ambient range

**Depends on:** `P3-09`–`P3-11`; `D3-Q`

**Modules**

- `application/actions/inputs/leave.ts` — resolves `lastEventSequenceAtLeave`
  and `ambientScheduledThroughSequence` from `towns` inside the transaction,
  and `eligibleEventCountInRange` with a real `COUNT(*) … WHERE ambient_eligible
  AND sequence_no > $scheduledThrough AND sequence_no <= $lastEvent`.
- The `D3-Q` guard: `planLeaveVisit` returning an effect plan containing an
  `outbox` insert is treated as an invariant violation in Phase 3 — the
  executor rolls back and returns `500` with a stable internal code, never
  `transitionStatus: "waiting"`.

**Acceptance**

1. Leave after start → travel → inspect returns `transitionStatus: "not_required"`
   with `outcome: "applied"`, ends the visit, appends one `visit_ended` event,
   and advances `towns.ambient_scheduled_through_sequence` to the new
   `last_event_sequence`.
2. Zero `outbox` rows exist after the entire Phase 3 journey — asserted as a
   table-wide count, not a per-action check.
3. A repeat Leave is denied with `VISIT_NOT_ACTIVE`; a same-key replay returns
   the saved `not_required` response.
4. Two players departing concurrently allocate non-overlapping
   `(scheduledThrough, lastEvent]` boundaries: the second departure's lower
   bound equals the first's upper bound exactly.
5. On a fresh seed, the first range's lower bound is strictly greater than the
   final `system_seed` `sequence_no` — the direct proof that authored backstory
   is never reconsidered. `materializeTown` already sets
   `ambient_scheduled_through_sequence = last_event_sequence`, and this test is
   what keeps that true through the first departure.
6. A rolled-back Leave (forced constraint failure) leaves the visit `active`
   and `ambient_scheduled_through_sequence` unchanged.
7. **The Phase 5 seam.** A contract test enumerates all 20 members of
   `EVENT_TYPES` against `rules/world/visits.ts#computeAmbientEligible` and
   asserts that the four event types Phase 3 can produce — `visit_started`,
   `travelled`, `inspected`, `visit_ended` — are all ineligible, and that at
   least one other type is eligible so the table is not vacuously false. A
   second test drives the `D3-Q` guard directly with a synthetic eligible event
   and asserts a `500` with zero committed rows.
8. Immediate `start_visit` after a `not_required` Leave succeeds.

### Workstream E — Browser application

#### `P3-13` — Invite bootstrap and join UI

**Depends on:** `P3-03`–`P3-05`; `D3-T`

**Modules**

- `apps/web/src/routing/router.tsx` — eight routes, `history` based.
- `screens/JoinBootstrap.tsx` — reads `location.pathname`'s token into a
  module-scoped variable, calls `history.replaceState(null, "", "/join")`
  **synchronously in the component body, before any effect**, then renders
  `Join`. Nothing writes the token to `localStorage`, `sessionStorage`,
  IndexedDB, a URL, or a console line.
- `screens/Join.tsx` — preview fetch, existing-session probe, display-name
  form with client-side character and grapheme validation, first-time join.
  Writes `{ idempotencyKey, joinAttemptSecret }` to `sessionStorage` before the
  POST and clears the secret only after the first authenticated `player-view`.

**Acceptance** (`web` and `e2e` projects)

1. A Playwright test records every request and every `history` entry: the first
   entry after navigation is `/join` with no token, and it precedes the first
   `/api/` request in time. This is asserted from the recorded orderings, not
   by a screenshot.
2. After bootstrap, `localStorage`, `sessionStorage`, IndexedDB, and
   `document.cookie` are each scanned for the token substring and it is absent
   from all four; the console log is scanned too.
3. Refreshing `/join` before authentication shows `Reopen the invite link to
   continue` and issues no preview request.
4. Existing-cookie resume shows `Return as {displayName}` and issues no join
   POST.
5. `read_only` and `closed` towns show `Read what the town remembers` and the
   closed-town state respectively, with no name field.
6. A server-side name conflict keeps the field populated, selects its text, and
   shows the conflict copy; no second POST is issued automatically.
7. The join secret is never rendered, never in a `data-*` attribute, and never
   in the DOM — asserted against `document.documentElement.outerHTML`.

#### `P3-14` — Shell, guards, map, and location scene

**Depends on:** `P3-06`, `P3-10`, `P3-11`

**Modules**

- `screens/Shell.tsx` — the Decision 011 desktop composition; `Map` and
  `Satchel` drawers below 1100px; `More` menu below 720px.
- `routing/guards.tsx` — every guard reads the current `player-view`, never
  local state: `away` → `/between-visits`, stale `location` → current location,
  `resolved` → `/resolution`, `frozen` → readable but non-mutating.
- `api/playerView.ts` — 5s visible / 30s hidden polling, immediate refresh on
  visibility change and after any terminal action, `If-None-Match` on every
  poll, and no React state replacement on `304`.
- `screens/Map.tsx`, `screens/Location.tsx`, `components/ResultCard.tsx`,
  `components/LockedNotice.tsx`.

**Acceptance**

1. At a 320px viewport, every action control and every piece of evidence is
   reachable with no horizontal scrollbar (`document.documentElement.scrollWidth
   <= clientWidth`).
2. A `304` poll does not remount the location scene: a component-identity probe
   asserts the same DOM node persists and focus is retained.
3. No optimistic state: a component test intercepts the travel POST, holds it
   open, and asserts the map still shows the old location and every mutation
   control is disabled.
4. Route guards are driven by the projection — a test that mutates the
   `player-view` fixture to `away` redirects without any client-side inference
   from the last action.
5. An unknown `sceneKey` renders the neutral placeholder and calls the
   `onAssetLookupFailure` listener exactly once; no remote request is made.
6. Keyboard: tab order matches DOM reading order across the header, rail,
   scene, and casebook; focus moves to the heading of a newly opened result
   card; `Escape` closes the Leave sheet but does not submit it.
7. Empty inventory and empty promises render the exact Decision 011 copy
   (`You are carrying nothing.` / `You have made no active promises.`).

#### `P3-15` — Local action journal and recovery UI

**Depends on:** `P3-08`, `P3-09`

**Modules**

- `journal/db.ts` — IndexedDB store matching Decision 011's
  `PendingActionJournal` shape exactly, keyed by `(townId, playerId)`.
- `journal/channel.ts` — `BroadcastChannel` announcement so a second tab enters
  read-only pending mode.
- `journal/machine.ts` — the recovery state machine as a pure reducer over
  `(state, event, elapsedMs)`, so every row of Decision 011's table is a unit
  test rather than a timing-dependent browser test.
- `api/actions.ts` — POST, `202` polling at `pollAfterMs`, one takeover POST at
  35s, manual-only after 70s, one automatic resend after a 1s
  `ACTION_CONFLICT`.

**Acceptance**

1. `machine.ts` is unit-tested for all eleven rows of Decision 011's recovery
   table, including that no transition ever allocates a new idempotency key
   except the explicit `Try as a new action` click.
2. The journal entry is written before the first POST and deleted only after
   the terminal render **and** the subsequent `player-view` fetch — asserted by
   ordering, with a forced failure of the refresh leaving the entry in place.
3. A page reload mid-flight recovers from the journal and reaches the same
   terminal result through the status URL, with exactly one server-side effect.
4. Offline during a POST shows `Connection lost. Your action is still safe.` and
   resumes on `online` with the identical body and key — asserted by comparing
   the outbound request bodies byte for byte.
5. A duplicate click issues one POST; a second tab shows read-only pending mode.
6. The journal contains no cookie, invite token, join secret, or session token —
   asserted by dumping the whole object store and running `findSensitiveMarkers`.
7. `IDEMPOTENCY_KEY_REUSED` blocks automatic retry and shows the refresh copy
   with the request ID in expandable details.

#### `P3-16` — Leave, away, and start-visit presentation

**Depends on:** `P3-12`, `P3-14`, `P3-15`

**Modules**

- `screens/Away.tsx`, plus the Leave confirmation sheet.

**Acceptance**

1. The Leave sheet lists active promise summaries (empty in Phase 3, so the
   empty-state copy is what renders) and predicts no outcome.
2. `not_required` routes straight to the away screen with `Your visit is
   complete` and an immediately enabled `Return to Festival Square`.
3. No time-passes stage, no `waiting`/`processing` heading, no progress
   indicator, no gossip language, and no transition retry control appears
   anywhere in the Phase 3 build — asserted by scanning the rendered away and
   map screens for each Decision 011 transition string.
4. The map appears only after the `start_visit` completed response **and** the
   refreshed `player-view` — a test holding the refresh open asserts the away
   screen is still shown.
5. `Leave town` is disabled with an explanation while any action is pending.

### Workstream F — Security, observability, verification, and docs

#### `P3-17` — Slice security controls and adversarial tests

**Depends on:** `P3-02`–`P3-16`

**Modules**

- A `security` vitest suite spanning `packages/game-server` and `apps/web`.
- `scripts/check-workspace-boundaries.mjs` — the `D3-C` validator.

**Acceptance**

1. Every SQL statement in `packages/game-server/src/persistence/**` is
   parameterized: a source scan rejects any template literal inside a
   `query(` call that contains `${`.
2. Every gameplay query names `town_id`: a source scan asserts each exported
   persistence function's SQL contains `town_id = $` at least once, with an
   explicit, reviewed exemption list (`town_creation_requests`, whose PK has no
   town, and the health route).
3. Cross-tenant probes — another town's location ID, inspectable ID, action ID,
   player ID, and clue ID — each return the same response as a nonexistent ID.
4. XSS: `<script>`, `&#60;`, a zero-width joiner, and a right-to-left override
   in a display name are each rejected before any write, by
   `DisplayNameSchema`'s existing pattern and `plainText`'s control-character
   refusal.
5. CSRF: a POST from a foreign `Origin`, and a POST with no `Origin`, are both
   rejected before authentication.
6. Log redaction: every `SENSITIVE_TEST_MARKER` is injected into each of the
   eight allowlisted headers, the body, the path, and the query, and
   `findSensitiveMarkers` finds nothing in the captured stdout of the whole
   journey. Every emitted event's property names are disjoint from
   `FORBIDDEN_LOG_PROPERTIES`.
7. `runtime-config/security` cannot be imported from `apps/web`,
   `apps/ambient-worker`, `apps/recovery-worker`, `infrastructure`, or any
   `packages/*` other than `game-server` — asserted by the boundary checker's
   own `node:test` suite.
8. `pnpm check:bundle` still passes: the browser bundle mentions neither
   `@the-town-remembers/serialization` nor any `JUDGE_CODE`/`SESSION_SECRET`
   pattern.
9. A documented route/logging checklist records that CloudFront and S3 access
   logging stay disabled and that API Gateway access logs carry only request
   ID, route template, status, and latency when Phase 7 deploys.

#### `P3-18` — Instrumentation

**Depends on:** `P3-02`, `P3-08`–`P3-12`

**Modules**

- `game-server/observability/events.ts` — closed union adding
  `action_lifecycle` (kind, status, attempt, safe operation ID, transaction
  retry count, takeover, stale-worker rejection, ambiguous-commit resolution,
  terminal error code) and `rate_limit_decision`.
- `game-server/observability/metrics.ts` — HTTP latency/status, action
  processing age, retries, conflicts, rate-limit decisions, and
  `ACTION_PROCESSING_EXHAUSTED` count.

**Acceptance**

1. The event union has no field typed `string` that could hold player text: a
   type-level test asserts every event's non-enumerated string fields are
   restricted to ID-shaped branded types or the route-template union.
2. Metric dimension values are drawn only from closed enums — asserted by a
   runtime check that every emitted dimension value is a member of its declared
   set.
3. A retried transaction reports its retry count; a takeover reports the
   rejection; an ambiguous commit reports its resolution. Each is asserted from
   captured stdout, not from a spy.
4. A documented p50/p95/p99 baseline table is written with the locally measured
   numbers and an explicit note that Phase 7 measures the deployed values.

#### `P3-19` — Acceptance suite and operator documentation

**Depends on:** every prior Phase 3 task

**Modules**

- `e2e/phase-03-first-playable.spec.ts` — the single ordered journey.
- A fresh-seed fixture built through the **real** `POST /api/v1/towns` route,
  not `materializeTown` directly, so the acceptance path exercises the ledger.
- Cleanup that reuses `DISPOSABLE_NAME_PATTERN`, so it cannot target a
  non-disposable database.
- `packages/game-server/README.md` and a `CONTRIBUTING.md` section: starting
  the pair, seeding, running each suite, reading action recovery, and the
  deliberate Phase 4/5 exclusions.

**Acceptance**

1. The journey, in one test: create town (idempotently, twice) → open invite →
   preview → join → resume after reload → `player-view` → travel → inspect →
   refresh → replay one action with the same key → leave → away → start visit.
2. The replayed action produces one `world_events` row, verified by querying
   the test database from the Playwright test's fixture.
3. Trace evidence is written to an artifact containing request IDs, action IDs,
   and event IDs, and `findSensitiveMarkers` is run over it.
4. The documentation claims no public-cloud deployment.

## 6. Commands

Existing scripts are reused; three are added.

| Command | Purpose |
|---|---|
| `pnpm db:up && pnpm db:migrate` | Local CockroachDB for the DB-backed suites |
| `pnpm test:contracts` | `contracts` project — schema conformance (`P3-01`) |
| `pnpm test:api` *(new)* | `vitest run --project api` — `packages/game-server` pure suites |
| `pnpm test:db` | `database` project — now also every `*.db.test.ts` in `game-server` |
| `pnpm test:web` *(new)* | `vitest run --project web` — component, guard, journal, a11y |
| `pnpm test:e2e` | Playwright, including `phase-03-first-playable` |
| `pnpm check:assets` *(new)* | `node scripts/check-asset-keys.mjs` (`D3-K`) |
| `pnpm check:boundaries` | Now also enforces `./security` and `game-server`'s deps |
| `pnpm validate` | Gains `pnpm check:assets` after `check:boundaries` |

`playwright.config.ts` gains a third `webServer` entry only if the journey needs
a seeded database at start-up; the preference is for the test itself to create
its town through the API, which needs no new server.

## 7. Goals

Phase 3 is complete when all of these hold.

| ID | Goal |
|---|---|
| `G1` | One `packages/game-server` package exists; `apps/game-api` contains only adapters and config |
| `G2` | All seven `ROUTE_TEMPLATES` are served; every other path and method is an identical `404` |
| `G3` | Town creation is idempotent under concurrency, freezes content and key versions, and stores no invite plaintext anywhere |
| `G4` | Invite preview exposes exactly six fields and no player, case, or hidden data |
| `G5` | Join creates exactly one player under concurrent replay, obeys the three-session cap, and closes on confirmation or expiry |
| `G6` | Display-name uniqueness holds under NFKC and full case folding against players and authored NPCs |
| `G7` | Two towns' cookies coexist and never cross; a wrong-town cookie is `401` |
| `G8` | Monthly reissuance elects exactly one concurrent response |
| `G9` | `PlayerView` validates exactly, is order-stable under shuffled row order, and supports `304` |
| `G10` | A hidden-only database change does not alter the `ETag` |
| `G11` | `towns.revision`, belief scores, trust, and suspicion appear in no response, ETag, log, or browser store |
| `G12` | Every rate-limit scope is enforced atomically; a `429` consumes no idempotency key and creates no ledger row |
| `G13` | The action ledger implements every row of Decision 006's idempotency table, proved as a pure function and against real concurrency |
| `G14` | One action processes per player; a stale worker cannot commit after takeover |
| `G15` | Same-key replay returns the byte-equivalent saved response with no duplicate event or discovery |
| `G16` | An ambiguous commit is resolved from the ledger, never by a blind retry |
| `G17` | Start, Travel, Inspect, and Leave all run through the one executor; rule denials are `200` completed responses |
| `G18` | Inspect distinguishes all four discovery outcomes, preserves one shared board card, and honors portable versus location-held reveal |
| `G19` | Leave consumes an ineligible disjoint range, writes no outbox row, and permits immediate re-entry; the eligible branch is an explicit `500`, never a fake `waiting` |
| `G20` | The invite capability leaves the URL before the first fetch and is absent from every persistent browser store |
| `G21` | The browser applies no optimistic state and survives reload, offline, duplicate click, conflict, and takeover with one body and one key |
| `G22` | Phase 4/5 action kinds return a stable `422` with no action row |
| `G23` | `packages/content` owns every player-visible presentation string, and content/web asset keys cannot drift |
| `G24` | `pnpm validate` passes end to end, including the 90% coverage threshold over `packages/game-server/src` |

## 8. Execution order and commit plan

Nineteen tasks, twenty-one commits. Two tasks split because they carry a change
to another package that deserves its own reviewable diff.

| # | Commit | Task |
|---:|---|---|
| 1 | `feat(config): add the security configuration category` | `D3-C` prerequisite of `P3-03` |
| 2 | `feat(game-server): scaffold the transport helpers and widened request` | `P3-01` |
| 3 | `feat(game-server): add the router and uniform failure boundary` | `P3-02` |
| 4 | `feat(content): add player-safe presentation strings and asset keys` | `D3-J`/`D3-K` prerequisite of `P3-06` |
| 5 | `feat(game-server): add idempotent town creation and invite preview` | `P3-03` |
| 6 | `feat(game-server): add idempotent join and replay closure` | `P3-04` |
| 7 | `feat(game-server): authenticate and refresh town-scoped sessions` | `P3-05` |
| 8 | `feat(game-server): add the version-one player-view projection` | `P3-06` |
| 9 | `feat(game-server): add transactional rate limiting` | `P3-07` |
| 10 | `feat(game-server): add action identity and processing claims` | `P3-08` |
| 11 | `feat(game-server): add the atomic deterministic action executor` | `P3-09` |
| 12 | `feat(game-server): connect start_visit and travel` | `P3-10` |
| 13 | `feat(rules): plan the board entry and item reveal for inspect` | `D3-I`, split from `P3-11` |
| 14 | `feat(game-server): connect inspect` | `P3-11` |
| 15 | `feat(game-server): connect leave for an ineligible ambient range` | `P3-12` |
| 16 | `feat(web): add secure invite bootstrap and join` | `P3-13` |
| 17 | `feat(web): add the shell, guards, map, and location scene` | `P3-14` |
| 18 | `feat(web): add the action journal and recovery state machine` | `P3-15` |
| 19 | `feat(web): complete leave, away, and start-visit presentation` | `P3-16` |
| 20 | `test(security): close the slice's adversarial coverage` | `P3-17` |
| 21 | `feat(game-server): instrument the synchronous slice` | `P3-18` |
| 22 | `test(e2e): run the vertical-slice acceptance suite and document it` | `P3-19` |

Commits 1–3 and 4 are independent of each other and of 5; everything from 5
onward is strictly sequential except the browser trio 16–19, which can begin as
soon as 8 and 11 have landed. `pnpm validate` must pass at every commit, which
is why commit 13 (a `packages/rules` change) precedes commit 14 rather than
being folded into it.

## 9. Discrepancies found while planning

### 9.1 `planInspect` plans neither the board entry nor the item reveal

`packages/rules/src/actions/deterministic.ts#planInspect` emits exactly two
effects: an `event_origin` for `inspected`, and a `clue_discoveries` insert when
`shouldRecordClueDiscovery(discovery)` and `clueId !== null`. Decision 006
requires the same action to produce the town's **first shared verified-evidence
board record** and a `revealedItem` with `custody` distinguishing
`player_inventory` from `location`. Decision 005 says the shared board entry is
created by the first `clue_discoveries` row.

Neither effect exists in the plan, so a naive Phase 3 would write both in
`packages/game-server` — creating a second rules authority, which is exactly
what Phase 2 exists to prevent. `D3-I` resolves this by extending `planInspect`
inside Phase 3 (commit 13). The extension is a genuine Phase 2 omission, not a
contract change: nothing in Decision 006, 008, or 009 moves.

The same reading was applied to the other three planners and they are complete:
`planStartVisit` emits the `player_visits` insert, `planTravel` emits both
conditional state changes, and `planLeaveVisit` emits the visit end, the
`towns` scheduling advance, and the conditional `outbox` insert.

### 9.2 Decision 009's "Role" column is not a player-safe `roleLabel`

`EncounterView.roleLabel` is player-visible and part of the hashed projection.
Decision 009's authored character table gives:

- `mara_venn` → *"Innkeeper and Lark's protective older sister"*
- `corin_hale` → *"Town guard who moved the bell"*
- `nessa_reed` → *"Herbalist and keeper of the chapel key"*

Decision 009 separately requires that the opening "does not expose Lark, the Old
Chapel's relevance, or Corin's involvement". Rendering those three strings as
`roleLabel` on the first encounter would expose all three on the first screen of
the game — Corin's most directly, since *"who moved the bell"* is the solution.

`D3-J` therefore treats that column as an authoring design note and adds three
new player-safe labels: `Innkeeper`, `Town guard`, `Herbalist`. This is new
authored copy inside `bell-mystery-v1` rather than a contract change, and it is
the only new player-visible copy Phase 3 introduces. If the intent was for the
long forms to be player-visible, that is a Decision 009 amendment, not a Phase 3
defect.

### 9.3 The "repositories" Phase 3 is documented as inheriting do not exist

Phase 3's prerequisites list "Repositories that enforce composite `town_id`
scope", and Phase 1's `P1-13` deliverable is titled "database-shaped types and
adapters". What shipped is the generated Kysely interface, the branded column
types, the closed domains, the bounded pool, and `runSerializable` — no query
layer. The only gameplay SQL in the repository is `town-seed`'s materializer.

This is not a Phase 1 shortfall in substance (the phase's exit gate was about
schema and seed, both of which hold), but it does move roughly a thousand lines
of work into Phase 3 that its plan's task descriptions assume are already done.
The effort estimate for Phase 3 (10–15 engineer-days) should be re-checked
against that; `P3-06`, `P3-08`, and `P3-09` each carry a persistence module
that the phase plan treats as a thin call.

### 9.4 `api_rate_limits` has no `town_id` column

Its primary key is `(scope_kind, scope_key, bucket_kind)` and it is the only
gameplay-adjacent table without a `town_id`. Decision 006's per-player and
per-town rate scopes are therefore not expressible as a plain foreign key, and
the "preserve town isolation in every key" cross-cutting rule can only be
satisfied by folding the town into `scope_key`. `D3-F` does that with a
domain-separated preimage, and `P3-07`'s acceptance item 8 is the test that
would catch it being dropped.

It is also the only table `app_runtime` may `DELETE` from
(`0013_grants.sql`), which the plan does not otherwise use — pruning buckets
older than 24 hours is available but is not a Phase 3 requirement.

### 9.5 `apps/web` cannot import `packages/content`

`scripts/check-bundle-safety.mjs` forbids the substrings
`@the-town-remembers/serialization` and `node:crypto` in the built bundle;
`packages/content` depends on `serialization`, which imports `node:crypto` in
`digest.ts`. So the frozen content version's presentation strings — which
Decision 011 says the browser must receive from the server anyway — genuinely
cannot be read directly by the web bundle, and the asset-key manifest must stay
duplicated between `packages/content` and `apps/web/src/assets/manifest.ts`.

`D3-K` makes that duplication safe with a drift script rather than removing it.
The alternative — splitting `packages/content` into a browser-safe
presentation-only entry point with no `serialization` dependency — is cleaner,
but it changes a Phase 1 package boundary for a seven-string table.

**Decided: deferred to Phase 6.** Phase 6 owns the real illustrations, so it is
the phase that will touch this table anyway, and doing the split there costs one
boundary change instead of two. Phase 3 ships the duplication plus
`scripts/check-asset-keys.mjs`; Phase 6 may delete both if it takes the split.
Phase 3 must not be graded on removing the duplication.

### 9.6 The `frozen` visit status has no producer in Phase 3

`PlayerView.player.visit` admits `{ status: "active" | "frozen"; … }`, and
Decision 006 says an `awaiting_resolution` town keeps active visits visible but
non-mutating. Nothing in Phase 3 can reach `awaiting_resolution`, because
`accuse` is a Phase 6 action kind. `P3-14`'s guard for `frozen` is therefore
tested against a fixture whose town status was set directly, not against a
journey. That is honest coverage of the projection and the guard, but it is not
coverage of the transition, and Phase 6 owns proving the transition itself.

### 9.7 Decision 006's `503 MODEL_UNAVAILABLE_RETRY_ACTION` is unreachable

The code exists in `PROBLEM_CODES` and is required by the normalization path,
which is Phase 4's. Phase 3 must not emit it, and no Phase 3 dependency can
produce it — there is no model client. `P3-02`'s problem-mapper test asserts
the code is unreachable from any Phase 3 error path, so a later phase adding it
does so deliberately.
