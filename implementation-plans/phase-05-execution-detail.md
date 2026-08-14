# Phase 5 — Execution Detail

- **Status:** Detailed execution plan for
  [Phase 5 — Ambient Propagation and Recovery](phase-05-ambient-propagation-and-recovery.md).
  Ready for review; implementation begins only after the Phase 4 exit gate.
- **Scope:** Concrete ownership, dependency and file layout, runtime state
  machines, task-level implementation and test detail, exact commands, goals,
  and a reviewable commit sequence for `P5-01` through `P5-22`.
- **Authority:** This document refines *how* Phase 5 is built. It does not
  redefine the accepted behavior in Decisions 001–011 or the parent Phase 5
  plan. Where those documents are silent, section 2 records an explicit
  `D5-*` implementation decision. Where an existing shell disagrees with an
  accepted decision, the accepted decision wins.
- **Planning baseline:** `claude/phase-04-implementation-execution-af5398` at
  `8570648`, with Phase 4 in progress through the `P4-09` NPC context/read
  slice. The Phase 4 execution plan remains the source for the not-yet-landed
  action/model seams. Re-check §1.2 against the `P4-24` commit before starting
  `P5-01`; do not code Phase 5 against unfinished Phase 4 interfaces.

## 1. Grounding

Phase 5 is the first phase whose correctness spans **two independently retried
request paths**: the synchronous Leave request and an at-least-once queue
consumer. SQS FIFO reduces duplicate delivery and preserves order within one
town, but neither property is the authority for an effect. CockroachDB remains
the authority through a durable outbox, one execution identity, current-token
conditional completion, unique numbered effect keys, and a deadline that can
be enforced by either Recovery or Start Visit.

The repository is deliberately prepared for this phase: the full SQL schema,
reliability constants, pure eligibility/selection rules, queue and Recovery
shells, and player-safe ambient union already exist. They are not an
implementation. The current eligible Leave branch still throws an opaque 500,
both workers stop at their envelopes, no outbox repository exists, and the
browser renders every away state as the immediate-return screen.

### 1.1 The eight execution holes

These are the concrete gaps the implementation must close.

**Eligible Leave cannot write a valid outbox row.**
`rules#planLeaveVisit` emits only `job_type`, `visit_id`, and the range.
`outbox` also requires source event, job identity, canonical payload and hash,
three delivery timestamps, deadline, delivery state, and update time. The
Phase 3 generic insert path cannot invent these safely, and
`inputs/leave.ts#AmbientIntentUnsupportedError` intentionally rejects the
branch before it reaches SQL.

**The current range stops before the departure event.**
`loadLeaveInputs` reads the town's current `last_event_sequence`, and
`planLeaveVisit` advances the ambient boundary to that value. The same commit
then appends `visit_ended`, incrementing `last_event_sequence` by one. Decision
005 requires allocation *after* that append, so the upper bound must include
the ineligible departure event. `P5-01` corrects this to
`loadedLastEventSequence + 1`; eligibility does not change because
`visit_ended` is statically ineligible.

**The queue shell's envelope has one forbidden field.**
`apps/ambient-worker/src/envelope.ts` requires
`{version,townId,outboxId,jobKey}`. Decisions 002/003/005 and the parent plan
say SQS carries **only** town, outbox, and job identity. The version belongs
inside the authoritative stored outbox payload. Phase 5 moves the transport
schema to a shared package and removes the fourth queue field.

**No package owns reusable queue transport.**
Initial publication runs in Game API, republishing runs in Recovery, and
parsing runs in Ambient. Copying an SQS adapter or message schema across three
deployment apps would create protocol drift. `D5-A` adds one small transport
package; database and model orchestration remain in `game-server`.

**No persistence or orchestration exists for the ambient state machines.**
There is no repository for outbox claims, execution claims, deadline
terminalization, candidate input reads, ambient effects, or join-secret
cleanup. The Phase 4 persistence modules provide recall, episodes, model cost,
runs, beliefs, relationships, promises, and transmission state, but they do
not compose those records into an ambient tick.

**The documented Recovery index is not a global Recovery index.**
`ix_outbox__delivery` begins with `town_id`. Recovery scans across towns and
has no town predicate, so it cannot efficiently use that leading column to
find due or overdue rows. `ix_join_requests__open_replay` and
`ix_ambient_job_executions__stale` are usable; outbox needs a new global
partial due/deadline index in a migration.

**The infrastructure shell explicitly creates no Phase 5 resources.**
`foundation-stack.ts` currently lists the FIFO queue/DLQ and Recovery schedule
as deferred to Phase 7. The parent Phase 5 plan requires a real FIFO boundary
and one live queue proof now. Phase 5 therefore owns a narrow queue/schedule
construct; Phase 7 owns the rest of the production topology and alarms.

**The browser has no authoritative transition timestamp.**
`AmbientTransitionView` intentionally exposes only status and
`canStartVisit`. It does not expose `createdAt` or `deadlineAt`, yet Decision
011 asks for notices after 90 seconds and a Start Visit affordance after five
minutes even when the last projection is stale. `D5-P` uses a local
first-observed waiting timestamp only to reveal UI; Start Visit and
CockroachDB time remain authoritative.

### 1.2 What Phase 5 reuses rather than rebuilds

| Need | Existing authority or seam |
|---|---|
| Event classification, disjoint range, Leave planner | `rules/world/visits.ts#{computeAmbientEligible,computeAmbientEventRange,planLeave}`, `rules/actions/deterministic.ts#planLeaveVisit` |
| Deterministic candidate gates, score, order, top 12 | `rules/ambient/eligibility.ts`, `kernel/ordering.ts`, `kernel/version.ts` |
| Ordered 0/1/2 choice validation | `rules/ambient/selection.ts#planAmbientSelections` |
| Belief weights, repeat protection, mirrors, corroboration | `rules/beliefs/evidence.ts`, `beliefs/labels.ts` |
| Promise and disclosure gates | `rules/world/promises.ts`, `rules/disclosure/*` |
| Contact graph and garden-rumour preference | `content/entities.ts#CONTACT_EDGES`, Decision 009 §Ambient propagation |
| Ambient output schema, versions, settings, repair error codes, warmup pair | `model-contracts/ambient-choice.ts`, `versions.ts`, `json-schema.ts` |
| Bounded Converse/Titan clients and one transport retry | `model-runtime/bedrock/{converse,retry,titan,deadline}.ts` |
| Structured repair boundary and safe errors | `model-runtime/validation/{repair,errors}.ts`, `model-contracts/prompts/structured-repair.ts` |
| Model cost admission and run telemetry | `game-server/persistence/{model-cost,model-runs}.ts` |
| Episode lifecycle and top-eight recall | `game-server/persistence/{episodes,recall}.ts`, `application/npc/recall.ts` |
| Phase 4 causal state readers/writers | `game-server/persistence/{beliefs,board,npc-state,promises,relationships}.ts` plus the `P4-13`–`P4-17` modules that must exist at the Phase 4 gate |
| Serializable retry and bounded pool | `database#runSerializable`, `createRuntimePool`; Decision 007 constants in `runtime-config/reliability.ts` |
| Outbox/execution schema and uniqueness | migrations `0008_operations_ledger.sql`, `0009_deferred_keys.sql`, `0010_indexes.sql` |
| Player action identity and saved replay | `game-server/application/actions/executor.ts`, `persistence/actions.ts` |
| Start Visit's prior-job seam | `application/actions/inputs/start-visit.ts#readPriorAmbientJobStatus` |
| Player-safe ambient union | `http-contracts/player-view.ts#AmbientTransitionViewSchema` and `rules/projection/player-view.ts` |
| Browser polling, ETags, journal, route guards | `web/api/playerView.ts`, `web/journal/*`, `web/routing/guards.tsx` |
| Runtime shells and safe envelope/log patterns | `apps/{ambient-worker,recovery-worker}/src` |
| Queue/worker/deadline constants | `runtime-config/reliability.ts#{AMBIENT_QUEUE,AMBIENT_WORKER_TIMING,AMBIENT_TRANSITION,OUTBOX_PUBLICATION,RECOVERY}` |
| Lambda artifact and synth baseline | `infrastructure/src/foundation-stack.ts` and its assertions |

