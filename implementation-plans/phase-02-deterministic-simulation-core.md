# Phase 2 — Deterministic Simulation Core

- **Status:** Detailed implementation plan
- **Depends on:** Phase 1 exit gate
- **Produces:** Versioned pure rules, transition plans, safe projections, and
  exhaustive deterministic verification for `mvp-rules-v1`
- **Task ID prefix:** `P2-`

## 1. Objective and user-visible proof

Implement pure TypeScript as the single authority for every gameplay decision,
score, gate, state transition, event classification, recall ordering, ambient
candidate, case outcome, and player-safe projection in the accepted MVP.

The proof is a deterministic scenario runner and test suite. Given a frozen
`bell-mystery-v1` snapshot plus explicit actors, actions, clock, and operation
identities, it emits the same ordered decision/effect plan and player-safe
projection on every run without CockroachDB, Bedrock, SQS, network access, or
ambient randomness. The proof covers the accepted worked balance examples,
both chapel routes, repeat protection, promises, case resolution, hidden-state
leakage, and safe behavior when model-selected choices are absent or invalid.

The scenario runner is an engineering artifact rather than a playable UI. It
may print canonical stable keys, rule decisions, and effect explanations; it
must not print hidden truth as though it were a player response.

## 2. Scope

### In scope

- An immutable rules registry for `mvp-rules-v1` and typed rule input/output
  boundaries.
- Claim canonicalization keys, predicate/type checks, deterministic relations,
  contradiction mirrors, reversals, source independence, and corroboration.
- Belief and relationship calculation, labels, contestation, stance, repeat
  protection, and event-order reconstruction.
- Disclosure, item, access, clue, capability, promise, grievance, visit,
  event-range, case-board, accusation, resolution, and ending rules.
- Episodic recall scoring and stable top-eight selection.
- Ambient candidate eligibility, priority/top-12 ordering, hop/provenance
  checks, and bounded application of zero to two supplied choices.
- Pure action planners for the closed action vocabulary, producing ordered
  effects and denials but performing no persistence or model invocation.
- Player-safe view/action-result projectors and exact view-version/ETag hashing.
- Content/rules reachability, fallback-coverage, and no-soft-lock validation.
- Deterministic traces sufficient to explain why a decision or numerical effect
  occurred without logging raw player text or hidden data into player output.
- Unit, property, scenario, content, and leakage tests for the entire accepted
  deterministic matrix.

### Explicitly out of scope

- Database reads/writes, transactions, migrations, or repository orchestration;
  Phase 1 owns persistence and later phases commit the returned effect plans.
- HTTP authentication, cookies, route handlers, request-ledger claiming,
  polling, browser recovery, or rate-limit execution; Phase 3 owns them.
- Model invocation, embeddings generation, prompt construction, dialogue
  rendering selection, structured repair, or prompt evaluations; Phase 4 owns
  them.
- SQS publication/consumption, worker leases, Recovery Lambda, or cloud
  scheduling; Phase 5 owns them.
- React components, final assets, screen flows, or browser accessibility.
- Any model or heuristic decision about objective truth, promise status,
  accusation correctness, score, or gate outcome.
- New predicates, promise kinds, mystery content, numerical tuning, procedural
  endings, or changes to `bell-mystery-v1`/`mvp-rules-v1`.

## 3. Prerequisites and accepted contracts

### Required prior outputs

- `P0-04` strict HTTP/player-safe schemas and `P0-06` canonical JSON/hash
  primitives.
- `P1-13` database-shaped types/adapters without importing a database client
  into rule packages.
- `P1-15`/`P1-16` immutable content registry and static content validation.
- `P1-17` exact seeded-town snapshots for scenario fixtures.
- `P1-19` causal inspection semantics used to shape deterministic explanations.

### Normative accepted sources

- Decision 008 is authoritative for calculations, thresholds, action order,
  repeat rules, recall formula, ambient selection, and case progression.
- Decision 005 owns persisted identities, value domains, event ordering,
  source columns, state machines, uniqueness, and current/history alignment.
- Decisions 001 and 003 own the separation of objective state, claims,
  episodes, beliefs, model visibility, and player visibility.
- Decision 006 owns action/result unions, outcome semantics, projection order,
  provenance order, promise-offer encoding, and player-view hashing.
- Decision 009 owns content bindings, relevance, starting state, two chapel
  routes, caught-lie knowledge test, exact confrontation gate, options,
  endings, and no-soft-lock requirements.