Phase 5 must reuse these exact authorities. It must not introduce a second
belief formula, recall ranker, contact graph, prompt retry loop, action
journal, or transition union.

### 1.3 Gaps the accepted documents do not settle

The implementation decisions below resolve these without broadening the game:

- where the shared SQS protocol/adapter lives;
- the stored ambient payload version and exact hash preimage;
- which clock supplies outbox deadlines and terminalization;
- how a newly committed Leave exposes its private outbox identity to a
  best-effort post-commit hook without putting it in the HTTP response;
- which exact provenance source represents a `(speaker, claim, recipient)`
  when the speaker has more than one source;
- how opaque choice IDs are assigned;
- how ambient model/reservation attempt ordinals avoid collisions when two
  recipient episodes are embedded;
- whether a model failure is a completed no-op or infrastructure quarantine;
- whether an ambient transmission has a relationship or promise side effect
  when no accepted rule defines one;
- how local development runs the queue boundary; and
- how the browser times its slow/deadline affordances without a server
  timestamp.

## 2. Implementation decisions

| ID | Decision | Rationale |
|---|---|---|
| `D5-A` | Add one package, `packages/ambient-queue`. It owns the strict three-ID message schema, SQS publisher, stable transport outcomes, and deterministic/in-memory test adapter. It has no database, rules, content, or model dependency. Shared database/application logic lives under `packages/game-server/src/{application,persistence}/ambient`; Ambient and Recovery apps stay thin adapters. | Game API and Recovery publish the same protocol, while Ambient parses it. One dependency-light package prevents three copies without creating a `game-server`↔worker cycle. |
| `D5-B` | The authoritative payload version is `ambient-tick/1`. The stored payload is canonical JSON of exactly `{version,visitId,afterEventSequence,throughEventSequence}`. `payload_hash` is raw SHA-256 bytes over that canonical UTF-8 JSON. The SQS JSON is exactly `{townId,outboxId,jobKey}` with no version or range. | The accepted documents require a versioned stored payload and a three-field queue body but do not name the version or hash preimage. This makes both reproducible. |
| `D5-C` | Leave's upper range is the sequence of its own `visit_ended` event: `loaded last_event_sequence + 1`. `commitEffectPlan` obtains one CockroachDB transaction timestamp and uses it for the departure, outbox `created_at`/`updated_at`/`next_send_at`, `not_before`, and deadline. The planner remains pure; the commit adapter expands its outbox intent with preallocated `outboxId` and `jobKey`. | It fixes the current off-by-one and prevents application/Lambda clock skew from deciding transition deadlines. The departure stays ineligible but is consumed by the same boundary. |
| `D5-D` | `ActionHandler` gains an optional, typed `afterCommit` hook. Only a newly executed eligible Leave invokes it, outside the transaction, with private `{townId,outboxId,jobKey}`. It starts only when the complete two-second send bound fits before the existing action/serialization deadline; otherwise it records `initial_send_skipped` and leaves Recovery to publish. Every error becomes an outbox delivery transition and safe telemetry, never a different saved Leave response. Replays do not publish. | The response must say `waiting` after durability, but queue acknowledgement cannot join the transaction, exceed the accepted request budget, or roll the visit back. Recovery owns missed replay publication. |
| `D5-E` | Outbox and execution transitions are repository functions with current-token predicates and CockroachDB-time checks; callers never issue ad hoc status updates. Internal error codes are closed constants. A malformed unidentifiable message fails for DLQ; an identifiable mismatch creates/terminalizes the matching execution as quarantined and is acknowledged. | This makes corruption and retry behavior reviewable and prevents an old sender/worker from completing a newer claim. |
| `D5-F` | An ambient execution claim starts at attempt 1 and lasts 45 seconds. A delivery may take over only an expired claim. If five claims have already expired/failed, the next contender quarantines without model work. Completed/quarantined duplicates acknowledge immediately; an unexpired competing claim returns a retryable invocation failure. | Aligns the execution ledger with `maxReceiveCount = 5` while preserving a useful retry and preventing a duplicate from deleting the last recoverable message. |
| `D5-G` | Build one spoiler-safe structured event query for the frozen range and, when time/cost permits, one Titan query embedding shared across the three NPC-scoped vector searches. Each NPC still gets its own top-eight recall result. Titan failure uses only that NPC's structured anchors; it never widens town, NPC, claim, or range. | One query call is bounded and sufficient because the query describes the same tick; DB vector searches remain correctly NPC-scoped. |
| `D5-H` | A candidate is unique by `(speaker,claim,recipient)`. Its exact provenance source is chosen deterministically: a valid direct-observation source episode first; otherwise a repeatable parent transmission ordered by lowest hop, newest source event sequence, then transmission ID. After deterministic shortlist order, opaque IDs are `c1`…`c12`; IDs are job-local and never persisted as authority. | The contracts define one provenance source per candidate but not how to collapse multiple valid sources. This preserves the strongest/direct source and makes fixtures stable. |
| `D5-I` | Add the exact ambient system prompt and task-input builder to `model-contracts`, and the cross-field/membership validator to `model-runtime`. Shape or pre-interpretation cross-field failure may receive one repair. After IDs are interpreted, each invalid selected slot becomes no effect; another independently valid returned slot may still apply. No replacement ID is chosen. | This matches the existing ordered `planAmbientSelections` semantics and the accepted “invalid choice creates no effect” rule without discarding an unrelated valid choice. |
| `D5-J` | No candidate, cost rejection, dependency timeout/failure, invalid output after repair, or no narratively useful selection completes the execution as a valid `action_count = 0` no-op. Quarantine is reserved for identity corruption, inactive/frozen town, expired deadline, claim exhaustion, or unrecoverable database/infrastructure state. | A model has no authority and must not strand the player. Operational failures that invalidate the job itself remain alertable and distinguishable internally. |
| `D5-K` | Ambient effects use a dedicated `commitAmbientTick`; they do not reuse the player-action `commitEffectPlan`. The transaction rechecks token, identity, payload, town status, deadline, and selected candidates; reserves one contiguous event range; writes `ambient:<jobKey>:0|1` events and all causal rows; bumps town revision once; and completes the execution. A stale second choice may drop while a valid first commits. | Player commits hard-code player origins/keys. A dedicated commit makes the ambient origin, two legitimate effects, and completion atomic. |
| `D5-L` | Recipient episode embeddings are attempted outside the transaction, in returned choice order, only when each worst case fits. Applied effects store `ready`; skipped calls store `pending`; attempted failures store `failed`. If commit-time revalidation drops a prepared choice, its incurred run/cost remains linked to the execution but no episode is inserted. | Cost history must remain honest, while vector availability cannot control whether causal memory commits. |
| `D5-M` | Attempt ordinal bands are deterministic per execution and purpose: query embedding `0/1`; ambient choice `0/1`; structured repair `2/3`; effect-0 episode embedding `0/1`; effect-1 episode embedding `2/3`. Transport retry consumes the second ordinal in a band even when the first reservation committed. | The ambient execution uniqueness index is per `(execution,purpose,ordinal)`; two recipient embeddings otherwise collide. |
| `D5-N` | One Recovery invocation has a single 25-row mutation budget across all work: overdue transitions consume it first, due publications second, and expired join replay secrets last. It uses bounded concurrency 2 and the original identity only. Add global partial outbox due/deadline indexes in migration `0014_ambient_runtime.sql`; do not replace the existing town-scoped index. | Terminalization must win over a late publish, the total honors Decision 007's row bound, and concurrency 2 matches the warm Lambda database pool. The new indexes support the actual cross-town scans. |
| `D5-O` | Player transition projection uses the latest ended visit: no outbox → `null`; outbox with no execution → `waiting`; processing execution → `processing`; completed/quarantined or abandoned → `complete`. Delivery substates, attempt counts, errors, selected IDs, and run outcomes never affect the public object. Start Visit invokes idempotent deadline terminalization before loading its pure rule inputs. | This produces the exact three public states and lets Start Visit enforce the deadline without teaching the pure visit rule about queue internals. |
| `D5-P` | The web app stores `firstObservedWaitingAt` in `sessionStorage`, scoped by town, when it first observes `waiting`; it clears it after a new visit starts. The timestamp controls only the 90-second notice and five-minute button visibility. Clicking always submits ordinary journaled Start Visit, and an early/client-skewed click is safely denied by the server. | The accepted player view intentionally carries no deadline. Local time may reveal a control but can never terminalize work or authorize re-entry. |
| `D5-Q` | Keep Phase 4's `TTR_ENABLE_NPC_MUTATIONS`; add `TTR_ENABLE_AMBIENT_TRANSITIONS`. Non-local Game configuration rejects NPC mutations enabled while ambient transitions are disabled or the queue URL is absent. Ambient and Recovery refuse effectful startup when their shared flag is off. Phase 5 acceptance enables both; public/shared exposure remains off before `P5-22`. | The joint Phase 4/5 release promise becomes a fail-closed runtime invariant rather than a deployment convention. |
| `D5-R` | Phase 5 adds `AmbientInfrastructure`: source FIFO, DLQ, event-source mapping, Recovery schedule, concurrency/retention/timeouts, queue grants, and imported exact secret/model policy resources. It creates no API Gateway, web hosting, secret value, dashboard, budget, or public deployment. Phase 7 composes and alarms this construct without changing its protocol. | This satisfies the real queue boundary now while preserving Phase 7's ownership of complete production operations. |
| `D5-S` | Add an opt-in `queue-live` Vitest project with no network trap. It creates only exact `ttr-phase5-it-<uuid>.fifo` resources in the configured test account, validates their names/account before deletion, and deletes the resolved URLs in `finally`. It is absent from `pnpm test` and `pnpm validate`; recorded evidence is required for `P5-22`. | Rare FIFO/redrive behavior needs AWS, while default tests must stay deterministic, offline, and inexpensive. |
| `D5-T` | No SQS, Bedrock, Titan, or other network symbol is callable from `runSerializable` transaction bodies. Candidate/embedding/model work is staged before the commit; the commit performs only database reads/writes. Extend the existing static no-network-in-transaction test to cover `ambient-queue` and ambient orchestration. | Preserves Decision 007's transaction invariant and keeps retry bodies deterministic. |
| `D5-U` | Phase 5 writes no relationship change, promise state change, custody change, capability, new fact, or new claim from an NPC-to-NPC transmission. It reads promises/disclosure constraints for eligibility. Only a future accepted rule may add an optional relationship consequence. | The parent plan says such consequences are optional, and no accepted v1 rule defines one. Omitting invented mechanics is the only deterministic choice. |

## 3. Dependency selection

One external dependency and one workspace package are added.

| Dependency | Consumer | Purpose |
|---|---|---|
| `@aws-sdk/client-sqs` | `packages/ambient-queue` only | `SendMessage`, live queue fixture setup/inspection, typed transport errors |
| `@the-town-remembers/ambient-queue` | `apps/game-api`, `apps/ambient-worker`, `apps/recovery-worker` | Shared three-ID protocol and publisher/parser adapters |
| `@the-town-remembers/game-server` | `apps/ambient-worker`, `apps/recovery-worker` | Ambient/recovery application services and database pool |
| `@the-town-remembers/model-runtime` | `apps/ambient-worker` | Construct injected Bedrock/Titan clients; no DB access |
| `@the-town-remembers/model-contracts` | `packages/game-server` | Ambient input/output/version types already accepted |

`packages/ambient-queue` may depend on `runtime-config` only if it needs shared
queue timing constants; the preferred adapter accepts `{queueUrl,region}` and
depends only on `zod` plus the SQS SDK. It must not import `database`, `pg`,
`rules`, `content`, or `model-runtime`.

Boundary-script changes:

- add `AMBIENT_QUEUE_RUNTIME` and an `EXPECTED_PACKAGES` entry for
  `packages/ambient-queue`;
- add the package to Game API, Ambient worker, and Recovery worker allowed
  dependencies;
- add `GAME_SERVER` to Ambient and Recovery worker allowed dependencies and
  `MODEL_RUNTIME` to Ambient worker;
- keep `@aws-sdk/client-bedrock-runtime` exclusive to `model-runtime` and
  `@aws-sdk/client-sqs` exclusive to `ambient-queue`;
- allow `runtime-config/model` only in the already-approved model consumers;
  Recovery receives no model configuration; and
- add the package/tsconfig references to the root build and test configs.

## 4. Planned file layout