- Decision 010 owns the boundary between deterministic candidate/validator code
  and model selection; this phase creates allowed bundles and validates selected
  IDs but never calls a model.
- Decision 011 owns presentation-safe distinctions and prohibits optimistic or
  hidden-state-derived client facts.

Every rule function receives an explicit rules/content version, clock, and any
needed operation/event identities. It must not read wall-clock time, allocate a
random UUID, access process environment, query persistence, or call a network
service internally.

## 4. Ordered workstreams and tasks

### Workstream A — Pure domain kernel

#### P2-01 — Define rules registry, immutable inputs, and effect plans

**Depends on:** Phase 1 exit gate

**Deliverables**

- Immutable `mvp-rules-v1` registry containing all accepted numeric constants,
  thresholds, limits, enum order, and content-version compatibility.
- Pure domain inputs that distinguish canonical simulation state, world-event
  history, NPC-scoped knowledge, and player-safe presentation inputs.
- A common decision result: allowed/applied/no-change/denied plus stable reason
  code, ordered typed effects, expected preconditions/revisions, and an
  inspection-safe rule trace.
- Effect-plan types covering inserts, conditional current-state changes, event
  origin/effect index, and derived response data without SQL or Kysely objects.
- Injected UTC time and stable identity source used only by scenario/test
  orchestration; core calculations consume identities rather than creating
  them.

**Determinism checks**

- Inputs are treated as immutable; repeated evaluation cannot mutate fixtures.
- Map/set/object iteration is normalized to an explicit accepted order before
  it affects an output.
- Traces contain rule version, stable IDs/keys, inputs used, and reason codes,
  but no raw player text, secret, cookie, token, or hidden field in a
  player-facing result.

#### P2-02 — Implement numeric and event-order primitives

**Depends on:** `P2-01`

**Deliverables**

- Integer clamp to `[-100, 100]`, mathematical floor behavior for negative
  values, and safe integer assertions.
- Stable event ordering by `world_events.sequence_no`, with all contributions
  from one event summed by target and clamped once.
- Score-ledger reconstruction helpers for beliefs and relationships.
- Stable sort/tie-break helpers for opaque IDs, normalized keys, timestamps,
  authored order, and causal event order.
- Version/assertion helpers that reject a mismatched content/rules pair rather
  than silently using current defaults.

### Workstream B — Claims, beliefs, and relationships

#### P2-03 — Implement claim grammar and canonical claim identity

**Depends on:** `P2-01`, `P2-02`

**Deliverables**

- Pure validation of the five accepted predicate signatures, positive/negative
  polarity, canonical entity kinds, supplied contexts, and optional explicit
  alleged source.
- A documented, versioned canonical serialization for `normalized_key`, shared
  by seeded and dynamic claims and independent of display copy or object-key
  order.
- Deterministic positive/negative opposite relations and mutually exclusive
  same-context location relations.
- Authored semantic relation merge for
  `corin_protected_lark`/`corin_acted_for_safety` without generalizing it into a
  universal single-motive rule.
- A relation/backfill plan for missing contradiction mirrors when a valid new
  claim is created, using the claim-creation event as causal identity.

The accepted contracts do not specify the exact bytes of `normalized_key`.
`P2-03` must record this narrow representation decision and freeze it for
`mvp-rules-v1` before seed/dynamic identity fixtures are accepted.

#### P2-04 — Implement belief evidence weights and repeat protection

**Depends on:** `P2-02`, `P2-03`

**Deliverables**

- Direct observation `+80` and clue `+70`/`-70` contributions.
- Player testimony
  `clamp(35 + floor(player_trust / 10), 25, 45)` and NPC testimony
  `clamp(40 + floor(listener_trust / 10), 30, 50)`, each reduced by `10` per
  hop to a minimum support of `10`.
- Independent-source identity by root speaker, one testimony contribution per
  NPC/claim/source, and corroboration deltas at active-source thresholds two
  and three.
- Supporting-evidence contradiction mirrors, explicit negative clue effects,
  coalescing, no recursive mirrors, source reversal, exact opposite weights,
  threshold removal/recrossing, and no double reversal.
- An ordered append-only evidence plan and current aggregate
  `clamp(sum(weights), -100, 100)`.

**Acceptance checks**

- Repeated player assertions, another descendant transmission from the same
  root, repeated Show, or API replay adds no numerical weight.
- A broken promise does not reverse testimony; only a targeted
  `source_discredited` event does.
- A false claim affects evidence and belief plans but never emits an item/world
  truth mutation.

#### P2-05 — Implement belief labels, contestation, and selected belief

**Depends on:** `P2-04`

**Deliverables**

- Stored labels: `convinced` at `60..100`, `leaning` at `20..59`, and
  `doubtful` below `20`.
- Dialogue stance distinction for explicit rejection at `-20` or below.
- Contradictory-set lead calculation, using zero when no contradictory claim
  has evidence.
- Selected-belief rule requiring score at least `20` and lead at least `20`;
  contested sets unlock no belief-dependent gate.
- Explicit cover-story exception represented as authored permission, never as
  objective truth or an implicit score override.

#### P2-06 — Implement relationship changes, stance, and grievances

**Depends on:** `P2-02`, `P2-04`

**Deliverables**

- Exact accepted deltas for verified testimony, evidence presentation,
  requested item, fulfilled/broken promise, and established lie.
- Same-event stacking from a common pre-event snapshot, with the special rule
  that a clue establishing a knowing lie does not also grant positive clue
  rewards in that Show event.
- Exact repeat keys for every relationship reason and zero-row behavior for
  unsupported/irrelevant/repeated dialogue.
- Stance precedence: suspicious at suspicion `>=40`, else trusting at trust
  `>=40`, else wary at trust `<=-20`, else neutral.
- Permanent broken-promise/established-lie grievance flags used by recall and
  disclosure without model-generated forgiveness.

### Workstream C — Disclosure, items, promises, and world actions

#### P2-07 — Implement disclosure bundles and information boundaries

**Depends on:** `P2-05`, `P2-06`, `P1-15`

**Deliverables**

- Gates for public, guarded, confidential, cover-story, and final-truth tiers
  using exact thresholds and current-action relevant-clue exception.
- Belief/contestation and observation-versus-reported-speech framing layered
  after tier permission.
- An `ApprovedDisclosureBundle` builder containing only NPC-scoped authorized
  claims, episodes, source/provenance references, deterministic outcomes,
  required/allowed IDs, and qualitative stance.
- Negative tests showing Mara's initial context contains no chapel truth,
  Nessa's seed observation does not authorize cart-load truth, and pre-gate
  Corin never exposes final truth through the bundle. A later valid
  transmission may still change an NPC's knowledge.

The builder has no database client and accepts no general objective-state row.
It receives only narrowly selected deterministic inputs needed for a mechanical
outcome.

#### P2-08 — Implement clue, inspection, custody, and access rules

**Depends on:** `P2-03`, `P2-06`, `P1-15`

**Deliverables**

- Inspect availability and exact discovery outcomes:
  `new_to_town`, `new_to_player`, `already_discovered_by_player`, and `none`.
- First-discoverer board contribution versus later ordered attribution, with no
  repeat write.
- Item reveal distinction between non-portable location custody and portable
  player inventory.
- Show authorization for town-discovered clues or currently held items;
  structured effect only through authored clue linkage; showing never changes
  custody.
- Conditional Give transfer plan against item revision and accepted requested-
  item relationship effects.
- Chapel entry when the player holds `old_chapel_key` or has
  `enter_old_chapel`.
- Corin authorization after the same Show action's predicted relationship
  effects: required clue, trust `>=40`, suspicion `<20`, bell not revealed.
- Safe generic denials for hidden, inaccessible, moved, or cross-town targets;
  transport maps them uniformly later.

#### P2-09 — Implement promise offers, acceptance, and resolution

**Depends on:** `P2-06`, `P2-08`, `P1-15`

**Deliverables**

- Deterministic promise-offer descriptor creation in ordinal order and exact
  `base64url(UTF8("promise-offer:v1\n" + sourceActionId + "\n" + ordinal))`
  encoding/decoding.
- Acceptance validation against the saved descriptor and retained terms
  version, same town/player/visit/NPC, current gates, and active-promise
  uniqueness; forged or stale offers are denied.
- Atomic Nessa key-loan plan creating `return-chapel-key-v1` and transferring
  the key only when post-effect trust `>=40`, suspicion `<40`, Nessa holds the
  key, bell is unrevealed, and no active equivalent promise exists.
- `keep-lark-accident-secret-v1` offer after Mara's first qualifying
  confidential disclosure.
- Keep-secret break on exact protected structured transmission to anyone other
  than Mara; return-item fulfillment to requester, break on transfer to another
  actor, and no effect merely from leaving town.