```text
packages/ambient-queue/
  package.json
  tsconfig.json
  src/
    index.ts
    message.ts                 strict {townId,outboxId,jobKey}
    publisher.ts               port + SQS SendMessage adapter/outcomes
    in-memory.ts               deterministic ordered test/local harness
    *.test.ts

packages/model-contracts/src/
  prompts/ambient-choice.ts    exact Decision 010 system text
  inputs/ambient-choice-input.ts
  prompts.test.ts              extended prompt/hash drift

packages/model-runtime/src/
  validation/ambient-choice.ts cross-field + supplied-ID validation
  validation/ambient-choice.test.ts

packages/database-admin/migrations/
  0014_ambient_runtime.sql     global due/deadline outbox indexes only

packages/game-server/src/
  persistence/
    outbox.ts                  create/claim/ack/fail/abandon/due scans
    ambient-executions.ts      create/claim/takeover/complete/quarantine
    ambient-inputs.ts          frozen-range events, sources, contacts, overlap
    ambient-effects.ts         transmission/episode/evidence/belief writes
    recovery.ts                overdue, due-send, expired replay scans
  application/
    ambient/
      payload.ts               canonical payload/hash and identity
      recall.ts                one event query -> per-NPC top eight
      candidates.ts            complete universe, provenance, score, c1..c12
      choice.ts                reserve -> Haiku -> validate/repair/no-op
      embeddings.ts            bounded prepared recipient vectors
      commit.ts                current-token atomic 0/1/2 effect commit
      worker.ts                24-second orchestration state machine
      recovery.ts              bounded sweep orchestration
      transition.ts            projection + deadline terminalization
      errors.ts                stable internal outcome/error codes
  application/actions/
    executor.ts                optional afterCommit hook
    inputs/leave.ts            full eligible branch; no Phase 3 guard
    inputs/start-visit.ts      deadline terminalization before pure load
  application/player-view/build.ts

apps/game-api/src/ambient/
  publisher.ts                config -> ambient-queue SQS adapter

apps/ambient-worker/src/
  handler.ts                  one record -> game-server ambient worker
  runtime.ts                  cached pool and injected model clients
  observability/log.ts

apps/recovery-worker/src/
  handler.ts                  scheduled event -> bounded recovery sweep
  runtime.ts                  cached pool and queue publisher
  observability/log.ts

packages/runtime-config/src/
  ambient.ts                  DB/model/release inputs for worker
  recovery.ts                 DB/queue/release inputs
  game.ts                     queue URL + joint release validation
  deployment.ts              queue/schedule/imported-resource parameters
  reliability.ts             ambient execution attempt limit

infrastructure/src/
  ambient-infrastructure.ts   FIFO, DLQ, mapping, schedule, exact grants
  ambient-infrastructure.test.ts
  foundation-stack.ts         composes Phase 5 slice

apps/web/src/
  screens/BetweenVisits.tsx
  components/TimePasses.tsx
  transition/observed-time.ts
  screens/Away.tsx            unchanged no-work presentation
  screens/Shell.tsx           chooses Away vs BetweenVisits

evals/phase-05/
  ambient-choice/*.json

e2e/
  phase-05-rumour.spec.ts
  phase-05-recovery.spec.ts

scripts/
  ambient-local.mjs           deterministic one-job/local worker entry
  ambient-queue-live.mjs      guarded live FIFO fixture
```

Exact filenames may move within the named ownership boundary, but changing
package ownership, protocol fields, or transactional boundaries requires an
update to `D5-A`–`D5-U` before implementation.

## 5. Task-level execution detail

### Workstream A — Durable range allocation and outbox publication

#### `P5-01` — Complete event classification and range allocation

**Implementation**

- Extend the event-classification table test to enumerate every current
  `EVENT_TYPES` member and fail when a new type has no explicit expected
  eligibility behavior. Keep option-dependent `npc_interaction`,
  `evidence_shown`, and `item_transferred` cases exhaustive.
- Change Leave's planned upper sequence to include its own one
  `visit_ended` event (`D5-C`). Read the eligible count only for the existing
  live range; add the known-ineligible departure without another SQL scan.
- Keep `ambient_scheduled_through_sequence` in the same town-revision-guarded
  update as sequence allocation. A revision conflict reloads all inputs and
  replans; it never edits an already chosen range.
- Delete `AmbientIntentUnsupportedError` and its Phase 3 invariant tests only
  after the full outbox commit path in `P5-02` exists.

**Tests and acceptance**

- Pure tests cover every event type and both option-dependent branches.
- DB tests prove two concurrent departures commit disjoint ranges and the
  losing plan reloads rather than overlapping.
- The first post-seed Leave starts after the final seed sequence; every
  `system_seed` and `visit_ended` event is ineligible and consumed.
- A tick-created event has a sequence greater than its source job upper bound.

#### `P5-02` — Create the transactional ambient outbox job

**Implementation**

- Add payload schema/builder/hash helpers using canonical JSON and `D5-B`.
  Validate payload ↔ relational range/visit equality before insert and again
  when read by a worker.
- Preallocate `outboxId` and `jobKey` once per action attempt. Expand the pure
  rules outbox intent at the application/commit boundary; do not teach
  `packages/rules` hashing, UUIDs, or database time.
- In the Leave transaction, obtain one DB timestamp, append departure, update
  town boundary/end visit, insert a complete `pending` outbox row, and save the
  completed Leave response with `transitionStatus: waiting`.
- Return the private dispatch identity from the commit layer to the
  `afterCommit` hook only. It must not enter `ActionResult`, `player_actions`
  response JSON, logs as a payload, or `PlayerView`.

**Tests and acceptance**

- Exact payload/hash golden test and strict unknown-field rejection.
- Real DB tests for all required columns, offsets from the same DB timestamp,
  source event/visit FKs, unique visit/job/range guards, and rollback after
  each write boundary.
- Same-key replay returns the saved `waiting` body and creates no second row.
- Ineligible Leave advances through departure, returns `not_required`, and
  creates no outbox row.

#### `P5-03` — Implement send claims and initial publication

**Implementation**

- Implement `claimOutboxSend`, `markOutboxSent`, and `returnOutboxToPending` as
  current-token conditional functions. Definite failures use one-/two-minute
  backoff; timeout/ambiguous acknowledgement leaves an expired/recoverable
  `sending` claim rather than pretending failure or success.
- Build `SqsAmbientPublisher` in `ambient-queue`: exact body, group town ID,
  dedupe job key, abort signal, safe classified outcome, no raw body logging.
- Add `afterCommit` to the executor (`D5-D`) and inject the publisher through
  `RouterConfig`. The local/test path injects the deterministic adapter; the
  Lambda path constructs the SQS adapter from validated config.
- Start the hook only when its whole two-second bound fits before the action's
  response-serialization reserve; otherwise skip it and leave the row pending.
  Leave's already saved response wins regardless of publish outcome.

**Tests and acceptance**

- Repository races: current token wins, stale sender cannot ack/fail, expired
  sender can be taken over, backoff never passes deadline.
- Adapter command snapshot proves exact body/group/dedupe and no per-message
  delay (delay is queue-level).
- Lost ack leaves recoverable state; a same-key later publish remains safe.
- Static test proves publication is outside `runSerializable`.

### Workstream B — Queue and execution identity

#### `P5-04` — Define the Phase 5 FIFO/DLQ infrastructure slice

**Implementation**

- Add `AmbientInfrastructure` with source `.fifo`, DLQ `.fifo`, 20-second
  delay, 180-second visibility, four-/14-day retention, redrive 5, batch 1,
  reserved and event-source concurrency 5.
- Connect the existing Ambient and Recovery Lambda constructs. Add a
  once-per-minute EventBridge rule and exact invoke permission.
- Grant Game/Recovery only source `SendMessage`; Ambient only the consume/
  delete/get-attributes operations its event mapping needs. Import exact DB
  secret and Bedrock resource ARNs as tokens; create no secret values.
- Remove only queue/schedule items from `DEFERRED_TO_PHASE_7`; retain hosting,
  API Gateway, alarms/dashboard, budgets, and secret creation there.

**Tests and acceptance**

- CDK assertions cover every coupled number and exactly one mapping/rule.
- No wildcard action/resource, plaintext secret, public queue policy,
  provisioned polling, or provisioned concurrency.
- Queue URL is injected only into Game and Recovery; Ambient receives messages
  through the event source, not by polling itself.

#### `P5-05` — Implement execution claims and corruption checks

**Implementation**

- Parse one strict message in `ambient-queue`, then load authoritative outbox
  by `(townId,outboxId)` and compare job key, recomputed payload hash, payload
  fields, relational fields, deadline, `not_before`, and town status.
- Create or claim the unique execution under both outbox and job constraints.
  Use DB time for 45-second expiry and attempt checks (`D5-F`).