- Ending-time promise resolution and one-time relationship effects.

#### P2-10 — Implement visits, travel, notes, and event classification

**Depends on:** `P2-01`, `P2-08`, `P1-15`

**Deliverables**

- Start Visit: active-town requirement, completed/quarantined/absent prior
  transition requirement, Festival Square start, and existing-active-visit
  no-change result.
- Travel: authored destination/access checks and already-there no-change result.
- Note: active/unfrozen visit, trimmed plain text, `1..280` grapheme clusters,
  immutable attribution, and no clue/gate/belief/promise effect.
- Event-type/effect ordering and deterministic `ambient_eligible`
  classification. Travel, ordinary Ask, inspection alone, notes, and
  non-evidentiary custody movement are ineligible; structured belief creation
  or material change follows the accepted content/rule mapping.
- Leave plan that ends the visit, appends departure, allocates the next disjoint
  `(scheduledThrough, lastEvent]` range, advances the boundary even when
  ineligible, and creates an outbox intent only when the range contains an
  eligible event.
- Proof that an event above a tick's assigned upper bound cannot be consumed by
  that same tick.

This task returns an atomic plan and expected town revision. Phase 3/5
repositories perform the locks, conditional writes, outbox insert, and publish.

#### P2-11 — Implement knowing-lie detection

**Depends on:** `P2-04`, `P2-06`, `P2-08`

**Deliverables**

- The four-part authored test: direct player confirmation to this NPC, a
  physically verified contradicting clue visible to that player at confirmation,
  later clue presentation/direct knowledge by the same NPC, and no prior
  `lie_established` for the player/NPC/claim.
- A targeted `source_discredited`/reversal plan plus one-time relationship
  consequence.
- Fixtures proving mere contradiction, mutually inconsistent claims without
  prior physical knowledge, or another NPC's knowledge does not establish a
  lie.

### Workstream D — Recall and ambient propagation

#### P2-12 — Implement deterministic episodic recall ranking

**Depends on:** `P2-02`, `P2-05`, `P2-06`

**Deliverables**

- Stored minimum importance values and effective contradiction floor `80`
  without mutating episode records.
- Candidate union/deduplication of at most 30 already-authorized vector
  candidates and at most 10 structured anchors.
- Exact seven-day/168-hour exponential half-life and normalized weighted score:
  similarity 45%, recency 15%, importance 15%, directness 10%, active
  promise/grievance 10%, active contradiction 5%.
- Exact directness values, boolean flags, clamp behavior for similarity,
  top-eight limit, and tie-break by newer occurrence then opaque episode ID.
- Embedding-unavailable mode using similarity zero and structured anchors only,
  never widening town, NPC, or disclosure scope.

Authorization happens before this ranker. The ranker must not receive hidden or
cross-NPC candidates and then rely on a low score to hide them.

#### P2-13 — Implement ambient eligibility and shortlist generation

**Depends on:** `P2-05`, `P2-07`, `P2-10`, `P2-12`, `P1-15`

**Deliverables**

- Candidate source rule: direct claim reference in the assigned range or a
  top-eight speaker recall sharing a canonical entity with an eligible event.
- Exact provenance source requirement, selected belief/cover-story gate,
  directed contact edge, tier/trust gate, dynamic-claim guarded default,
  confidential/final-truth exclusion, hop maximum three, no provenance-chain
  revisit, and recipient/source repeat exclusion.
- Exact integer priority
  `50 * triggering_event_match + max(0, speaker_belief_score) +
  20 * recipient_holds_contradictory_belief +
  floor((listener_trust_in_speaker + 100) / 10) -
  10 * proposed_hop_count`, followed by stable order on descending priority,
  normalized claim key, speaker ID, and recipient ID.
- Top-12 shortlist plus explicit `do_nothing`, with narrative preferences
  passed as data only after deterministic order is fixed.
- Fixtures for the expected Mara-to-Nessa garden-rumour path and valid Corin
  fallback, each yielding hop-one testimony weight `+32` while the item remains
  at the chapel.

#### P2-14 — Validate and apply bounded ambient selections

**Depends on:** `P2-13`

**Deliverables**

- Pure semantic validator for zero, one, or two supplied choice IDs.
- Pre-tick plus earlier-valid-selection evaluation in returned order.
- One claim hop per tick, one outgoing transmission per source NPC, at most two
  transmissions, hop/provenance/contact/disclosure revalidation, and stable
  zero-based effect indexes.