- Map every branch to one of `duplicate_terminal`, `retry_later`,
  `claimed`, or `quarantined`; the Lambda adapter decides acknowledge vs
  throw, never the repository.
- A premature job throws a retryable safe code. A non-active town and an
  identifiable corrupt job quarantine before any recall/model call.

**Tests and acceptance**

- Concurrent first deliveries create one execution and one current token.
- Expired takeover invalidates the old worker; old completion matches zero.
- Completed/quarantined duplicates perform no work; early/unexpired claims
  remain retryable; fifth-attempt exhaustion quarantines.
- Cross-town, wrong job, wrong hash, malformed, extra-field, and inactive-town
  cases write no causal effect.

### Workstream C — Deterministic ambient choice boundary

#### `P5-06` — Build the frozen event and recall input set

**Implementation**

- Read only `ambient_eligible = true` events in `(after,through]`, selecting
  explicit columns. Build one deterministic safe query from event type and
  canonical content/entity labels; never include raw player/NPC prose.
- Resolve direct claim references from event columns. Resolve overlap only
  when a top-eight episode reference shares a canonical entity with an event
  in range. Do not infer entity overlap from episode summary text.
- Run one bounded query embedding, then Phase 4 vector/anchor recall separately
  for Mara, Corin, and Nessa. On failure use structured anchors per NPC.
- Load the exact episode/transmission/claim records needed to preserve source
  provenance; no town-wide memory blob reaches the prompt.

**Tests and acceptance**

- Boundary fixtures exclude below/above/ineligible/tick-created events.
- Another town/NPC and a semantically similar but structurally unrelated
  episode never enter.
- Embedding failure yields deterministic anchor-only results with identical
  direct references.
- One query embedding call maximum per execution attempt.

#### `P5-07` — Generate and rank the complete candidate set

**Implementation**

- Add an application candidate snapshot carrying the accepted prompt fields
  plus all commit-time revalidation keys. Use `D5-H` to select one exact
  provenance source per candidate.
- Enumerate selected beliefs/cover story × enabled outgoing contact edges,
  then call the existing pure eligibility and priority functions. Apply
  disclosure and promise constraints before scoring.
- Read contact eligibility on speaker→recipient and testimony trust on
  recipient→speaker; never reuse one direction for both.
- Sort using the rules comparator, cap at 12, then assign `c1..c12`. Narrative
  preferences are copied as prompt context only after rank and never change
  the set/order.

**Tests and acceptance**

- One test per gate: belief 19/20, cover story, direct/repeat source, contact
  direction, guarded trust 19/20, confidential/final truth, cycle, repeat
  source, hop 3/4, promise conflict, inactive job/town.
- Exact priority/tie tests and 13→12 cap.
- No Nessa↔Corin candidate; Mara→Nessa garden rumour is valid and carries
  Nessa→Mara trust 20 for later +32 evidence.
- Same inputs produce byte-identical trusted context and choice IDs.

#### `P5-08` — Activate ambient prompt, validator, repair, and evals

**Implementation**

- Check in Decision 010's ambient system text verbatim, its hash, and the
  `ambient-choice-input/1` strict builder. Extend prompt drift tests and
  prewarm fixtures; the schema/version/settings already exist.
- Add cross-field validation for decision/null/reason combinations before ID
  interpretation. Membership, distinctness, repeated claim/speaker, and stale
  eligibility use stable sanitized error codes.
- Reuse the Phase 4 repair envelope exactly once. Repair sees the same trusted
  candidates and cannot add IDs. Validate from scratch.
- Convert final model/validation outcome to an ordered selection plan or the
  `D5-J` no-op; never parse prose into an effect.

**Tests and acceptance**

- Fixture matrix covers 0/1/2, empty list, injection, unknown/duplicate ID,
  repeated claim/speaker, bad reason/null combinations, stale contact,
  confidential/promise conflict, repair success/failure.
- Exact Haiku settings: temperature `.2`, maximum 128 tokens, one retry and
  one repair only when each fits.
- Deterministic eval command fails on any authority broadening or prompt/hash
  drift.

### Workstream D — Ambient worker and atomic effects

#### `P5-09` — Implement bounded worker orchestration

**Implementation**

- Replace the shell with a one-record async handler and cached runtime
  dependencies. Establish absolute application deadline at invocation start;
  reserve the final four seconds.
- Orchestrate: parse → claim/validate → frozen inputs → recall → candidates →
  model/repair or no-op → prepare embeddings → atomic commit. Check fit before
  every external call.
- Convert model failures to valid no-op and infrastructure/identity failures
  to retry/quarantine per `D5-E`/`D5-J`. Do not catch a retryable branch and
  accidentally acknowledge it.
- On ambiguous DB commit, read execution by stable identity; completed means
  success, current processing means retry only when non-commit is proven, and
  terminal quarantine means acknowledge.

**Tests and acceptance**

- Fake-clock tests at every budget boundary, including no call in reserve.
- Crash before commit, ambiguous commit, stale token, deadline crossing,
  inactive town, model timeout, and embedding failure all terminate safely.
- Static call-graph test proves no network in a transaction.

#### `P5-10` — Persist one NPC-to-NPC transmission

**Implementation**

- Add `appendAmbientEvent` with `origin_kind = ambient_job`, execution ID,
  effect index/key, speaker/recipient/claim metadata, and
  `ambient_eligible = true` (it may enter a later Leave range, never this one).
- Insert exact transmission source/root/parent/hop, recipient `heard_claim`
  episode/references, primary `npc_testimony`, repeat protection,
  corroboration delta, contradiction mirrors, and current belief aggregate.
- Use recipient→speaker trust for weight and root speaker identity for
  independent-source repeat protection. Copy alleged source/provenance; do not
  rewrite canonical claim or world truth.
- Store prepared embedding state with the episode. Apply `D5-U`: no custody,
  promise, relationship, capability, fact, or claim write.

**Tests and acceptance**

- Mara→Nessa and Mara→Corin garden-rumour fixtures each produce +32 at hop 1.
- Same-root descendant is repeat-protected; independent root corroborates;
  contradiction mirror is exact and one level only.
- Inspection reconstructs player root → Mara → recipient; festival bell item
  remains in Old Chapel.
- Every row rolls back if any later row or completion fails.

#### `P5-11` — Apply up to two choices and complete atomically

**Implementation**

- In one serializable transaction, re-read current execution/outbox/town and
  revalidate returned selections in order against pre-tick state plus the
  first staged effect.
- Drop each invalid slot independently. Allocate contiguous sequences only for
  remaining effects; use numbered IDs 0/1 in returned-choice order, not
  original shortlist rank.
- Bump town revision once, write all effects, then conditionally set execution
  `completed`, `action_count`, and completion time under the current token.
- Treat unique effect/event collisions as evidence of an already committed
  execution; resolve from the ledger rather than renumbering.

**Tests and acceptance**

- Exact 0/1/2 rows and keys, invalid primary/valid secondary, valid primary/
  stale secondary, repeated claim/speaker, rollback, serialization retry, and
  duplicate delivery outside FIFO dedupe window.
- Old worker after takeover can write neither effect nor completion.
- A tick creates one revision bump regardless of action count; valid no-op
  completes without a world event.

#### `P5-12` — Record model and embedding telemetry safely

**Implementation**

- Reuse reservations/runs with ambient execution source and `D5-M` ordinals.
  Record ambient choice, repair, query embedding, and applied/prepared episode
  embeddings with exact versions, model/profile, token/cost dimensions,
  latency, outcome, and stable validation code.