- Deterministic `do_nothing` for missing, duplicate, out-of-list, repeated-
  claim, repeated-speaker, newly invalid, deadline/town-state-ineligible, or
  otherwise unsafe interpreted choices.
- A complete atomic transmission/episode/evidence/belief effect plan that keeps
  earlier valid ordered selections, emits no effect for an invalid selection,
  and is committed by the caller as one plan rather than as a partial prefix.

This task does not implement schema repair or call Haiku. Phase 5 supplies an
accepted model result, calls this validator, and persists its plan atomically.

### Workstream E — Board, case progression, resolution, and projections

#### P2-15 — Implement provenance and case-board projection rules

**Depends on:** `P2-03`, `P2-08`

**Deliverables**

- Root-to-recipient provenance traversal by parent links, with root/hop
  consistency checks and stable actor sequence.
- Testimony classification for `original_assertion`/`direct_observation` and
  hearsay classification for `repeated_testimony`/`alleged_hearsay`, preserving
  speaker, alleged source, receiving-player contribution, and source path.
- One verified card per clue, one account card per NPC-to-player transmission,
  immutable unverified notes, and no automatic board entry for player-to-NPC
  assertions or confidential Mara dialogue.
- Contradiction pairs only when both claim entries are visible, lexical ID order
  inside each pair, and stable pair-array order; never label either account
  objectively true/false.
- Stable ordering of discoveries, contributors, board entries, and attempts.

#### P2-16 — Implement confrontation, accusation, and resolution plans

**Depends on:** `P2-06`, `P2-08`, `P2-09`, `P2-10`, `P1-15`

**Deliverables**

- Final gate open exactly when the Festival Bell is revealed, at least one
  required clue exists, and all three required clues are discovered.
- Locked result with generic message and no candidate IDs; open result with
  exact authored suspect, motive, and location order.
- Exact solution tuple comparison, immutable incorrect attempt, and one correct
  transition from active to awaiting resolution.
- Ten-minute owner reservation and post-expiry eligibility limited to a player
  whose visit began no later than the winning attempt event time.
- Awaiting-resolution freeze decisions for gameplay and ambient effects while
  reads, read-only joins, status, and Resolve remain permitted.
- First-winner resolution plan: chosen ending, all active visit endings,
  conditional one-time bell relocation to Festival Square, promise/
  relationship outcomes, deterministic escaped epilogue/contribution
  fragments, resolution event, and resolved town status.
- Ending rumour count over distinct keys in the frozen
  `ending_false_claim_keys` set that crossed at least one ambient NPC-to-NPC hop
  before the winning resolution event, excluding seed, player-origin-only,
  dynamic-unclassified, and post-resolution transmissions.
- Concurrent/replayed loser no-change result using the already-selected ending.

#### P2-17 — Build complete pure action planners

**Depends on:** `P2-07` through `P2-16`

**Deliverables**

- A versioned dispatcher for the closed action vocabulary:
  `start_visit`, `travel`, `inspect`, `ask`, `normalize_claim`, `tell`, `show`,
  `give`, `accept_promise`, `add_note`, `leave`, `accuse`, and `resolve`.
- Deterministic authority/location/custody/frozen-state preconditions and exact
  order: pre-action validation; evidence/relationship deltas; post-action
  scores and gates; approved external-selection request where relevant; final
  validated effect plan.
- Pure pre/post-model seams for Ask, normalization, dialogue selection, and
  ambient choice. The planner can state “external selection required” only with
  a bounded trusted context and resume only with a validated result or authored
  fallback.
- Stable mapping to the Decision 006 completed outcomes: applied, no-change,
  denied, and exact kind-specific result constraints.
- Ordered world-event effects with `player:<action-key>:<index>` identities
  supplied by orchestration, not generated inside rules.

Unsupported natural language has no structured effect. The planner never
compares a normalized player claim with objective truth to reject a lie.

#### P2-18 — Build the player-safe projection and view version

**Depends on:** `P0-04`, `P0-06`, `P2-05`, `P2-08`, `P2-09`, `P2-15`,
`P2-16`, `P1-15`

**Deliverables**

- Full Decision 006 `PlayerView` projector from explicit safe read inputs,
  resolving presentation strings/keys from the town's frozen content version.
- Stable sorting for every array exactly as the HTTP contract requires.
- Qualitative stances only; no canonical revision, numeric score, private
  solution, hidden fact/item, inaccessible identifier, private NPC reasoning,
  queue/error detail, or credential field.
- Accurate away/active/frozen visit, map access, encounter, inventory,
  discovered clue, promise, case board, contradiction, attempt, resolution,
  and ambient-transition projections.
- Exact
  `base64url(SHA-256("player-view:v1\n" + canonicalJSON(hashProjection)))`
  view version, excluding `viewVersion` and volatile transport data.
- Completed-action response validator/projector that returns only accepted
  player-safe fields and canonical array order.

**Leakage checks**

- Hidden-only state changes yield byte-identical safe projection and ETag.
- Shuffled repository rows yield byte-identical ordered JSON and ETag.
- Opening a locked accusation gate changes the view; changing an unrelated
  private belief that affects no visible stance/content does not.

### Workstream F — Content reachability and phase-wide verification

#### P2-19 — Validate balance, fallback coverage, and no-soft-lock routes

**Depends on:** `P2-07` through `P2-18`, `P1-16`

**Deliverables**

- Enumerate non-repeating pre-gate positive relationship events and prove every
  mandatory trust-40 gate is reachable from zero in at most four events.
- Prove Nessa's key and Corin's capability independently open the chapel.
- State-space/scenario checks showing an away key holder, caught liar, broken or
  stale promise, failed external selection, or quarantined/no-effect ambient
  tick cannot make the town unsolvable for all players.
- Prove all three required clues and bell reveal are discoverable without model
  dialogue and are sufficient for the confrontation gate.
- Validate authored fallback coverage for every NPC/action/response kind/gate/
  required outcome, including exact Corin final confession and all mechanical
  outcomes.
- Verify both endings, promise consequences, epilogue fragments, and exactly
  one bell relocation.

#### P2-20 — Build the deterministic scenario and regression suite

**Depends on:** `P2-17`, `P2-18`, `P2-19`

**Deliverables**

- Table-driven unit tests at every score/gate edge `-20`, `19`, `20`, `39`,
  `40`, `59`, `60` and clamps at `-100`/`100`.
- Property tests for permutation independence where ordering is semantically
  irrelevant, idempotent repeat protection, bounded scores/actions/hops, and
  no mutation of inputs.
- Golden scenarios for all seven Decision 008 balance examples, fresh seed,
  rumour/contradiction, both chapel routes, promises, lies, accusations, both
  endings, and hidden-state projection changes.
- A scenario CLI/test helper that serializes the same ordered plan/projection
  and digest across repeated runs and clean Node processes.
- Rule-coverage map linking every Decision 008 required deterministic test and
  every relevant Decision 005/006/009 verification priority to one test name.

#### P2-21 — Document rule extension and inspection-safe explanations

**Depends on:** `P2-20`

**Deliverables**

- Rules package guide explaining authority boundaries, pure inputs/effect plans,
  version lookup, action order, stable ordering, and external-selection seams.
- Procedure for adding a new rules/content version without changing existing
  towns.
- Trace field catalog showing what may enter logs/inspection and what is
  player-visible.
- Handoff examples showing Phase 3/4/5 services how to load state, call a pure
  planner, validate any bounded external result, and atomically persist the
  returned effects.

## 5. Artifacts

| Area | Artifacts |
|---|---|
| Rules kernel | Version registry, numeric/order primitives, immutable domain inputs, decision/effect-plan types |
| Social simulation | Claim relations, beliefs, relationships, disclosure, promises, grievances, recall |
| World simulation | Inspections, clues, custody, access, visits, event eligibility/ranges, case progression/resolution |
| Ambient | Eligibility, priority/shortlist, selection validator, bounded transmission effect plans |
| Projection | Provenance/board projectors, completed action results, full player view, canonical view hash |
| Content validation | Trust reachability, independent access routes, fallback coverage, solvability checks |
| Verification | Boundary/property/golden/scenario/leakage tests and coverage map |
| Documentation | Rules/version guide, trace catalog, service-integration handoff examples |

## 6. Dependencies and sequencing