- Link an applied episode run to its event when available; runs incurred before
  a dropped effect remain execution-linked only. Never mutate/delete a run to
  make it look applied.
- Add structured lifecycle correlation from departure event → outbox/job →
  execution → run → effect index → transmission/event.
- Extend redaction tests for raw prompt/output, claim prose, message body,
  processing/send tokens, DB URL, and credentials.

**Tests and acceptance**

- Invalid selection has an inspectable rejected run and no causal effect.
- Empty-candidate no-call has no fake `agent_runs` row; execution/logs explain
  the valid no-op.
- Concurrent/resumed calls cannot collide or double reserve an ordinal.

### Workstream E — Recovery and terminal transition semantics

#### `P5-13` — Implement Recovery due-send processing

**Implementation**

- Add migration `0014` with global partial due/deadline indexes; refresh
  schema snapshot/generated types and prove query plans use them on a scaled
  fixture where practical.
- After overdue work consumes its share of the invocation's 25-row budget,
  scan only the remaining number of due pending/expired-sending rows ordered
  by deadline, `next_send_at`, town, ID. Claim with token, publish original
  identity, and conditionally ack/fail exactly as initial publication.
- Run at concurrency 2 under a 30-second handler deadline; stop claiming new
  rows when a send cannot fit. One row's failure does not cancel other claimed
  rows.
- Wire the EventBridge schedule through the strict scheduled envelope.

**Tests and acceptance**

- Real DB + controllable publisher covers due/not-due, expired claim, lost ack,
  one-/two-minute backoff, deadline cap, limit 25, deterministic order, and
  parallel outcome isolation.
- SQS adapter contract proves original group/dedupe/body on republish.

#### `P5-14` — Implement deadline abandonment, quarantine, and late no-op

**Implementation**

- Terminalize overdue rows before publication: pending or expired-sending →
  abandoned; sent stays sent; every missing/nonterminal execution becomes
  quarantined with the original identity/hash and a stable deadline code.
- A live, unexpired send/processing claim is not stolen before deadline; at
  deadline the terminal state wins conditionally. Worker commit checks the
  same DB-time predicate.
- Export one idempotent terminalization primitive for Recovery and Start Visit.
  Neither caller duplicates the SQL state machine.
- Late terminal delivery returns success without model/DB effects beyond the
  already-terminal read.

**Tests and acceptance**

- Millisecond-before/at/after deadline, pending/sending/sent, missing/
  processing execution, Recovery/worker/Start Visit races, and late message.
- Completion/no-op is not counted as quarantine; deadline/infrastructure
  quarantine is alertable.

#### `P5-15` — Close expired join replay secrets

**Implementation**

- Scan the existing `ix_join_requests__open_replay` predicate only for the
  invocation budget remaining after overdue/send work. Conditionally set
  closure time/reason `expired`, clear `join_secret_hash`, and update time.
- Reuse request-time join behavior as authority; the sweep never creates a
  player/session, changes response JSON, or reopens a request.
- Emit counts and safe reasons only, no hash/key.

**Tests and acceptance**

- Expired unconfirmed closes; confirmed/exhausted/already closed/future rows do
  not change; request-time confirmation race has one valid winner.
- Logs and inspection expose no join secret/hash material.

#### `P5-16` — Integrate transition projection and Start Visit

**Implementation**

- Add one scoped query for the current player's latest ended visit/outbox/
  execution and map it through a pure projector using `D5-O`.
- Invoke deadline terminalization before `start_visit` loads
  `priorAmbientJobStatus`; then call the existing pure visit rule. Keep the
  actual new-visit commit and idempotency behavior unchanged.
- Include only public status/capability in ETag input. Hidden delivery/attempt/
  error changes that map to the same object must preserve ETag; processing and
  terminal transitions must change it.
- Enforce `D5-Q` in runtime config and encounter action availability. Add a
  startup/capability health assertion without exposing secret configuration.

**Tests and acceptance**

- Every internal state maps exactly; missing execution is waiting, quarantine
  is complete, no-job is null.
- Start before deadline is saved denial; at deadline it terminalizes and starts
  once; concurrent Recovery/Start Visit cannot create two visits.
- Leakage/schema tests prove no outbox/job/token/error/attempt/model/selection
  field reaches HTTP or ETag.

### Workstream F — Time-passes browser experience

#### `P5-17` — Build the honest transition screen

**Implementation**

- On `/between-visits`, render `Away` when `ambientTransition === null` and
  `BetweenVisits` otherwise. Existing projection-driven guards remain the
  navigation authority.
- Implement the exact three headings/copy and actions from Decision 011. Board
  remains readable; safe-to-close language is explicit. No NPC, gossip,
  percentage, retry, error, or internal job language.
- Reuse `usePlayerView`'s 5s/30s/visibility ETag polling and preserve board
  state. Add immediate refresh on `online`, which the existing hook lacks.
- Resolution redirects continue to supersede the transition.

**Tests and acceptance**

- Component/router tests for no-work, waiting, processing, complete, 304,
  online/visibility recovery, and resolution redirect.
- Exact copy snapshots and forbidden-language assertions.

#### `P5-18` — Add slow/deadline recovery UI

**Implementation**

- Add `observed-time.ts` implementing `D5-P`, with fake-clockable elapsed
  calculation, session storage guards, and cleanup after active visit.
- Reveal the exact 90-second notice. At observed five minutes show Return even
  if the last status is waiting/processing; submit ordinary `start_visit`
  through the existing journal.
- Keep server denial/retry in the ordinary action recovery UI. The browser has
  no publisher, redrive, quarantine, token, or job-key code.
- Respect reduced motion, focus the new screen heading, use polite live-region
  updates only on meaningful state changes, and preserve keyboard order.

**Tests and acceptance**

- Fake-clock 89/90 seconds and 4:59/5:00, reload same tab, clock skew/early
  click, offline/online, saved Start Visit retry, reduced motion, keyboard and
  accessible-name coverage.

### Workstream G — Security, telemetry, fault tests, and docs

#### `P5-19` — Enforce queue/worker security boundaries

**Implementation**

- Add dependency/IAM/source checks from §§3 and `D5-R`. Queue message size is
  bounded by the strict schema; authoritative payload is loaded and hashed.
- Validate town scoping on every query and composite FK/write. Stable
  externally logged codes replace raw SQL/AWS/model errors.
- Extend prompt-injection tests through event summaries, canonical labels,
  episode summaries, and model output; confidential/final truth never reaches
  the candidate prompt.
- Add source-text scans for queue body logging and processing/send token fields.

**Tests and acceptance**

- Forged/cross-town/replayed/oversize/extra-field/corrupt messages apply
  nothing and reveal nothing.
- Synth and boundary tests fail wildcard or over-broad dependencies.

#### `P5-20` — Instrument queue, worker, and recovery health

**Implementation**

- Add safe structured events for send claim/ack/failure/uncertainty, receive
  count, execution claim/takeover/stale rejection, candidate/selection count,
  transaction retries, completion/no-op/quarantine, Recovery counts,
  abandonment, and transition latency.
- Add in-process metric instruments for oldest pending outbox, oldest
  transition, abandonment/quarantine, stale claims, timeout/max receive, DLQ
  visible count input, and Recovery failure. Phase 7 binds dashboards/alarms.