```text
Phase 1 -> P2-01 -> P2-02 -> P2-03
P2-02 + P2-03 -> P2-04 -> P2-05
P2-02 + P2-04 -> P2-06
P2-05 + P2-06 -> P2-07
P2-03 + P2-06 -> P2-08 -> P2-09
P2-01 + P2-08 -> P2-10
P2-04 + P2-06 + P2-08 -> P2-11
P2-02 + P2-05 + P2-06 -> P2-12
P2-05 + P2-07 + P2-10 + P2-12 -> P2-13 -> P2-14
P2-03 + P2-08 -> P2-15
P2-06 + P2-08 + P2-09 + P2-10 -> P2-16
P2-07..P2-16 -> P2-17
P2-05 + P2-08 + P2-09 + P2-15 + P2-16 -> P2-18
P2-07..P2-18 -> P2-19
P2-17 + P2-18 + P2-19 -> P2-20 -> P2-21
```

Belief and relationship work can proceed in parallel after common primitives.
World action/promise work and recall work can also proceed independently.
`P2-17` is the deliberate integration point: it must not begin by duplicating
unfinished subrules inside an orchestration layer. `P2-18` consumes only
explicit safe inputs, so it can be tested independently of repositories.

## 7. Verification matrix

Commands below are planned interfaces introduced by this phase.

| Concern | Verification | Planned command |
|---|---|---|
| Pure determinism | Same frozen input produces byte-identical plan, trace, projection, and digest in repeated processes | `pnpm test:rules -- determinism` |
| Numeric boundaries | All score/gate edges, negative floor, same-event sum/clamp | `pnpm test:rules -- numeric-boundaries` |
| Claims | Predicate matrix, key serialization, opposites, exclusive locations, authored semantic relation, backfill | `pnpm test:rules -- claims` |
| Beliefs | Testimony formulas, source dedupe, corroboration/reversal, mirrors, contestation, cover story | `pnpm test:rules -- beliefs` |
| Relationships | Exact deltas, stacking, lie exception, repeat keys, stance precedence, grievances | `pnpm test:rules -- relationships` |
| Disclosure | All tier thresholds and observation/hearsay framing; hidden-context negative fixtures | `pnpm test:rules -- disclosure` |
| Items and access | Discovery attribution, Show/Give, conditional custody, Nessa key, Corin capability | `pnpm test:rules -- access-and-items` |
| Promises | Saved offer encoding/version binding, secrecy/return transitions, resolution outcomes | `pnpm test:rules -- promises` |
| Visits/ranges | Start/travel/note/leave decisions, event eligibility, disjoint ranges, no same-tick chain | `pnpm test:rules -- visits-and-ranges` |
| Lies | Four-part knowledge test and targeted reversal; contradiction alone has no penalty | `pnpm test:rules -- caught-lies` |
| Recall | Exact half-life/weights/flags/ties/top-eight with and without embeddings | `pnpm test:rules -- recall` |
| Ambient | Candidate gates, priority/top-12, hop/provenance/repeat limits, ordered zero-to-two apply | `pnpm test:rules -- ambient` |
| Case | Evidence gate, hidden options while locked, exact tuple, reservation, eligibility, freeze, one relocation | `pnpm test:rules -- case-resolution` |
| Projection | Exact unions/order/hash; hidden changes and shuffled inputs keep ETag stable | `pnpm test:rules -- player-safe-projection` |
| Solvability | Trust gates in <=4 events, both chapel routes, no model/ambient/key-holder soft lock | `pnpm test:content -- solvability` |
| Balance examples | All seven accepted worked checks and rumour contradiction path | `pnpm test:scenarios -- mvp-rules-v1` |
| Property bounds | No duplicate causal effect, score overflow, >2 ambient actions, >3 NPC hop, or input mutation | `pnpm test:rules:property` |
| Whole phase | Prior phase gates plus complete deterministic suite and coverage map | `pnpm validate` |

Golden snapshots may cover ordered stable-key projections and traces. They must
not replace semantic assertions, because an accidental wrong snapshot can be
accepted too easily.

## 8. Risks, decisions, and fallback strategy