- Keep dimensions bounded to status/purpose/code; IDs are correlation log
  fields, never metric labels.

**Tests and acceptance**

- Metric/log capture asserts values, cardinality, once-per-final-outcome
  emission, and the redaction catalog.

#### `P5-21` — Build deterministic and live fault campaigns

**Implementation**

- Build the in-memory FIFO harness with controllable delay, dedupe window,
  group ordering, visibility, receive count, crash point, DLQ, and redrive.
- Cover duplicate sends/deliveries inside/outside dedupe, same-town order,
  parallel towns, lost ack, crash before/after commit, stale claim, model
  timeout/invalid output, deadline race, and late delivery.
- Add the guarded `queue-live` project (`D5-S`) for real attributes,
  order/dedupe/redelivery/redrive and original keys. Never target an
  unvalidated existing production queue.
- Add Playwright recovery fixtures that wait only on player-safe transition
  state; inspection helpers may separately assert internal provenance.

**Tests and acceptance**

- One durable job, at most two effects, stable numbered keys, one useful retry
  before deadline, and guaranteed re-entry in every fault.
- Record the account/region, generated test resource names, attributes, and
  sanitized results for the phase evidence pack.

#### `P5-22` — Document operations and run joint acceptance

**Implementation**

- Document config, local one-job runner, live queue fixture, EventBridge
  schedule, failure meanings, safe inspection queries, deadline behavior, and
  DLQ redrive preserving original body/key.
- Update model prewarm docs for Haiku + ambient schema and explain valid no-op
  versus infrastructure quarantine.
- Run the canonical two-browser rumour: Player A Tell Mara → eligible Leave →
  waiting/processing/complete → Mara→Nessa (or Corin fallback) → Player B
  changed grounded dialogue → clue contradiction, with unchanged item truth.
- Run all terminal fault variants and the release capability test with both
  Phase 4/5 flags enabled. Shared/public exposure remains disabled until the
  entire matrix passes.

**Tests and acceptance**

- Inspection reconstructs departure, range, outbox/job/execution, runs,
  numbered event, transmission root/parent/hop, trust snapshot, episode,
  evidence, belief, and terminal transition.
- Full static/default/DB/browser gates pass; one real SQS and one live model
  smoke/eval are recorded separately.

## 6. Commands

Commands are exact repository scripts to add or reuse; live commands remain
opt-in and outside `pnpm validate`.

| Command | Purpose |
|---|---|
| `pnpm db:up && pnpm db:migrate` | Start/migrate local CockroachDB |
| `pnpm test:rules` | Event eligibility, candidate gates/score/order, ordered selection |
| `pnpm test:contracts` | Ambient prompt/input/schema/hash drift |
| `pnpm test:model` | Ambient semantic validation and repair fixtures |
| `pnpm test:ambient` *(new)* | `vitest run --project api packages/game-server/src/application/ambient` plus persistence unit tests |
| `TTR_REQUIRE_DB_TESTS=1 pnpm test:ambient:db` *(new)* | Scoped outbox/execution/effect/recovery DB files |
| `pnpm test:workers` *(new)* | Ambient/Recovery/Game adapter and CDK runtime-shell tests |
| `pnpm prompts:eval -- ambient-choice/1.0.0` | Deterministic Phase 5 prompt eval fixtures |
| `pnpm ambient:local -- --outbox <uuid>` *(new)* | Process one durable job through the deterministic/local adapter |
| `TTR_QUEUE_LIVE_TESTS=1 pnpm test:queue:live` *(new)* | Guarded real FIFO/DLQ integration |
| `pnpm test:e2e -- phase-05-rumour phase-05-recovery` | Two-browser proof and player-safe fault journeys |
| `pnpm cdk:synth` | Queue/DLQ/mapping/schedule/IAM assertions |
| `pnpm validate` | Final offline/static/coverage/build/synth/E2E gate; excludes live queue/model calls |

Per [CLAUDE.md](../CLAUDE.md), iterate with scoped unit and one-file DB runs.
Run the global coverage suite only after the phase is believed complete.

## 7. Goals

Phase 5 is complete only when all goals hold.

| ID | Goal |
|---|---|
| `G1` | Eligible Leave consumes a range through its own departure event and atomically creates one complete outbox job; ineligible Leave creates none. |
| `G2` | Stored payload/hash and relational columns agree exactly; SQS contains only the three opaque IDs. |
| `G3` | Initial and Recovery publication use the same group/dedupe/body and current-token delivery state machine. |
| `G4` | Real FIFO/DLQ configuration matches every Decision 007 parameter. |
| `G5` | One outbox/job maps to one execution; duplicates, takeovers, and old workers cannot duplicate completion or effects. |
| `G6` | Candidate input is frozen to the disjoint range and per-NPC recall; no cross-town/NPC/range memory enters. |
| `G7` | The complete valid universe obeys belief, provenance, contact, disclosure, promise, source-repeat, cycle, and hop gates before Haiku sees IDs. |
| `G8` | Priority, ties, top 12, narrative context, and `c1..c12` are deterministic. |
| `G9` | Ambient prompt/hash/input/schema/validator/repair are executable and drift-tested. |
| `G10` | Model/cost/timeout/validation failure safely completes no-op; identity/infrastructure corruption quarantines; neither strands a player. |
| `G11` | No network call occurs in a database transaction. |
| `G12` | A tick commits 0–2 actions atomically, bumps revision once, and uses stable `ambient:<job>:0|1` keys. |
| `G13` | NPC-to-NPC transmission preserves exact root/parent/hop/source, episode references, evidence, mirrors, and belief aggregate. |
| `G14` | Mara→Nessa/Corin hop-one testimony is +32 and never moves or redefines the bell. |
| `G15` | Every incurred model/embedding call has honest reservation/run telemetry with collision-free ordinals and no unsafe text. |
| `G16` | Recovery globally finds due/overdue rows efficiently, republishes original identity, and closes expired join secrets only. |
| `G17` | Deadline terminalization is one idempotent primitive shared by Recovery and Start Visit; late delivery is no-op. |
| `G18` | Player view exposes only null/waiting/processing/complete plus `canStartVisit`; hidden retries/errors do not perturb it. |
| `G19` | Between-visits copy, polling, 90-second notice, five-minute return affordance, reduced motion, focus, and keyboard behavior match Decision 011. |
| `G20` | NPC mutations cannot be enabled in shared/non-local configuration without the ambient transition path also enabled. |
| `G21` | Queue/database/model secrets, payloads, tokens, raw output, claim prose, and hidden state never enter client state or unsafe logs. |
| `G22` | Deterministic fault campaigns and one guarded live SQS run prove ordering, redelivery, dedupe, DLQ/redrive, deadline, and re-entry. |
| `G23` | The canonical two-browser rumour changes later grounded dialogue with full inspection provenance and unchanged objective truth. |
| `G24` | `pnpm validate` passes with global thresholds; live queue and live model evidence are captured separately. |

## 8. Execution order and commit plan

The 22 stable task IDs remain unchanged. Split commits keep dependency and
cross-package boundary changes independently reviewable.

| # | Commit | Task |
|---:|---|---|
| 1 | `feat(ambient-queue): add the strict ambient transport protocol` | `D5-A`, `D5-B` |
| 2 | `feat(config): add ambient transport and release configuration` | `D5-Q`, prerequisite |
| 3 | `fix(rules): allocate Leave ranges through the departure event` | `P5-01` |
| 4 | `feat(game-server): persist transactional ambient outbox jobs` | `P5-02` |
| 5 | `feat(game-server): publish newly committed ambient jobs` | `P5-03` |
| 6 | `feat(infrastructure): add the ambient FIFO and recovery schedule` | `P5-04` |
| 7 | `feat(game-server): add ambient execution claims and corruption checks` | `P5-05` |
| 8 | `feat(game-server): load frozen ambient event and recall inputs` | `P5-06` |
| 9 | `feat(game-server): construct deterministic ambient candidates` | `P5-07` |
| 10 | `feat(model-contracts): add the exact ambient prompt and input` | `P5-08` part 1 |
| 11 | `feat(model-runtime): validate and repair ambient choices` | `P5-08` part 2 |
| 12 | `feat(ambient-worker): orchestrate bounded ambient jobs` | `P5-09` |
| 13 | `feat(game-server): persist one ambient transmission effect` | `P5-10` |
| 14 | `feat(game-server): atomically commit bounded ambient ticks` | `P5-11` |
| 15 | `feat(game-server): record ambient model and embedding telemetry` | `P5-12` |
| 16 | `perf(database): index global ambient recovery scans` | `P5-13` part 1 |
| 17 | `feat(recovery-worker): republish due ambient jobs` | `P5-13` part 2 |
| 18 | `feat(game-server): terminalize overdue ambient transitions` | `P5-14` |
| 19 | `feat(recovery-worker): close expired join replay secrets` | `P5-15` |
| 20 | `feat(game-server): project ambient transitions and unblock visits` | `P5-16` |
| 21 | `feat(web): add the honest between-visits transition` | `P5-17` |
| 22 | `feat(web): add slow and deadline recovery affordances` | `P5-18` |
| 23 | `test(security): close ambient queue and worker boundaries` | `P5-19` |
| 24 | `feat(observability): instrument ambient and recovery health` | `P5-20` |
| 25 | `test(ambient): add deterministic and live queue fault campaigns` | `P5-21` |
| 26 | `docs(ambient): add runbooks and joint phase acceptance` | `P5-22` |

Commits 1–2 can land after Phase 4 because they do not change gameplay.
Commits 3–5 are sequential. Commit 6 may proceed after 1–2 while 7–11 build
the worker boundary. Commit 12 needs 6–11; 13–15 are sequential. Recovery
commits 16–19 can start after 5 and 7 and should land before projection/UI.
Commits 20–22 require both worker completion and deadline terminalization.
Security, observability, fault campaigns, and acceptance close the phase.

Run scoped tests per commit. Run `pnpm validate` once after commit 26 plus the
opt-in queue/model evidence commands in the documented test environment.

**Estimate.** The published Phase 5 estimate remains **13–19 engineer-days**
if `P4-24` lands the model-executor, causal repositories, encounter UI, and
joint capability flag exactly as planned. Reserve **2–3 additional days** if
Phase 4 changes those seams or if live SQS account/IAM setup is not already
available. Re-estimate immediately after the Phase 4 gate rather than hiding
that dependency inside Phase 5 variance.

## 9. Discrepancies found while planning

### 9.1 The queue shell carries a field the accepted protocol forbids

The shell requires `version`; Decisions 002/003/005 say the queue carries only
three IDs. `D5-B` removes it from SQS and uses the version in the authoritative
outbox payload. Do not “fix” this by weakening the strict queue schema.

### 9.2 Leave currently leaves its own departure sequence unscheduled

The current planner advances to the pre-commit `last_event_sequence`, while
the commit appends one more event. `D5-C` includes the known departure sequence
in the range/boundary. It remains ineligible, so this changes bookkeeping, not
candidate content.

### 9.3 The generic insert cannot satisfy `outbox`

The rules effect has four fields; SQL requires substantially more. Phase 5
expands the pure intent at the commit boundary with preallocated identity,
canonical hash, DB time, and delivery defaults. Adding nullable/default
columns to make the partial insert pass would weaken the accepted schema and
is not an option.

### 9.4 The existing outbox index is town-scoped but Recovery is global

`ix_outbox__delivery(town_id,...)` is useful for town-scoped inspection, not a
cross-town due scan. Migration `0014` adds global partial indexes and retains
the original. Querying every town in application code would be slower and
would complicate the 25-row global bound.

### 9.5 Player `commitEffectPlan` cannot be the ambient committer

It hard-codes `player_action`, `player:<key>:<index>`, one player action ID,
and a response-completion writer. Adapting it with flags would make both paths
harder to audit. `D5-K` shares lower-level persistence helpers but gives
ambient work its own transaction boundary.

### 9.6 Candidate provenance is underspecified when a speaker has two sources

The prompt requires exactly one source, while the deterministic rule names one
candidate per `(speaker,claim,recipient)`. `D5-H` selects direct observation,
then the shallowest/newest repeatable transmission. Creating multiple prompt
candidates for the same triple would consume shortlist capacity with
mechanically identical actions.

### 9.7 Optional relationship consequences have no v1 rule

The phase plan permits them only when allowed by rules; no accepted rule maps
an off-screen NPC transmission to relationship/promise/custody state. `D5-U`
writes none. This is a deliberate absence, not a TODO in `P5-10`.

### 9.8 Recovery must create a quarantined execution for sent-but-never-run work

An overdue `sent` outbox row remains historically sent, but player re-entry
needs a terminal execution. Terminalization therefore inserts a quarantined
execution when none exists, using the original job/hash, rather than changing
delivery history or treating missing execution as complete.

### 9.9 The player contract exposes no deadline timestamp

Adding one would change an accepted exact response schema and leak an internal
transition detail. `D5-P` uses locally observed time only to show a button; the
server's DB-time check remains authoritative. A reopened browser may show the
button later than the true deadline until its next successful poll, but it can
never apply effects or enter early.

### 9.10 Phase 0 says Phase 7 owns resources Phase 5 must now exercise

That comment predates the detailed Phase 5 gate. `D5-R` narrows the ownership:
Phase 5 creates the queue/DLQ/mapping/schedule and exact grants needed for this
slice; Phase 7 owns complete deployment, secret creation, public routing,
alarms, dashboards, budgets, and rollback. The protocol is frozen at the
Phase 5 gate.

### 9.11 Planning occurred before the Phase 4 exit commit

The baseline is intentionally explicit. At `P4-24`, verify that the final
model-executor hook, transmission/evidence writers, context builder, flags,
and web encounter modules match §1.2. If names moved, update filenames. If an
authority or transaction boundary changed, revise the affected `D5-*`
decision before code; do not silently build a second path.

## 10. Exit evidence package

`P5-22` archives a sanitized evidence directory or CI artifact containing:

- commit/build ID and final config validation (booleans and resource names,
  never values/secrets);
- default/static/DB/browser test summaries and coverage result;
- CDK queue/DLQ/mapping/schedule/IAM assertions;
- live SQS attributes plus order/dedupe/redelivery/redrive result;
- ambient prompt eval and one live model smoke result;
- canonical rumour IDs and inspection query output showing the complete causal
  chain and unchanged bell custody;
- fault matrix with terminal player-safe outcome for each injected failure;
  and
- the remaining Phase 7 alarm/dashboard/public-deployment inventory.

Passing this evidence gate enables the joint Phase 4/5 player-facing memory
loop and hands Phase 6 an honest, bounded, recoverable shared-town transition.