| Risk or decision | Plan | Fallback / escalation |
|---|---|---|
| Exact `normalized_key` byte format is unspecified | Freeze a small versioned canonical tuple serialization in `P2-03` and use it for seed/dynamic claims | If it affects an accepted external contract, amend Decisions 005/008 before use; never derive identity from player-facing copy |
| “Recent” structured recall anchors have no explicit age cutoff | Treat the recent component as the newest authorized episodes within the bounded top-10 anchor query unless contract owners specify an age window | Keep the choice versioned and documented; do not widen NPC/town authorization |
| Pure planners may grow into an in-memory database | Require callers to provide narrow snapshots and return declarative effects/preconditions only | Split a planner by domain; do not add hidden mutable repositories or singleton state |
| Rule traces can leak hidden inputs into player responses | Keep inspection-safe traces structurally separate from player-safe result types and add compile/runtime leakage tests | Omit a trace field if its audience cannot be proven; causal rows remain available through inspection |
| SQL uniqueness and pure dedupe could disagree | Define repeat identities from Decision 005 index keys and test effect plans against Phase 1 integration fixtures | Change neither side silently; reconcile the contract and both tests together |
| Content relevance/fallback matrices are extensive | Generate exhaustive cases from the immutable content registry | A missing matrix entry fails content validation; it does not fall back to model authority |
| State-space solvability exploration can explode | Bound it to `bell-mystery-v1`, accepted positive events, exact gates, and canonical equivalent-state deduplication | Preserve hand-authored critical path scenarios as an independent check |
| Current-state revision races are not observable in pure tests | Include expected revisions and conditional preconditions in every mutation plan | Phase 3/5 integration tests must reject stale commits and re-plan; the pure engine never assumes commit succeeded |
| Invalid model choices arrive only in later phases | Test validators with adversarial supplied results now and require deterministic fallback/no-effect plans | Never let a later adapter bypass the validator because Bedrock schema validation passed |

If a model-dependent seam cannot produce an accepted result, the deterministic
fallback is authored dialogue, retry-with-new-action for normalization, or
`do_nothing` for ambient choice as owned by Decisions 006/010. There is no
fallback that invents truth, changes a score, fulfills a promise, opens a gate,
or mutates custody.

## 9. Exit checklist

- [ ] `P2-01` through `P2-21` are complete with artifact and test links.
- [ ] Every rule lookup is explicitly versioned and rejects an incompatible
  content/rules pair.
- [ ] Rule functions are pure: no database, environment, wall clock, UUID,
  network, model, queue, or hidden mutable dependency.
- [ ] Claim identity/relations, belief evidence, corroboration, reversals,
  relationship changes, stance, and repeat protection match Decisions 005/008.
- [ ] Disclosure and model-bound bundle builders cannot receive or emit
  unauthorized objective truth.
- [ ] Inspect/Show/Give/custody/access and both chapel routes pass exact gate and
  concurrency-precondition scenarios.
- [ ] Promise offers bind to saved descriptors/terms versions and every promise
  resolves deterministically once.
- [ ] Visit, event eligibility, disjoint range, and no-same-tick-chain rules
  pass.
- [ ] Recall uses the exact formula, bounds, authorization-first input, and
  embedding-failure behavior.
- [ ] Ambient shortlist/apply code enforces top 12, at most two actions, one
  claim and outgoing speaker per tick, hop three, provenance, and `do_nothing`.
- [ ] Case gate, option visibility, exact accusation, ten-minute reservation,
  prior-participant rule, freeze, both endings, and one bell relocation pass.
- [ ] Player/action projections validate against accepted unions and never
  expose canonical revision, exact scores, objective truth, private reasoning,
  inaccessible IDs, operational failure details, or secrets.
- [ ] Hidden-only changes and shuffled input rows leave the player-safe JSON and
  ETag unchanged.
- [ ] Trust reachability, both independent chapel routes, authored fallback
  coverage, and no-soft-lock scenarios pass.
- [ ] All accepted boundary, balance, repeat, property, and scenario tests pass
  without external services.
- [ ] The coverage map accounts for every required deterministic test and
  relevant schema/API/content verification priority.

## 10. Handoff to Phase 3

Phase 3 should treat the Phase 2 planner as authority and add transport plus
transactional execution around it. It consumes:

- `P2-17` action preconditions, external-selection seams, ordered effect plans,
  denial/no-change semantics, and completed-result mapping;
- `P2-18` player-safe projection, stable ordering, and view hash;
- `P2-10` visit/range/outbox intent planning for Leave without yet running
  ambient work;
- `P2-01` conditional revision/precondition metadata for atomic Phase 1 writes;
  and
- `P2-20` golden scenarios as integration-oracle fixtures.

Phase 3 must add authentication, request fingerprints, durable processing
claims, response replay, database transaction retries, rate limits, HTTP
errors, and browser action-journal recovery without reimplementing game rules
in route handlers. Phase 4 later fills the bounded model seams; Phase 5 later
publishes and executes ambient plans. If an integration discovers that a rule
needs data absent from the pure input, extend the explicit input contract and
leakage tests rather than giving the rules package a repository client.
