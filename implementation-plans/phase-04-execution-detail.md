# Phase 4 — Execution Detail

- **Status:** Detailed execution plan for
  [Phase 4 — Grounded NPC and Memory Loop](phase-04-grounded-npc-and-memory-loop.md).
  Not yet started.
- **Scope:** Concrete package layout, exact module contracts grounded in the
  already-shipped Phase 0/1/2/3 code, task-level module and acceptance detail,
  command definitions, and goals for `P4-01` through `P4-24`.
- **Authority:** This document refines *how* Phase 4 is built. It never
  redefines *what* decisions 001–011 accept. Where the phase plan or an
  accepted decision is silent or ambiguous, this document records the
  implementation choice and the reasoning in section 9. Where the phase plan
  and an accepted decision disagree, the decision wins.
- **Baseline:** `claude/phase-03-implementation-execution-de94b0` at `df4e3fd`
  (Phase 3 complete, 24 commits, not yet merged to `main`). Every claim in
  section 1 was verified by reading that source, not by re-deriving it from the
  decision documents.

## 1. Grounding

Phase 4 adds the first **external network dependency** in the repository. Every
boundary the earlier phases crossed — HTTP, CockroachDB, the browser — is
deterministic and locally reproducible. Bedrock and Titan are neither: they are
slow, metered, occasionally unavailable, and they return text that is untrusted
until deterministic code has proved otherwise. Almost every implementation
decision below follows from that one difference.

The good news is that Phase 2 already shipped more of this phase than its plan
assumes. The bad news is that three things the phase plan lists as
*prerequisites* do not exist, and one of them — the authored rendering corpus —
is the largest single piece of new work in the phase.

### 1.1 The five holes

These are not defects in the earlier phases. Four of them are exactly the work
the phase boundary deferred. The fifth (§1.1.2) is a genuine gap between the
phase plan's prerequisite list and the shipped content.

**There is no model runtime and no model configuration category.**
`@aws-sdk/client-bedrock-runtime` appears in no `package.json` in the workspace.
`packages/runtime-config/src/shared.ts#CONFIGURATION_CATEGORIES` has nine
members — `browser-public`, `game-runtime`, `ambient-runtime`,
`recovery-runtime`, `database-runtime`, `security-runtime`, `deployment`,
`test`, `operator` — and none of them is about models. `.env.example` names
`TTR_AWS_REGION` and `TTR_AWS_ACCOUNT` for CDK only. `game.ts`'s own header
already says so: *"Phase 0 needs no secret to run the health shell… Phase 1 and
Phase 4 add theirs."* `D4-C` adds the category and `D4-A` adds the package.

**`bell-mystery-v1` has no NPC voice rules, no rendering templates, no
fallback lines, no aliases, and no promise-offer descriptors.** The phase plan's
prerequisite says *"`bell-mystery-v1` contains NPC profiles, disclosures,
rendering templates, fallback matrix, item/promise bindings, and seed
memories."* What actually shipped in `packages/content/src/entities.ts` is
`AuthoredNpc = { npcKey, characterKey, locationKey, profileKey, profileVersion,
openingGreeting }` — six fields, no voice rules, no disclosure tier table, no
templates. There is no `alias` string anywhere in `packages/content/src`, yet
Decision 010's normalization `trusted_context` requires `canonical_entities`
with *"authored aliases"* and `canonical_actors` with *"accepted aliases"*.
Decision 009 authors the **fallback** lines, the disclosure tier table, the
two promise offers, and the requested-item bindings in prose, but it authors no
rendering templates at all — it only says *"versioned authored templates
generate safe voiced alternatives"*. `packages/rules/src/content-validation/fallback-coverage.ts`
states the boundary in its own header: *"dialogue authoring is Phase 4/5's job,
not this phase's, so `bell-mystery-v1` has no fallback lines to check yet."*
So Phase 4 authors the entire dialogue corpus and then feeds it to a checker
that already exists and has never had real input (`D4-I`, §5 `P4-03a`, §9.1).

**The prompt text is not in the repository.** `packages/model-contracts`
shipped in Phase 0 with `versions.ts` (all four prompt versions, task-input
versions, validator versions, schema names/descriptions, inference settings,
the eighteen repair error codes, the six run outcomes, the four warmup pairs),
the three Zod output schemas, `json-schema.ts#toBedrockJsonSchema`, and drift
tests against `docs/schemas/*.json`. It contains no prompt text, no prompt
hash, no repair-overlay composition, no task-input builders, and no semantic
validators. `P4-01` is therefore re-scoped exactly the way `P3-01` was.

**The action executor has no seam for work between planning and committing.**
`packages/game-server/src/application/actions/executor.ts#runClaimed` runs
`loadInputs -> plan -> buildResult -> commit` in one straight line, with the
`plan` result feeding `buildResult` directly. There is nowhere for a Titan call,
a Bedrock call, a validation pass, or a fallback selection to happen, and no
concept of an attempt that consumed money. `P4-10` widens it (`D4-E`, `D4-F`).

**Nothing writes any Phase 4 causal table.** `packages/game-server/src/persistence`
covers `creation-ledger`, `join-ledger`, `sessions`, `players`, `actions`,
`events`, `discoveries`, `rate-limits`, `view-queries`, `identifiers`. There is
no writer for `claims`, `claim_relations`, `claim_drafts`, `claim_transmissions`,
`npc_interactions`, `episodes`, `episode_references`, `belief_evidence`,
`npc_beliefs`, `relationship_changes`, `npc_player_relationships`, `promises`,
`player_capabilities`, `case_board_entries` beyond the verified-evidence card,
`agent_runs`, or `model_cost_reservations` — and no reader for the recall,
belief, relationship, promise, or transmission state a bundle needs.

### 1.2 What Phase 4 reuses rather than rebuilds

Reading `packages/model-contracts/src/*.ts`, `packages/rules/src/**`,
`packages/content/src/*.ts`, `packages/game-server/src/**`,
`packages/database-admin/migrations/*.sql`, and `packages/database/src/domains.ts`
directly turns up working code and schema Phase 4 must call:

| Need | Already exists at |
|---|---|
| Every prompt/input/validator/schema **version constant**, inference settings, repair error codes, run outcomes, warmup pairs | `model-contracts/versions.ts#{PROMPT_VERSIONS, TASK_INPUT_VERSIONS, VALIDATION_POLICY_VERSIONS, OUTPUT_SCHEMA_NAMES, OUTPUT_SCHEMA_DESCRIPTIONS, INFERENCE_SETTINGS, REPAIR_VALIDATION_ERROR_CODES, AGENT_RUN_OUTCOMES, WARMUP_PAIRS, WARMUP_INTERVAL_HOURS}` |
| The three output schemas, their enums, and the predicate signature table | `model-contracts/{claim-normalization,npc-dialogue,ambient-choice}.ts#{ClaimNormalizationV1Schema, CLAIM_PREDICATE_SIGNATURES, CLAIM_CLARIFICATION_REASON_CODES, CLAIM_UNSUPPORTED_REASON_CODES, NpcDialogueV1Schema, NPC_RESPONSE_KINDS, NPC_DIALOGUE_RESPONSE_LIMITS, NPC_DIALOGUE_REQUIRED_LIMITS}` |
| Bedrock JSON Schema generation and the snapshot drift test | `model-contracts/json-schema.ts#{OUTPUT_SCHEMAS, toBedrockJsonSchema}`, `json-schema.test.ts` |
| The six model-backed **planners**, already authority-checked and effect-planning | `rules/actions/model-backed.ts#{planAsk, planNormalizeClaim, planTell, planShow, planGive, planAcceptPromise}` |
| The `ApprovedDisclosureBundle` type and its gate/limit enforcement | `rules/disclosure/bundle.ts#{buildApprovedDisclosureBundle, DisclosureBundleLimitError}`, `rules/disclosure/tiers.ts#meetsDisclosureTier` |
| The exact recall formula, importance table, directness table, contradiction floor, candidate pool caps, top-eight ranking, and the embedding-failure path | `rules/recall/scoring.ts#{computeRecallScore, effectiveImportanceFor, importanceMinimumFor, directnessFor, isActiveContradiction, vectorCandidatesFor, selectStructuredAnchors, rankRecallResults}`, `rules/kernel/ordering.ts#{compareRecallAnchors, compareRecallResults}` |
| Belief scoring, labels, the selected-belief/contestation rule, evidence weights | `rules/beliefs/{evidence,labels}.ts#{beliefLabelFor, isSelectedBelief}` |
| Relationship deltas, repeat protection, and the ledger→state projection | `rules/beliefs/relationships.ts#relationshipDeltaFor`, `rules/actions/relationship-effects.ts#relationshipStateChangeEffects` |
| Claim canonicalization, `claim-key:v1`, the grammar, contradiction/mirror relations | `rules/claims/{canonical,grammar,relations}.ts`, `content/claim-key.ts`, `content/claim-matrix.ts` |
| Show authorization, structured-effect planning, Give custody, the narrow caught-lie rule | `rules/world/clues.ts#{isShowAuthorized, planShowStructuredEffect, planGiveCustody}`, `rules/world/lies.ts` |
| Promise terms, fulfilment/break evaluation | `rules/world/promises.ts`, `content/versions.ts#PROMISE_TERMS` |
| The fallback-coverage checking engine (written, never fed real input) | `rules/content-validation/fallback-coverage.ts#{computeFallbackCoverage, isFullyCovered}` |
| The complete six-action request union, result schemas, `NpcDialogueSchema` (with `responseMode`), `PromiseOfferViewSchema`, denial envelope | `http-contracts/actions.ts#{ActionRequestSchema, ActionResultSchemaByKind, MODEL_BACKED_ACTION_KINDS, NpcDialogueSchema, PromiseOfferViewSchema}` |
| 500-grapheme `ask`/`tell` input bounds and plain-text enforcement | `http-contracts/primitives.ts#{AskQuestionSchema, ClaimTextSchema, plainText, countGraphemeClusters}` |
| Every projector the encounter needs, including `availableActionKinds` ordering, inventory, active promises, board entries | `rules/projection/player-view.ts#{projectEncounters, projectInventory, projectActivePromises, orderedAvailableActionKinds}` |
| Complete schema for every causal table, with the invariants already enforced in SQL | migrations `0004_claims_memory.sql` (`claims`, `claim_relations`, `claim_drafts`, `npc_interactions`, `episodes`, `episode_references`, `claim_transmissions`), `0006_beliefs.sql`, `0007_progress.sql`, `0008_operations_ledger.sql` (`agent_runs`, `model_cost_reservations`), `0011_vector_index.sql` |
| The 256-dimension vector column, `embedding_status` consistency check, and the `(town_id, npc_id, embedding)`-prefixed vector index with a `ready`-only predicate | `0004_claims_memory.sql#episodes`, `0011_vector_index.sql#ix_episodes__embedding` |
| Every closed domain Phase 4 writes | `database/domains.ts#{INTERACTION_INPUT_KINDS, INTERACTION_RESPONSE_MODES, TRANSMISSION_SOURCE_KINDS, EPISODE_KINDS, EPISODE_REFERENCE_KINDS, EMBEDDING_STATUSES, EVIDENCE_KINDS, RELATIONSHIP_REASON_KINDS, PROMISE_KINDS, BOARD_ENTRY_KINDS, AGENT_RUN_PURPOSES, EMBEDDING_AGENT_RUN_PURPOSES, AGENT_RUN_OUTCOMES, RESERVATION_STATUSES, RATE_LIMIT_BUCKET_KINDS}` |
| The `model_action` rate-limit bucket kind and `town` scope kind, unused so far | `database/domains.ts#{RATE_LIMIT_BUCKET_KINDS, RATE_LIMIT_SCOPE_KINDS}`, `game-server/persistence/rate-limits.ts` (*"`model_action` stays unused until Phase 4"*) |
| Action identity, processing claims, replay, takeover, ambiguous-commit resolution, retryable conflict | `game-server/persistence/actions.ts#{claimAction, completeAction, runCompleteActionUpdate, storeRetryableConflict, readActionForPlayer}`, `application/actions/{executor,ledger}.ts` |
| Effect-plan commit, town-revision guard, event numbering, safe identifier check | `game-server/application/actions/commit.ts#commitEffectPlan` |
| Absolute deadline plumbing and the four-second reserve | `game-server/application/deadline.ts#{applicationDeadlineAt, preCommitDeadline}` |
| The "no network inside a transaction" static test | `game-server/application/actions/no-network-in-transaction.test.ts` |
| Token-bucket admission, scope-key derivation, `Retry-After` computation | `game-server/persistence/rate-limits.ts#{RATE_LIMIT_BUCKETS, rateScopeKey, admit}` |
| The out-of-phase kind gate Phase 4 opens | `game-server/application/actions/enabled.ts#ENABLED_ACTION_KINDS` (*"Phase 4 and Phase 6 grow this list by one line each"*) |
| Client action journal, recovery state machine, pending bar, result card, broadcast coordination | `apps/web/src/journal/{db,channel,machine}.ts`, `components/{ActionRecoveryNotice,ResultCard}.tsx`, `api/{actionSubmission,actionTransport}.ts` |
| Disposable migrated CockroachDB per test file, stdout capture, forbidden-field catalog | `test-support/database/harness.ts`, `test-support/{log-capture,redaction}.ts` |

`P4-01`'s phase-plan deliverable is therefore already half-shipped: the schema
snapshots, runtime schemas, version metadata, and drift tests exist. What does
not exist is the prompt text, the hash, the composition rule, and the task-input
builders — see §5.

### 1.3 What Decisions 005/006/007/009/010 do not define

Real gaps found by reading the contracts, each resolved by a `D4-` decision
below and re-collected in section 9.

- The exact **rendering template corpus**: how many voiced alternatives per
  `(NPC, response kind, disclosure/outcome set)`, their placeholder grammar, and
  where they live (`D4-I`).
- **Entity and actor aliases** for normalization `trusted_context`
  (`D4-J`).
- The ephemeral **disclosure/outcome/rendering ID format** inside one bundle.
  Decision 010 requires only that they are deterministic within a bundle and
  reused by its repair (`D4-H`).
- The **gate-result vocabulary** used as the fourth key of the authored fallback
  lookup. Decision 009 names the key but not its values (`D4-K`).
- Per-dependency **call deadlines**. Decision 007 fixes the 24-second budget and
  four-second reserve but marks individual Titan/Haiku/Sonnet deadlines
  *"tunable only after the first instrumented vertical slice"*, i.e. undefined
  today (`D4-L`).
- The **price catalog** shape and its version identifier.
  `model_cost_reservations.price_version` is `STRING NOT NULL`; nothing says
  what goes in it or where rates live (`D4-M`).
- The **worst-case cost ceiling** per purpose used for admission. Decision 004
  fixes the three dollar thresholds; the per-call maximum is unspecified
  (`D4-M`).
- `attempt_ordinal` allocation. `uq_model_cost_reservations__player_action` is
  `(player_action_id, purpose, attempt_ordinal)`, so retry, repair, and revision
  rerun must each pick a distinct ordinal, and nothing says how (`D4-N`, §9.6).
- What goes in `agent_runs.inference_profile` when a deployment resolves a bare
  model ID. Both columns are `NOT NULL` (`D4-N`, §9.5).
- How an insert effect references **another row created by the same plan**. The
  shipped `insertIds` map is keyed by *table name*, so it cannot express two
  transmissions or a transmission→episode reference (`D4-F`, §9.2).
- Where the **post-selection** deterministic effects live — the rows whose
  existence depends on which renderings the model chose (`D4-E`, §9.3).
- How a terminal `503 MODEL_UNAVAILABLE_RETRY_ACTION` is **stored**. There is no
  writer for a `failed` action with a saved problem body (`D4-O`, §9.4).
- Whether the Phase 4 integration journey may call `leave` after a mutation.
  Phase 3's `leave` deliberately fails an eligible ambient range (`D4-P`, §9.8).

## 2. Implementation decisions

Structural choices Phase 4 is permitted to make, recorded so Phase 5 inherits
them instead of rediscovering them.

| ID | Decision | Rationale |
|---|---|---|
| `D4-A` | One new workspace package, `packages/model-runtime`, holding the Bedrock/Titan adapters, deadline and retry policy, model resolution, cost catalog and admission arithmetic, semantic validators, bundle assembly, and the fallback resolver. It has **no** dependency on `@the-town-remembers/database`, no `pg`, and no filesystem or URL access | `vitest.config.ts` includes `packages/*/src/**/*.ts` in the global coverage floor (80% statements/functions/lines and 70% branches), so this code must not live in `apps/`. Keeping it out of `game-server` is what makes `P4-02`'s *"`DialogueService` has no database dependency"* a one-line `package.json` assertion instead of an import-graph audit. Phase 5's ambient worker needs the same adapters without `game-server`'s HTTP layer |
| `D4-B` | Prompt **text**, hashing, and task-input builders extend `packages/model-contracts`; **semantic validators** live in `packages/model-runtime` | The contracts package is deliberately dependency-free apart from `zod`, and the `contracts` vitest project already covers it. A validator needs `rules`' bundle types and `content`'s rendering records, which the contracts package must not import |
| `D4-C` | New `runtime-config` category `model-runtime` in `packages/runtime-config/src/model.ts`, exported as `./model`. It carries region, the two resolved chat model identifiers, the Titan model identifier, an optional inference-profile ARN per role, the price-catalog version, per-purpose deadlines, the reduced-cost override, and the live-test opt-in. It carries **no** AWS access key: credentials come from the default provider chain | Mirrors `D3-C`'s security category exactly, including `SECRET_VARIABLE_PATTERN` exclusion from the browser bundle. A long-lived key in application config would be a credential this repository has so far avoided owning |
| `D4-D` | The only new runtime dependency is `@aws-sdk/client-bedrock-runtime`, added to `packages/model-runtime` alone. No LLM framework, no retry library, no JSON-schema runtime | `AbortSignal` plus the existing `deadline.ts` covers timeouts; Decision 007 allows exactly one transport retry, which is four lines. `zod` already validates output shape |
| `D4-E` | Every model-backed action is planned in **two pure stages**: `plan*` (already shipped) decides authority and pre-selection effects and emits the bundle; a new `applyDialogueSelection*` family in `packages/rules` turns a *validated* selection or fallback into the remaining deterministic effects (`npc_interactions`, NPC→player `claim_transmissions` with rendering-order ordinals, `episodes` + `episode_references`, board entries). `game-server` composes; it never derives an effect from model output itself | Otherwise the second half of every Phase 4 action becomes rules logic living in the orchestration layer, which is exactly what Phase 2 exists to prevent. It also makes "model output cannot invent an effect" a `rules` unit test with no database and no network |
| `D4-F` | `EffectPlanEntry` gains plan-local **reference handles**: an insert effect may carry `ref: "<handle>"`, and any effect's row/change may carry `{ $planRef: "<handle>" }` in place of an id. `commitEffectPlan` resolves handles in plan order and fails loudly on an unknown or forward reference. The Phase 3 `insertIds` map stays for pre-allocated ids the response needs | The shipped map is keyed by table, so it cannot express two rows in one table or a row-to-row link. `tell` alone inserts one claim, one transmission, one episode, several episode references, and several evidence rows that reference each other (§9.2) |
| `D4-G` | All Titan and Bedrock calls happen strictly between `loadInputs` and the final transaction, under `preCommitDeadline`. The existing `no-network-in-transaction.test.ts` is extended to fail if any `model-runtime` symbol is reachable from a module that imports `runSerializable` inside the same call path | Decision 007 invariant 7 |
| `D4-H` | Bundle-local IDs are sequential, prefixed, and assigned in a deterministic sort order: `d1..dn` for disclosures, `o1..on` for outcomes, `r1..rn` for renderings, `e1..en` for episodes. They are never persisted and never derived from a database id | Satisfies "deterministic within one bundle, reused unchanged by its repair" while making it structurally impossible for an internal UUID to reach the model. A digest-derived id would be longer, no safer, and harder to read in an eval fixture |
| `D4-I` | The dialogue corpus lives in `packages/content/src/dialogue/`: `profiles.ts` (voice rules, never-do rules, keyed by `AuthoredNpc#profileVersion`), `templates.ts` (rendering templates), `fallbacks.ts` (the Decision 009 matrix, verbatim), `offers.ts` (the two promise offers and requested-item bindings). Template text is authored prose with a closed placeholder set — `{claim}`, `{entity}`, `{actor}`, `{item}`, `{clue}` — bound only to canonical player-safe values. No placeholder can carry raw player text | `packages/content` is already the frozen-per-town authority; putting dialogue anywhere else would create a second content version to freeze. The closed placeholder set is what lets `P4-02`'s injection tests be exhaustive rather than sampled |
| `D4-J` | Aliases are authored as a new `aliases: readonly string[]` field on `AuthoredEntity`/`AuthoredNpc`, NFKC-normalized and case-folded at build time, validated unique within a town by `content/validate.ts` | Normalization `trusted_context` requires them, and a runtime alias table would drift from the frozen content version |
| `D4-K` | The gate-result vocabulary is a closed domain in `packages/rules`: `passed`, `denied_disclosure_tier`, `denied_belief`, `denied_access`, `denied_custody`, `denied_promise_context`, `denied_draft_state`, `no_disclosure_available`, `town_frozen`. It is the fourth key of the fallback lookup and one of the `dialogue_directive` inputs | Decision 009 names the key without enumerating values; a closed domain makes fallback coverage checkable at startup |
| `D4-L` | Per-purpose deadlines (`model-runtime` config, tunable): Titan query embedding **1,500 ms**, Titan episode embedding **1,500 ms**, Haiku normalization **6,000 ms**, Sonnet dialogue **8,000 ms**, Haiku dialogue repair **5,000 ms**, Haiku ambient choice **4,000 ms** (declared here, first used by Phase 5). A step starts only if `now + worstCase(step) <= applicationDeadline - 4,000 ms` | Worst case for `ask` is 1.5 + 8 + 5 = 14.5 s of model time, leaving ~5.5 s of the pre-reserve budget for reads, validation, and a transport retry. Decision 007 requires the admission check, not the specific numbers |
| `D4-M` | The price catalog is checked-in immutable data in `model-runtime/src/cost/price-catalog.ts`, versioned `bedrock-prices/2026-08-01` (matching Decision 004's stated pricing date), with per-model rates for input, output, cache-read, and cache-write tokens, plus a per-purpose worst-case token ceiling. All arithmetic is in **integer micro-USD** and converted once at the persistence boundary to `DECIMAL(12,6)`. An unknown model, unknown purpose, or missing ceiling **fails closed** | Floating point cannot be reconciled against a `DECIMAL(12,6)` ledger with a `settlement_within_reservation` check. A catalog version in code, recorded per reservation, is what makes an old reservation auditable after a price change |
| `D4-N` | `attempt_ordinal` is allocated from a per-action counter in purpose order: `0` first attempt, `1` transport retry, `2` repair, `3` post-rerun first attempt, `4` post-rerun retry, `5` post-rerun repair. `agent_runs.inference_profile` records the resolved ARN when configured and the resolved model ID otherwise; the empty string is rejected | Both columns are `NOT NULL`, and the unique index forbids reusing an ordinal for the same `(action, purpose)` |
| `D4-O` | New `persistence/actions.ts#storeTerminalFailure(status, problemBody)` writes `player_actions.status = 'failed'` with a saved problem body, released processing token, and no effects. It is the only writer of a terminal model failure | Decision 006's `503 MODEL_UNAVAILABLE_RETRY_ACTION` has no writer today (§9.4); replay of a failed action must return the saved body byte-for-byte |
| `D4-P` | The Phase 4 acceptance journey **never calls `leave` after a mutation**. Player A confirms a claim and stays in town; Player B enters concurrently and asks the same NPC. The eligible-range `leave` branch remains Phase 3's explicit `500` until `P5-01` replaces it | The phase plan already says Phase 4 does not complete the eligible Leave path; this makes the consequence for the acceptance script explicit rather than discovered during `P4-24` (§9.8) |
| `D4-Q` | Episode embedding is attempted **inline, pre-commit**, only when its worst case fits before the reserve; otherwise the episode is inserted `pending`. A `pending`/`failed` episode is retried by (a) the operator backfill command and (b) at most one make-up embedding per later model-backed action for the same NPC. The conditional update is `WHERE embedding_status IN ('pending','failed')` | A Lambda cannot do work after its response, so "embed later in the same request" does not exist. Leaving the row honest and retryable is what `0004`'s `ck_episodes__embedding_consistency` was designed for |
| `D4-R` | The six kinds enter `ENABLED_ACTION_KINDS` behind a runtime capability, `TTR_ENABLE_NPC_MUTATIONS` (`game-runtime`), default **false**. Only the local and isolated integration profiles set it true before `P5-22` | The phase plan's release constraint is a runtime property, not a code-comment promise. A flag makes the same build safe to deploy to a shared environment |
| `D4-S` | `model_action` admission uses two buckets — `(player, 6/min, burst 3)` and `(town, 30/min, burst 10)` — added to `RATE_LIMIT_BUCKETS` and charged **before** an action row is created, in the same transaction as the claim. A processing/terminal replay bypasses the charge; a retryable action that will call models again charges before reclaiming | Matches the phase plan's numbers, and the shipped `rateScopeKey(scopeKind, townId, subjectId)` already folds the town into both scopes |
| `D4-T` | Non-repair prompt hashing is SHA-256 over the exact system text in UTF-8. Repair hashing is SHA-256 over the canonical JSON **array** of the two exact strings, target prompt first, using `serialization/canonical-json.ts` | Decision 010 specifies both forms; keeping them distinct is what makes a repair run's hash reproducible from the two versions it records |
| `D4-U` | Two new vitest projects: `model-runtime` (pure, fixture-driven, in the default run) and `model-live` (opt-in, excluded from `pnpm test`, gated on `TTR_MODEL_LIVE_TESTS=1` plus credentials, skipping with an explicit reason otherwise). Recorded adapter fixtures are redacted transcripts, never free text accepted at runtime | Decision 010's evaluation gate must be fast and deterministic; the live smoke must exist but must not gate every local run |
| `D4-V` | `apps/web` gains `screens/Encounter.tsx`, `components/{TellSheet,EvidencePicker,PromiseOfferCard}.tsx`. Tell uses **two** journal entries with two idempotency keys (`normalize_claim`, then `tell`), and the journal machine gains no new states — a draft is client state, not a pending action | Decision 011 requires two visibly separate commitments and forbids silent renormalization; reusing the shipped machine keeps recovery behavior identical to Phase 3's |

## 3. Dependency selection

One new external runtime dependency, one new workspace package, and four new
dependency edges.

| Package | Where | Why |
|---|---|---|
| `@aws-sdk/client-bedrock-runtime` | `packages/model-runtime` | `ConverseCommand` and `InvokeModelCommand` (Titan). The only external client in the phase |
| `@the-town-remembers/model-runtime` *(new)* | consumed by `packages/game-server`, later by `apps/ambient-worker` | Adapters, validators, bundle assembly, cost arithmetic (`D4-A`) |
| `@the-town-remembers/model-contracts` | `packages/model-runtime` | Prompts, schemas, versions |
| `@the-town-remembers/rules` | `packages/model-runtime` | `ApprovedDisclosureBundle`, disclosure tiers, gate-result domain |
| `@the-town-remembers/content` | `packages/model-runtime` | Rendering templates, fallback matrix, voice profiles |
| `@the-town-remembers/serialization` | `packages/model-runtime` | Canonical JSON for prompt hashing (`D4-T`) |
| `@the-town-remembers/runtime-config` (`./model`) | `packages/model-runtime`, `packages/game-server` | Deadlines, model resolution, price version, cost mode |
| `@the-town-remembers/model-contracts` | `packages/game-server` | Already an allowed dependency of `apps/game-api`; the executor needs run purposes and outcomes |
| `@aws-sdk/*` | `packages/game-server` — **not added** | The orchestration layer must reach models only through `model-runtime`'s typed outcomes |
| `@the-town-remembers/database`, `pg` | `packages/model-runtime` — **forbidden** | `D4-A`; asserted by a `package.json` test and a boundary rule |

`scripts/check-workspace-boundaries.mjs` changes:

- one new `EXPECTED_PACKAGES` entry — `path: "packages/model-runtime"`,
  `kind: "library"`, `exports: STANDARD_EXPORTS`, `allowedDependencies` exactly
  the five workspace packages above;
- `packages/game-server`'s `allowedDependencies` gains `MODEL_RUNTIME` and
  `MODEL_CONTRACTS`;
- a new `RUNTIME_CONFIG_EXPORTS` entry `"./model"`, with a
  `validateModelConfigImport` rejecting it anywhere except `packages/model-runtime`,
  `packages/game-server`, `apps/game-api`, and `apps/ambient-worker`; and
- a new forbidden-specifier rule: `@the-town-remembers/database`, `pg`, and
  `@aws-sdk/*` in `packages/model-runtime`, `apps/web`, and `packages/rules`.

`apps/web` gains no workspace dependency.

## 4. Planned file layout

```text
packages/model-contracts/src/
  prompts/
    claim-normalization.ts     exact system text, frozen constant
    npc-dialogue.ts             exact system text
    structured-repair.ts         exact overlay text
    hash.ts                       D4-T single- and composite-prompt hashing
    index.ts
  inputs/
    normalization-input.ts     task_input builder + Zod shape (versioned)
    dialogue-input.ts           trusted_context builder + Zod shape
    repair-input.ts              D4 repair envelope, no repair-of-repair
  prompts.test.ts               drift: text, hash, version metadata

packages/model-runtime/src/
  index.ts
  config.ts                   resolved model roles, deadlines, cost mode
  bedrock/
    converse.ts               ConverseCommand + json_schema output config
    titan.ts                   256-d embedding invocation
    deadline.ts                 abort signal derivation, fits-before-reserve
    retry.ts                     one transport retry, classified errors
    outcomes.ts                   typed DependencyOutcome union
  validation/
    normalization.ts           semantic validator (membership, signatures)
    dialogue.ts                 semantic validator (membership, coverage, limits)
    errors.ts                    stable codes -> sanitized repair errors
    repair.ts                     one repair-input builder, no authority growth
  bundle/
    renderings.ts              template -> exact rendering record + validation
    assemble.ts                 ApprovedDisclosureBundle -> trusted_context
    ids.ts                       D4-H deterministic bundle-local IDs
    fallback.ts                  authored fallback resolver + coverage assertion
  cost/
    price-catalog.ts           D4-M immutable rates and ceilings
    estimate.ts                 worst-case and settled cost in micro-USD
    mode.ts                      $8 / $9.50 / $10.35 mode selection
  warmup.ts                    four (model, schema) pairs, synthetic input
  *.test.ts
  __fixtures__/                recorded, redacted adapter transcripts

packages/game-server/src/
  persistence/
    model-runs.ts              agent_runs append (purpose-branched columns)
    model-cost.ts               reservation admit / settle / release
    claims.ts                    claim upsert by normalized_key, relations
    drafts.ts                     claim_drafts create / load / confirm
    transmissions.ts               ordinal-stable insert + provenance roots
    episodes.ts                     episode + references, embedding lifecycle
    recall.ts                        vector query, structured anchors
    beliefs.ts                        belief + evidence reads for a bundle
    relationships.ts                   stance and ledger reads
    promises.ts                         active promises, offer descriptors
    npc-state.ts                         NPC snapshot, capabilities, custody
    board.ts                              testimony / hearsay entries
  application/
    npc/
      context.ts               NpcContextBuilder (DB reads -> pure inputs)
      recall.ts                 embedding + anchors -> rules ranking
      dialogue.ts                selection -> validate -> repair -> fallback
      offers.ts                   D4-S offer encode/decode and re-validation
    actions/
      model-executor.ts        P4-10 orchestration around executor.ts
      inputs/
        ask.ts                  per-kind loaders (D3-N shape, model-aware)
        normalize-claim.ts
        tell.ts
        show.ts
        give.ts
        accept-promise.ts
    commands/
      prewarm.ts               operator warmup entry point
      embed-seed.ts             resumable seed-memory backfill
  *.test.ts / *.db.test.ts

packages/rules/src/
  actions/
    model-backed.ts            extended: post-selection effect planners (D4-E)
    selection.ts                applyDialogueSelection* family
  kernel/
    effects.ts                 extended: plan-local reference handles (D4-F)
    gate-results.ts             D4-K closed gate-result domain
  content-validation/
    fallback-coverage.ts       unchanged engine, finally fed real content

packages/content/src/
  dialogue/
    profiles.ts                voice rules per profileVersion
    templates.ts                rendering templates (D4-I)
    fallbacks.ts                 Decision 009 matrix verbatim
    offers.ts                     promise offers, requested-item bindings
  entities.ts                  extended: aliases (D4-J)
  validate.ts                   extended: corpus coverage + placeholder safety

packages/runtime-config/src/
  model.ts                     D4-C model-runtime category

apps/web/src/
  screens/Encounter.tsx
  components/TellSheet.tsx
  components/EvidencePicker.tsx
  components/PromiseOfferCard.tsx

evals/
  phase-04/                    deterministic prompt-eval fixtures (P4-21)

e2e/
  phase-04-grounded-memory.spec.ts
```

## 5. Task-level execution detail

### Workstream A — Model-independent prompt and bundle contracts

#### `P4-01` — Prompt text, hashing, and task-input contracts

**Depends on:** Phase 3 exit gate

**Re-scoped.** §1.2 establishes that the schema snapshots, runtime schemas,
version metadata, and drift tests already shipped in Phase 0. This task adds
only what does not exist.

**Modules**

- `model-contracts/prompts/{claim-normalization,npc-dialogue,structured-repair}.ts`
  — the three system prompts as frozen template-literal constants copied
  byte-for-byte from Decision 010, with a header stating that deployed versions
  are immutable and a change requires a new version constant.
- `model-contracts/prompts/hash.ts` — `promptHash(text)` and
  `repairPromptHash(targetText, overlayText)` per `D4-T`, returning a 32-byte
  `Buffer` matching `ck_agent_runs__prompt_sha256_length`.
- `model-contracts/inputs/*.ts` — versioned builders producing the exact user
  message object: `{ task_input_version, trusted_context, untrusted_* }`. Each
  has a Zod shape used to validate the object **before** it is serialized, so a
  malformed bundle fails locally rather than at Bedrock.

**Acceptance**

1. `contracts` project: each prompt constant equals the corresponding fenced
   block in `docs/010-bedrock-prompt-contracts.md`, extracted by the test itself
   — the test fails if the document changes and the constant does not.
2. Prompt hashes are stable across runs and platforms; the repair hash differs
   from both of its inputs and from a naive concatenation of them.
3. Every input builder rejects an object containing an unexpected key, a
   non-string untrusted field, or an untrusted field placed inside
   `trusted_context`.
4. Serialized input contains no `\r`, no BOM, and no key ordering dependency:
   two builds of the same logical input serialize byte-identically.
5. A source scan asserts no prompt constant is interpolated with a runtime value.

#### `P4-02` — Trusted model-input and grounding types

**Depends on:** `P4-01`

**Modules**

- `model-runtime/bundle/ids.ts` — `D4-H` sequential ID allocation over a
  deterministically sorted input, plus a reverse map used only in-process.
- `model-runtime/bundle/renderings.ts` — `RenderingRecord` (exact text, one
  response kind, ordered disclosure/outcome IDs, materially used episode IDs,
  named entity/actor IDs, style tags) and `buildRendering(template, bindings)`.
  Validation runs at construction: text non-empty, plain, no Markdown, no
  internal ID substring, no raw player text, every referenced ID present in the
  bundle sets, and length within `NPC_DIALOGUE_RESPONSE_LIMITS`.
- `model-runtime/bundle/assemble.ts` — `assembleDialogueContext(...)` taking the
  `ApprovedDisclosureBundle`, NPC profile, stance, directive, gate result,
  renderings, episodes, entities, actors, and limits, and returning the exact
  `trusted_context`. Its parameter types accept only branded player-safe values
  and explicitly labeled untrusted text.

**Acceptance**

1. `model-runtime/package.json` lists neither `@the-town-remembers/database`,
   `pg`, nor `@aws-sdk/client-s3`-style extras; a test asserts the dependency
   set exactly and fails on addition.
2. A red-team fixture set — NPC display names, item names, episode summaries,
   and player text containing `Ignore previous instructions`, a fenced code
   block, an HTML tag, a JSON object, and a `{claim}` placeholder — round-trips
   into the bundle as **quoted data** and never into a rendering's text.
3. Constructing a rendering whose text contains any bundle ID, any UUID, or any
   `world_facts`/`case_solutions` string is rejected with a stable code.
4. A bundle cannot be assembled with more than four required disclosures, three
   required outcomes, or eight episodes; each is a distinct error code.
5. Bundle IDs are identical across two assemblies of the same inputs and change
   when any input changes.

#### `P4-03` — Semantic validators and the authored fallback resolver

**Depends on:** `P4-01`, `P4-02`, `P4-03a`

**Modules**

- `model-runtime/validation/normalization.ts` — entity/actor/context membership,
  `CLAIM_PREDICATE_SIGNATURES` matrix, complete/null field combinations, reason
  class per status, and rejection of any partial claim on a non-normalized
  status. `normalized_key` is computed by `content/claim-key.ts`, never read
  from output.
- `model-runtime/validation/dialogue.ts` — response-kind membership, one to
  three distinct approved renderings, required disclosure/outcome coverage,
  derived grounding within limits, exact concatenation, sentence/word limits,
  no Markdown or stage direction, no ID or metadata in the concatenated text.
- `model-runtime/validation/errors.ts` — the eighteen
  `REPAIR_VALIDATION_ERROR_CODES` mapped from validator failures, each carrying
  a JSON path and a sanitized explanation drawn from a fixed sentence table.
- `model-runtime/validation/repair.ts` — the single repair-input builder:
  original trusted context, original untrusted text, `untrusted_invalid_output`,
  sanitized errors, target schema. Refuses to build from a repair result.
- `model-runtime/bundle/fallback.ts` — lookup by
  `(npcKey, actionKind, responseKind, gateResult, requiredOutcomeIds)`, plus
  `assertFallbackCoverage(content)` calling
  `rules/content-validation/fallback-coverage.ts` at startup.

**Acceptance**

1. Table-driven tests over every predicate/kind pair prove an invalid signature
   is rejected with `invalid_predicate_signature` and never coerced.
2. A dialogue selection naming an unknown, duplicated, incompatible, or
   uncovered rendering fails with the matching stable code; a selection whose
   concatenation exceeds 3 sentences or 80 words fails with `response_too_long`.
3. Repair input never contains a secret, a raw database row, a case solution
   string, or an error message quoting hidden truth; a snapshot test pins the
   sanitized sentence table.
4. `buildRepairInput` throws when handed a repair outcome (no repair-of-repair).
5. `assertFallbackCoverage` fails a synthetic corpus missing exactly one
   `(NPC, action, kind, gate)` row and names it; the real corpus passes.
6. Corin's four-disclosure final-truth requirement resolves to the exact
   Decision 009 confession text.

#### `P4-03a` — Author the dialogue corpus *(new task, see §9.1)*

**Depends on:** `P4-01`

Not in the phase plan; §1.1 shows it is a prerequisite of `P4-03` and `P4-09`
that no earlier phase produced.

**Modules**

- `content/dialogue/profiles.ts` — voice rules, never-do rules, stance
  vocabulary per `profileVersion` (`mara-venn/1.0.0`, `corin-hale/1.0.0`,
  `nessa-reed/1.0.0`), transcribed from Decision 009's Voice/Never-do bullets.
- `content/dialogue/templates.ts` — rendering templates. Coverage target: for
  each NPC, each disclosure in the Decision 009 tier table, each mechanical
  outcome, and each denial situation, **two to three** voiced alternatives, plus
  the Corin confession set. Estimated 140–200 authored records.
- `content/dialogue/fallbacks.ts` — the three Decision 009 tables verbatim
  (per-NPC × action, situational denials, outcome-specific lines), keyed by
  `D4-K` gate results.
- `content/dialogue/offers.ts` — `return-chapel-key-v1` and
  `keep-lark-accident-secret-v1` descriptors, requested-item bindings.
- `content/entities.ts` — `D4-J` aliases.
- `content/validate.ts` — placeholder-closure check, no-hidden-truth check
  (no template may name the chapel location, Lark's responsibility, or a motive
  outside its authored tier), alias uniqueness, and fallback coverage.

**Acceptance**

1. Every template's placeholder set is a subset of the closed `D4-I` set.
2. No template or fallback line contains a `world_facts` or `case_solutions`
   string outside the tier that authorizes it; Mara's corpus contains no chapel
   location and Nessa's contains no cart-load truth.
3. Every `(NPC, action, responseKind, gateResult)` in the requirement matrix has
   at least one fallback and at least one template alternative.
4. Content-version freezing still holds: `contentFor("bell-mystery-v1")` returns
   the corpus and there is no "latest" accessor.
5. Aliases NFKC-normalize and case-fold to unique values within the town, and no
   alias collides with a player display name rule from `P3-04`.

### Workstream B — Bedrock, deadlines, telemetry, and cost

#### `P4-04` — Bounded Bedrock Runtime adapters

**Depends on:** `P4-01`, `D4-C`

**Modules**

- `runtime-config/model.ts` — `D4-C` category, fail-closed, with a test that a
  missing model ID is a configuration error naming the variable and not its
  value.
- `model-runtime/bedrock/converse.ts` — one `converse(request)` entry point
  building `outputConfig.textFormat.structure.jsonSchema` from
  `OUTPUT_SCHEMA_NAMES`/`OUTPUT_SCHEMA_DESCRIPTIONS` and
  `toBedrockJsonSchema`, with citations and streaming off, `temperature` and
  `maxTokens` from `INFERENCE_SETTINGS`, and an `AbortSignal` from `D4-L`.
- `model-runtime/bedrock/retry.ts` — classification of throttling/5xx as
  retryable, everything else terminal; at most one retry, and only when the
  whole retried call still fits before the reserve.
- `model-runtime/bedrock/outcomes.ts` — the closed `DependencyOutcome` union:
  `transport_failure`, `timeout`, `content_stop`, `parse_failure`,
  `schema_failure`, `semantic_rejection`, `accepted`, `repaired`, `fallback`.
  Rejected raw text is carried only inside the in-memory value passed to the
  repair builder and is `never` on any exported persisted type.

**Acceptance**

1. Fixture-driven tests cover: success, throttling then success, throttling
   twice (terminal), 500, timeout, `stopReason: max_tokens`, malformed JSON,
   schema-valid-but-semantically-invalid, and refusal.
2. A call whose worst case does not fit before the reserve is never started;
   the outcome is `timeout` with a distinct "not attempted" reason and no AWS
   call is constructed (asserted on a spy client).
3. Model resolution picks Sonnet for dialogue by default and Haiku under
   reduced-cost mode, with identical prompt, schema, and validator versions.
4. No exported type in `model-runtime` has a field that could carry raw model
   text; a type-level test asserts it.
5. `AbortSignal` cancellation is observable — the client's `abortSignal` is the
   one derived from the operation deadline, not a fresh one.

#### `P4-05` — Model run telemetry and the cost ledger

**Depends on:** `P4-04`

**Modules**

- `model-runtime/cost/price-catalog.ts`, `estimate.ts`, `mode.ts` — `D4-M`
  integer micro-USD arithmetic, `worstCase(purpose, model)`, `settled(usage)`,
  and mode selection at `$8.00` / `$9.50` / `$10.35`.
- `game-server/persistence/model-cost.ts` — `admit(...)` inserting one
  `model_cost_reservations` row (`status='reserved'`) inside a serializable
  transaction that also re-reads settled actual cost plus outstanding
  reservations for the UTC `billing_month`; `settle(reservationId, runId, cost)`
  and `release(reservationId)` in one short post-call transaction each.
- `game-server/persistence/model-runs.ts` — `appendRun(...)` writing `agent_runs`
  with the purpose-branched column set required by
  `ck_agent_runs__contract_versions` (§9.7), the `D4-N` profile fallback, and
  `superseded` for a revision-lost accepted output.
- `game-server/observability/{events,metrics}.ts` — new closed log-event members
  and counters carrying IDs, versions, counts, latency, cost, and stable codes
  only.

**Acceptance** *(`database` project unless noted)*

1. Admission is atomic under concurrency: N concurrent reservations at a
   boundary admit exactly the number the ceiling permits, proven at each of the
   three thresholds and at the hard cap.
2. A call cannot start without a committed reservation; a spy adapter asserts
   ordering.
3. Retry, repair, and revision rerun each reserve separately with distinct
   `attempt_ordinal`s and do not violate
   `uq_model_cost_reservations__player_action`.
4. Settlement never exceeds its maximum (`ck_..._settlement_within_reservation`
   holds under a deliberately underestimated ceiling — the settle path clamps
   and logs, rather than throwing at the database).
5. A proven non-call releases (`actual_cost = 0`); an ambiguous call stays
   `reserved` and continues to consume capacity, and a test asserts a later
   reconciliation can settle it.
6. Embedding runs write null contract-version columns and non-embedding runs
   write all four; both directions are asserted against the check constraint.
7. `pure` test: no log or metric field can carry prompt text, raw output, player
   text, or a connection string — asserted through
   `test-support/redaction.ts#FORBIDDEN_LOG_PROPERTIES`.
8. Monthly aggregation returns a mode, and no public response, header, or error
   body contains a dollar value.

#### `P4-06` — Live smoke and schema prewarm entry points

**Depends on:** `P4-03`–`P4-05`

**Modules**

- `model-runtime/warmup.ts` — the four `WARMUP_PAIRS` with tiny synthetic
  inputs and the real checked-in schemas.
- `game-server/application/commands/prewarm.ts` + `scripts/model-prewarm.mjs` —
  operator command creating no town and no `agent_runs` row, emitting metrics
  only.
- `vitest.config.ts` — the `model-live` project (`D4-U`).

**Acceptance**

1. Prewarm succeeds against fixtures and, when opted in, against real Bedrock;
   it writes zero rows in a disposable database (asserted by row counts before
   and after).
2. Without credentials or the opt-in flag, live tests skip with an explicit
   printed reason; `pnpm test` never contacts the network (asserted by a global
   fetch/AWS-client trap in the default projects).
3. Warmup metrics record success, latency, and cost per pair.
4. Documentation names the Phase 7 handoff: the fourth ambient pair and the
   20-hour EventBridge schedule.

### Workstream C — CockroachDB vector memory

#### `P4-07` — Titan embedding service and episode lifecycle

**Depends on:** `P4-04`, `P4-05`

**Modules**

- `model-runtime/bedrock/titan.ts` — `amazon.titan-embed-text-v2` at
  `dimensions: 256`, deadline, one eligible retry, and validation that the
  vector has exactly 256 finite values.
- `game-server/persistence/episodes.ts` — episode + reference insert with
  `embedding_status` per `D4-Q`; `markEmbeddingReady(episodeId, vector)` as a
  conditional `UPDATE … WHERE embedding_status IN ('pending','failed')`;
  `readPendingEmbeddings(townId, limit)`.
- `game-server/application/commands/embed-seed.ts` + `scripts/embed-seed.mjs` —
  resumable backfill bounded by town and content version, bounded concurrency,
  no unscoped scan.

**Acceptance**

1. Wrong dimension, non-finite value, timeout, and throttle-then-success are all
   covered by fixtures; a wrong-dimension response never reaches the `UPDATE`.
2. `database` project: a failed embedding leaves the episode row, its references,
   its text, and its importance untouched, with `embedding IS NULL` and
   `embedding_status = 'failed'`.
3. Two concurrent `markEmbeddingReady` calls produce one write and one no-op;
   neither overwrites a `ready` row.
4. Backfill is resumable — killing it halfway and rerunning embeds exactly the
   remaining rows and re-embeds none.
5. `agent_runs` rows for `episode_embedding` and `query_embedding` carry the
   embedding-purpose column shape.

#### `P4-08` — Scoped retrieval and deterministic reranking

**Depends on:** `P4-07`, `rules/recall/*`

**Modules**

- `game-server/persistence/recall.ts` — the vector query:
  `WHERE town_id = $1 AND npc_id = $2 AND embedding_status = 'ready'
  ORDER BY embedding <=> $3 LIMIT 30`, using the
  `(town_id, npc_id, embedding)`-prefixed index; plus the structured-anchor
  queries (recent, importance ≥ 80, active commitment/grievance, active
  contradiction) capped at ten, in `compareRecallAnchors` order.
- `game-server/application/npc/recall.ts` — dedupe by episode id, compute the
  six components from already-loaded state, call `computeRecallScore` and
  `rankRecallResults`, and return the top eight with their similarity and
  provenance.

**Acceptance** *(`database` project)*

1. Two towns and two NPCs with deliberately similar embeddings: a query returns
   only its own `(town, npc)` rows, and a `pending`/`failed` row never appears.
2. Similarity is derived as `1 - distance` clamped to `[0, 1]`, and the ranked
   output matches a hand-computed expectation at each formula boundary,
   including exact ties resolved by `compareRecallResults`.
3. With `embeddingAvailable = false`, only anchors are used, every similarity is
   `0`, and the candidate set never widens beyond the same NPC and town.
4. With no anchors and no embedding, the caller receives an empty authorized set
   and the action completes on an authored fallback.
5. `EXPLAIN` (where the local cluster exposes it) shows the vector index in use
   rather than a full scan; the test skips with a reason if unavailable.
6. Thirty candidates plus ten anchors never produce more than eight results.

#### `P4-09` — NPC context and rendering candidates

**Depends on:** `P4-02`, `P4-03`, `P4-03a`, `P4-08`

**Modules**

- `game-server/persistence/{npc-state,beliefs,relationships,promises,board}.ts` —
  the explicit town/NPC/player-scoped read set: active visit and co-location,
  NPC snapshot, current beliefs and their contradicting scores, relationship
  scores, active promises, capabilities, item custody, prior transmissions.
- `game-server/application/npc/context.ts` — `NpcContextBuilder`: loads the
  above, applies `rules`' disclosure tiers, selected-belief/contestation,
  cover-story, access/item/promise gates and the **predicted post-action state**,
  then hands pure inputs to `model-runtime/bundle/assemble.ts`.

**Acceptance**

1. Regression fixtures: Mara's bundle never contains the chapel location; Nessa's
   never contains the cart's load; Corin's contains no private player↔NPC
   conversation without a transmission reaching him; `final_truth` cannot enter a
   bundle whose confrontation gate is closed.
2. Required disclosures ≤ 4, outcomes ≤ 3, memories ≤ 8, renderings from
   authored templates only.
3. The builder's inputs to `assemble` contain no raw row, no `world_facts`
   record, and no score; a type-level test pins the parameter types.
4. Post-action prediction: a `show` that will grant Corin's capability produces a
   bundle whose outcome set already contains the grant, and a `tell` produces a
   bundle over the predicted post-effect belief.
5. `database` project: the whole builder runs inside the pre-commit deadline for
   a fully populated town, measured and asserted with margin.

### Workstream D — Model-backed action orchestration

#### `P4-10` — The model-aware executor

**Depends on:** `P4-04`, `P4-05`, `P4-09`, Phase 3 executor

**Modules**

- `rules/kernel/effects.ts` — `D4-F` reference handles;
  `game-server/application/actions/commit.ts` — handle resolution, extended
  `EVENT_FOREIGN_KEY_COLUMN`/`CONDITIONAL_CHANGE_EVENT_FOREIGN_KEY_COLUMN` maps
  for the Phase 4 tables, and support for more than one `event_origin` in a plan.
- `game-server/application/actions/model-executor.ts` — the Observe → Recall →
  Decide → Validate → Act → Persist loop wrapped around the shipped executor:
  pre-model snapshot and revision, all model work outside transactions, one
  bounded reload-and-rerun on revision loss, `superseded` telemetry for a
  discarded accepted output, saved retryable `409 ACTION_CONFLICT` on the second
  loss, and a final transaction revalidating processing token, revision,
  visit/co-location, custody, and gates.
- `game-server/persistence/rate-limits.ts` — `D4-S` model buckets;
  `application/actions/enabled.ts` — `D4-R` capability-gated kinds.

**Acceptance**

1. `database` project: a revision bump between planning and commit reruns exactly
   once; the discarded run is recorded `superseded`; a second bump produces the
   saved retryable `409` with no effects.
2. Time budget: transport retry + repair + rerun is admitted only when it fits;
   a synthetic slow adapter proves the final transaction still gets its
   five-second/remaining-budget window and the 500 ms serialization margin.
3. A late worker whose processing token was replaced cannot commit; the existing
   `StaleExecutionClaimError` path holds with model work in front of it.
4. Rate limiting: the 4th action in a burst of 3 is `429` with `Retry-After`,
   consumes no idempotency key, and creates no `player_actions` row; a
   processing/terminal replay is not charged; a retryable action is charged
   before it reclaims and stays retryable if rejected.
5. With `TTR_ENABLE_NPC_MUTATIONS=false`, all six kinds return the Phase 3
   `422 UNSUPPORTED_ACTION_KIND` with no ledger row.
6. Reference handles: a plan inserting two transmissions that reference one
   episode commits with correct foreign keys; an unknown or forward handle
   throws before any statement runs.

#### `P4-11` — `ask`

**Depends on:** `P4-08`–`P4-10`

**Modules**

- `application/actions/inputs/ask.ts` — 1–500 grapheme plain text (reusing
  `AskQuestionSchema`), active co-located NPC authorization, query embedding,
  recall, bundle, selection, one repair, fallback.
- `rules/actions/selection.ts#applyAskSelection` — `npc_interactions`,
  `npc_interaction` event, NPC→player `claim_transmissions` in rendering order
  with zero-based ordinals and provenance from the disclosure record, receiving
  player board cards (testimony vs. hearsay), the NPC's `player_interaction`
  episode and references, and the ordered promise offers.

**Acceptance**

1. A question with no eligible disclosure produces a grounded refusal or
   deflection, not silence, and creates no transmission.
2. Hearsay is classified from the disclosure's `parentTransmissionId`, testimony
   from `sourceEpisodeId`; the board card's provenance matches.
3. Embedding failure, selection failure, and repair failure each complete the
   action — the first two on a valid selection over anchors only, the third on
   the authored fallback with `responseMode: "fallback"`.
4. Replay of the same key returns the byte-equivalent saved response and creates
   no second interaction, transmission, episode, or board card.
5. No response field exposes a prompt, a rendering ID, a score, or a revision.

#### `P4-12` — `normalize_claim` and single-use drafts

**Depends on:** `P4-03`–`P4-05`, `P4-10`

**Modules**

- `application/actions/inputs/normalize-claim.ts` — trusted context from frozen
  content (canonical entities/actors with `D4-J` aliases, the five predicate
  signatures, allowed contexts, `default_context_key: festival_night`) plus
  `untrusted_player_text`.
- `persistence/drafts.ts` — ten-minute pending draft bound to
  player/visit/NPC/action, canonical text projection, `allegedSource` projection.
- `persistence/actions.ts#storeTerminalFailure` — `D4-O`.

**Acceptance**

1. Every predicate × polarity × (default | explicit) context normalizes to the
   expected canonical claim and `claim-key:v1` key.
2. `needs_clarification` and `unsupported` map to `outcome: "no_change"` with
   `normalizationStatus: "needs_revision"`, authored copy from `reason_code`, and
   **no** draft, transmission, episode, or belief effect.
3. Invalid output plus failed repair stores the terminal
   `503 MODEL_UNAVAILABLE_RETRY_ACTION`; the status route replays the saved body;
   the same key does not retry and a new key is required.
4. A plausible lie normalizes exactly like a plausible truth; a prompt-injection
   payload in the player text produces a normal result or `unsupported`, never a
   changed authority.
5. A draft is single-use, expires at ten minutes by database time, and no
   partial structured state is written on any failure path.

#### `P4-13` — `tell` confirmation and belief effects

**Depends on:** `P4-12`, `P4-09`, `P4-10`, Phase 2 claim/belief rules

**Modules**

- `application/actions/inputs/tell.ts` — draft load and validation (same player,
  same active co-located visit and NPC, `pending`, unexpired).
- `persistence/{claims,transmissions,episodes,beliefs}.ts` — claim upsert by
  `normalized_key`, deterministic contradiction relations and mirror backfill,
  transmission with exact alleged source, recipient episode and references,
  testimony/corroboration/mirror evidence with trust snapshots, current belief
  recomputation.
- `rules/actions/model-backed.ts#planTell` — extended to plan those effects
  (§9.3), with `applyTellSelection` for the post-selection half.

**Acceptance**

1. Stale, expired, changed-NPC, or already-confirmed drafts produce a completed
   **denial** with safe dialogue — never an implicit renormalization.
2. One atomic transaction produces claim, relations, draft confirmation,
   transmission, episode, references, evidence, belief, interaction, event,
   dialogue, and saved response; a forced failure at each step leaves none of it.
3. Independent-root deduplication and repeat protection hold: the same claim told
   twice by the same player adds no second evidence row.
4. A false claim changes belief state and creates no change in `items`,
   `world_facts`, or `case_solutions` — asserted by a full row snapshot diff.
5. Dialogue is selected over the **predicted post-effect** state; the Tell
   fallback is exact.

#### `P4-14` — `show` and deterministic evidence consequences

**Depends on:** `P4-09`, `P4-10`, Phase 2 evidence/relationship rules

**Modules**

- `application/actions/inputs/show.ts` — town-discovered clue or currently held
  item authorization, `clue_claim_effects` load, prior-evidence load, belief
  snapshot, relationship snapshot, post-effect gate evaluation.
- Reuses `rules/actions/model-backed.ts#planShow` unchanged for the structured
  half; adds capability grant and `sorted appliedClueIds` projection.

**Acceptance**

1. Show never moves custody; an item produces structured evidence only through
   its authored inspectable/clue link.
2. Mirror coalescing, source reversal, and the narrow caught-lie rule match
   `rules/world/lies.ts` exactly; contradiction without prior physical knowledge
   is not a caught lie.
3. Repeat Show applies `verified_testimony` when newly eligible and never a
   second `evidence_presented`.
4. Corin's `enter_old_chapel` capability is granted in the same action whose
   relationship effects made it eligible, and the player-safe result is still an
   ordinary Show result.
5. `database`/HTTP: another player showing a town-discovered clue succeeds; an
   unheld item is denied; a no-effect item produces `structuredEffect: "none"`.

#### `P4-15` — `give`

**Depends on:** `P4-09`, `P4-10`, Phase 2 custody/promise rules

**Acceptance**

1. Concurrent Gives of one unique item: exactly one transfers, the other is a
   completed denial with no custody change (conditional `items.revision`).
2. Requested lens and seal each grant `requested_item_given` once; an unrequested
   item grants nothing.
3. Returning the chapel key to Nessa fulfils the promise; giving it to Mara or
   Corin breaks it; both write the promise event and relationship consequence
   atomically.
4. Wrong custodian, NPC refusal, replay, and a stale-context fallback all
   complete safely and consistently.

#### `P4-16` — Versioned promise offers and `accept_promise`

**Depends on:** `P4-11`, `P4-13`–`P4-15`

**Modules**

- `application/npc/offers.ts` — `D4-S` encode/decode of
  `base64url("promise-offer:v1\n<sourceActionId>\n<ordinal>")`, descriptor
  retrieval from the **saved source action response**, and re-validation against
  current town/player/visit/NPC/gates.

**Acceptance**

1. A forged, malformed, cross-action, or out-of-range ordinal is a completed
   denial that reveals nothing about which part failed.
2. A descriptor saved under an older content version is honored from the saved
   response; the newest content is never consulted to rebuild it.
3. Duplicate acceptance is denied by `uq_promises__active_secret` /
   `uq_promises__active_item`, not by a read-then-write race.
4. Nessa's key offer transfers custody and creates the promise atomically; a
   concurrent Give of the same key elects one winner.
5. Saved-response replay returns the identical envelope.

#### `P4-17` — Causal persistence and player-safe projection coverage

**Depends on:** `P4-11`–`P4-16`

**Modules**

- `application/player-view/build.ts` — fill the Phase 3 stubs: real
  `availableActionKinds` per encounter, `activePromises`, testimony/hearsay board
  entries with ordered provenance, discovered clues eligible for Show, inventory
  already present.
- `persistence/view-queries.ts` — the additional reads, each town- and
  player-scoped.

**Acceptance**

1. Repository-level invariant tests: interaction/event identity, transmission
   ordinals and provenance roots, episode uniqueness, evidence source snapshots,
   relationship ledger reconstruction, promise state, board classification.
2. The player view exposes no score, no objective truth, no private reasoning, no
   raw model result, and no `towns.revision`; the existing `ETag` test set is
   extended to the new fields.
3. Under `TTR_ENABLE_NPC_MUTATIONS=false`, `availableActionKinds` is empty for
   every encounter regardless of stance.
4. Inspection-view queries reconstruct one complete accepted interaction without
   widening the player API.

### Workstream E — NPC encounter interface

#### `P4-18` — Encounter route and Ask flow

**Depends on:** `P4-11`, `P4-17`

**Acceptance**

1. `/town/:townId/encounter/:npcId` is guarded by the player view; a stale
   co-location redirects to the current location.
2. The composer enforces 500 graphemes client-side, Enter inserts a newline,
   Ctrl/Cmd+Enter submits, and empty or invalid input allocates no key.
3. Only server-supplied `availableActionKinds` render as enabled controls.
4. `selected`, `repaired`, and `fallback` responses render identically; a DOM
   test asserts no class, icon, or text differs.
5. There is no scrolling transcript; refresh restores the latest completed
   exchange for the current visit only.

#### `P4-19` — Tell interpretation and confirmation flow

**Depends on:** `P4-12`, `P4-13`, `P4-18`

**Acceptance**

1. Interpret and Tell are separate actions with separate keys; the sheet closes
   only after the saved Tell response arrives.
2. Raw and canonical text carry equal visual weight; source attribution always
   renders (`Recorded source: You` or `Alleged source: {name}`).
3. The countdown is derived from `expiresAt`; at zero the primary button becomes
   `Interpret again` and cannot submit; the server check remains authoritative.
4. Edit discards client-side only, warns on navigation, and never cancels or
   reuses the server draft.
5. Browser tests: revision path, refresh during review, expiry, offline Tell and
   recovery, exactly one transmission, and no silent retarget or renormalization.

#### `P4-20` — Show, Give, promise, inventory, and result UI

**Depends on:** `P4-14`–`P4-18`

**Acceptance**

1. Show lists discovered clues and held items; Give lists held portable items
   only; confirmations distinguish viewing from custody change and warn only that
   a promise *may* be affected.
2. Offers render below the response that produced them, accept by opaque ID, and
   show `This offer is no longer available` on a stale denial without
   reconstructing anything.
3. Result cards are driven only by completed responses and the refreshed view;
   no client inference of belief, relationship, custody, capability, or promise.
4. Keyboard, focus, live-region, destructive-confirmation, simultaneous-item
   conflict, and narrow-viewport coverage all pass.

### Workstream F — Evaluations, security, observability, and docs

#### `P4-21` — Prompt evaluations

**Depends on:** `P4-01`–`P4-06`

**Modules**

- `evals/phase-04/{normalization,dialogue,repair}/*.json` — every control,
  known-failure, injection, and boundary case in Decision 010's evaluation table.
- `scripts/prompts-eval.mjs` — deterministic runner over recorded fixtures, plus
  an opt-in live mode with documented expected cost.

**Acceptance**

1. Assertions are over schema, IDs, grounding, gates, persistence safety, and
   fallback — never fuzzy prose equality.
2. A baseline file pins results to prompt/model/schema/validator versions; a
   changed model or prompt that regresses any hard-safety case fails.
3. Haiku dialogue (reduced-cost mode) must pass the same suite before the mode
   can be selected; a test asserts the switch is gated on that baseline.

#### `P4-22` — Model and memory security tests

**Depends on:** `P4-07`–`P4-17`

**Acceptance**

1. Injection fixtures in player text, aliases, rendering text, episode summaries,
   and invalid output cannot change authority, disclosure, or effects.
2. Cross-town and cross-NPC isolation holds for vector and relational reads; an
   inaccessible ID is indistinguishable from a nonexistent one.
3. Only supplied rendering/claim/entity/actor IDs are accepted; a model result
   alone cannot alter items, beliefs, relationships, promises, access, or case
   progress — asserted by driving the commit path with a hostile "accepted"
   output and diffing every table.
4. No raw rejected output is persisted or logged anywhere; queries are
   parameterized; `check:source-text` covers the new modules.

#### `P4-23` — Instrumentation and documentation

**Depends on:** `P4-04`–`P4-22`

**Acceptance**

1. Metrics segmented by purpose/model/outcome for latency, tokens, cost,
   validation failure, repair, fallback, embedding failure, recall candidate
   count, revision rerun, and deadline exhaustion.
2. A documented causal trace: action → run → interaction/event →
   transmission/episode → evidence/belief/relationship, using safe IDs only.
3. `docs/014-phase-4-model-operations.md` (new): Bedrock/Titan configuration,
   seed embedding, prewarm, deterministic and live evals, cost modes, fallback
   testing, and the local two-browser memory proof.
4. The phase boundary is documented: no NPC-to-NPC transmission until Phase 5,
   and direct player→NPC memory is sufficient for this exit gate.

#### `P4-24` — Phase acceptance and evidence

**Depends on:** all prior Phase 4 tasks

**Acceptance**

1. Full run: `contracts`, `config`, `rules`, `model-runtime`, `api`, `database`,
   `web`, `runtime-shells`, prompt evals, e2e, typecheck, lint, build, bundle,
   CDK synth — i.e. `pnpm validate`.
2. Opt-in live Bedrock/Titan smoke against a seeded test town, recording version,
   cost, and latency metadata and no secret or raw output.
3. `e2e/phase-04-grounded-memory.spec.ts`: Player A confirms
   `bell_at_reeds_garden` to Mara and **stays** (`D4-P`); Player B asks Mara a
   relevant question and receives a response affected by the committed
   episode/belief; Player B shows `guard_cart_ruts`, producing deterministic
   belief and relationship change plus grounded dialogue; database inspection
   reconstructs claim, transmission, episode, evidence, belief, selected
   rendering, and model run while the `items` row for `festival_bell` is
   unchanged.

## 6. Commands

| Command | Purpose |
|---|---|
| `pnpm db:up && pnpm db:migrate` | Local CockroachDB for the DB-backed suites |
| `pnpm test:contracts` | Now also prompt text/hash drift (`P4-01`) |
| `pnpm test:model` *(new)* | `vitest run --project model-runtime` — adapters, validators, bundle, cost |
| `pnpm test:model:live` *(new)* | `TTR_MODEL_LIVE_TESTS=1 vitest run --project model-live` |
| `pnpm prompts:eval` *(new)* | `node scripts/prompts-eval.mjs` — deterministic fixtures |
| `pnpm prompts:eval:live` *(new)* | Same runner, live mode, documented cost |
| `pnpm model:prewarm` *(new)* | `node scripts/model-prewarm.mjs` — four warmup pairs |
| `pnpm embed:seed` *(new)* | `node scripts/embed-seed.mjs --town <id>` — resumable backfill |
| `pnpm test:db` | Now also recall, drafts, causality, cost ledger |
| `pnpm test:e2e` | Now also `phase-04-grounded-memory` |
| `pnpm validate` | Gains `pnpm test:model` and `pnpm prompts:eval`; **not** the live suites |

Per `CLAUDE.md`, iterate with `vitest run --project model-runtime` and single
`--project database` files; run `pnpm validate` once, at the end.

## 7. Goals

Phase 4 is complete when all of these hold.

| ID | Goal |
|---|---|
| `G1` | `packages/model-runtime` exists, has no database or `pg` dependency, and is the only package that imports an AWS SDK |
| `G2` | Prompt text, hashes, versions, schemas, and validators are executable and drift-tested against `docs/010` and `docs/schemas/` |
| `G3` | The authored dialogue corpus exists, is frozen per content version, and passes fallback-coverage and placeholder-safety validation |
| `G4` | Every Bedrock and Titan call uses an abort deadline derived from the 24-second budget, at most one transport retry, and never starts unless its worst case fits before the four-second reserve |
| `G5` | No model or embedding call happens inside a database transaction |
| `G6` | Every invocation is admitted by a committed cost reservation and settled or released exactly once; concurrent admissions cannot exceed a threshold |
| `G7` | Every run records model, profile, prompt, target prompt, hash, input/schema/validator versions, tokens, cache dimensions, latency, cost, validation code, and outcome — and never a prompt, raw output, or secret |
| `G8` | Vector recall is scoped by town **and** NPC, uses only `ready` embeddings, and produces the exact top-eight ranking with and without an embedding |
| `G9` | An embedding failure never loses, hides, or reorders an episode, and is retryable |
| `G10` | `ask` uses only authorized memories and disclosures and always terminates: selected, repaired, or authored |
| `G11` | `normalize_claim` creates either one bounded ten-minute draft or no effect at all; a failed repair stores the terminal `503` and requires a new key |
| `G12` | `tell` confirms a draft exactly once and persists claim, provenance, episode, evidence, and belief atomically |
| `G13` | `show`, `give`, and `accept_promise` are deterministic, transactional, repeat-protected, and reflected by grounded or authored dialogue |
| `G14` | Invalid, unavailable, timed-out, or injected model output cannot mutate any structured state |
| `G15` | A false claim changes belief memory without changing the `items` row |
| `G16` | Player views expose qualitative, attributed, player-safe state only |
| `G17` | Model-backed rate limits are transactional; a `429` consumes no key and creates no row |
| `G18` | A town-revision change reruns model work exactly once and marks the discarded output `superseded`; a second change is a saved retryable `409` |
| `G19` | Encounter, Tell, Show, Give, and Promise UI obey saved-before-shown and same-key recovery with keyboard and narrow-viewport coverage |
| `G20` | A repaired or fallback response is visually indistinguishable from a selected one |
| `G21` | Prompt evals, CockroachDB vector tests, HTTP tests, browser tests, security tests, typecheck, lint, and build pass; one opt-in live smoke has passed and is recorded |
| `G22` | Two browsers show that a committed direct NPC memory changes a later interaction with no ambient work and no `leave` |
| `G23` | With `TTR_ENABLE_NPC_MUTATIONS=false`, all six kinds are unavailable in the player view and return `422` |
| `G24` | `pnpm validate` passes end to end, including the global 80% statements/functions/lines and 70% branch coverage floor over `packages/model-runtime/src` and the new `game-server` modules |

## 8. Execution order and commit plan

Twenty-four plan tasks plus two inserted prerequisites; twenty-eight commits.
Four tasks carry a change to another package that deserves its own reviewable
diff.

| # | Commit | Task |
|---:|---|---|
| 1 | `feat(config): add the model-runtime configuration category` | `D4-C`, prerequisite of `P4-04` |
| 2 | `feat(model-contracts): check in the exact prompts and input contracts` | `P4-01` |
| 3 | `feat(content): author NPC voice profiles, aliases, and offers` | `P4-03a` (part 1) |
| 4 | `feat(content): author the rendering template and fallback corpus` | `P4-03a` (part 2) |
| 5 | `feat(rules): add the gate-result domain and plan-local effect handles` | `D4-K`, `D4-F`, prerequisite of `P4-03`/`P4-10` |
| 6 | `feat(model-runtime): scaffold trusted bundle and grounding types` | `P4-02` |
| 7 | `feat(model-runtime): add semantic validators and the fallback resolver` | `P4-03` |
| 8 | `feat(model-runtime): add bounded Bedrock adapters` | `P4-04` |
| 9 | `feat(model-runtime): add the price catalog and cost estimation` | `P4-05` (part 1) |
| 10 | `feat(game-server): persist model runs and enforce the cost ledger` | `P4-05` (part 2) |
| 11 | `feat(game-server): add model smoke and schema prewarm entry points` | `P4-06` |
| 12 | `feat(model-runtime): add the Titan embedding adapter` | `P4-07` (part 1) |
| 13 | `feat(game-server): add the episode embedding lifecycle and backfill` | `P4-07` (part 2) |
| 14 | `feat(game-server): add scoped vector recall and deterministic reranking` | `P4-08` |
| 15 | `feat(game-server): build NPC context and rendering candidates` | `P4-09` |
| 16 | `feat(game-server): extend the executor for outside-transaction model work` | `P4-10` |
| 17 | `feat(game-server): connect ask` | `P4-11` |
| 18 | `feat(game-server): connect normalize_claim and single-use drafts` | `P4-12` |
| 19 | `feat(rules): plan claim, provenance, and belief effects for tell` | §9.3, split from `P4-13` |
| 20 | `feat(game-server): connect tell` | `P4-13` |
| 21 | `feat(game-server): connect show` | `P4-14` |
| 22 | `feat(game-server): connect give` | `P4-15` |
| 23 | `feat(game-server): connect promise offers and accept_promise` | `P4-16` |
| 24 | `feat(game-server): complete causal persistence and player-safe projection` | `P4-17` |
| 25 | `feat(web): add the encounter route and Ask flow` | `P4-18` |
| 26 | `feat(web): add Tell interpretation and confirmation` | `P4-19` |
| 27 | `feat(web): add Show, Give, promise, and result UI` | `P4-20` |
| 28 | `test(prompts): gate prompt evaluations` | `P4-21` |
| 29 | `test(security): close the grounded loop's adversarial coverage` | `P4-22` |
| 30 | `feat(game-server): instrument and document the grounded loop` | `P4-23` |
| 31 | `test(e2e): run the grounded-memory acceptance suite` | `P4-24` |

Commits 1–5 are independent of each other. 6–11 are sequential. 12–15 depend on
8–10. 16 depends on 15. 17–23 are sequential on 16 but 19 must precede 20. The
browser trio 25–27 can begin as soon as 17 and 18 have landed. `pnpm validate`
must pass at every commit, which is why 5 and 19 (both `packages/rules` changes)
stand alone ahead of their consumers.

**Estimate.** The published range for Phase 4 is 15–22 engineer-days
([README](README.md)). `P4-03a` — authoring 140–200 rendering records, three
voice profiles, the alias set, and the validation that keeps them honest — is
new work no earlier phase produced and is not represented in that figure. Add
**3–5 engineer-days**, giving **18–27**. The rest of the range still holds:
§1.2 shows the recall formula, belief math, disclosure gating, planners, and
schema are already in place, which is what keeps this phase from being larger.

## 9. Discrepancies found while planning

### 9.1 The rendering-template corpus does not exist

The phase plan's prerequisite states that `bell-mystery-v1` contains *"NPC
profiles, disclosures, rendering templates, fallback matrix, item/promise
bindings, and seed memories."* Seed memories exist (`content/seed.ts`); the
rest do not. `AuthoredNpc` carries six fields and no voice rules;
`packages/content/src` contains no template, no fallback line, and no alias.
Decision 009 authors the fallback tables and the disclosure tier table in prose
but explicitly leaves the voiced alternatives to *"versioned authored
templates"* it does not write, and
`rules/content-validation/fallback-coverage.ts` says in its own header that
dialogue authoring is Phase 4/5's job.

This is the phase's largest content risk, because `P4-09`'s bundle and `P4-03`'s
resolver are both empty without it. `D4-I` and `P4-03a` resolve it by making the
corpus an explicit, separately reviewable task ahead of both, and by feeding the
already-written coverage engine its first real input.

### 9.2 `insertIds` cannot express a Phase 4 plan

`commit.ts#CommitEffectPlanParams.insertIds` is `Record<tableName, id>`, and its
own comment scopes it to *"the rare table whose id the caller must already know
before committing"*. A `tell` plan inserts one claim, one transmission (whose
`root_transmission_id` and `parent_transmission_id` may be itself or an existing
row), one episode, several `episode_references` pointing at that episode, and
several `belief_evidence` rows pointing at the claim. Two rows in one table, and
row-to-row references, are both unrepresentable today.

`D4-F` adds plan-local reference handles to `EffectPlanEntry` and resolves them
in `commitEffectPlan`. This is a `packages/rules` change and therefore its own
commit (#5), like Phase 3's `D3-I`.

### 9.3 The model-backed planners plan almost none of their effects

`rules/actions/model-backed.ts` is complete for authority checking and for the
effects that do not depend on the model: `planShow` plans `belief_evidence`,
`npc_beliefs`, and `relationship_changes`; `planGive` plans custody and reward;
`planAcceptPromise` plans the promise row. But `planTell` plans exactly one
effect — an `event_origin` for `claim_transmitted` — and no claim, relation,
draft confirmation, transmission, episode, or evidence row. `planAsk` and
`planNormalizeClaim` plan none at all.

Two distinct gaps follow. First, `planTell`'s deterministic half is genuinely
missing and must be completed in `packages/rules` (commit #19). Second, the
effects that depend on *which renderings were selected* — the NPC→player
transmissions in rendering order, the interaction row, the NPC's episode — have
no home in the current shape, because a planner runs before the model. `D4-E`
adds a second pure stage, `applyDialogueSelection*`, so those effects are still
decided by `packages/rules` from a *validated* selection rather than by
orchestration code reading model output.

### 9.4 `503 MODEL_UNAVAILABLE_RETRY_ACTION` still has no writer

Phase 3's own §9.7 recorded that this response was unreachable. It remains so:
`persistence/actions.ts` exports `claimAction`, `runCompleteActionUpdate`,
`completeAction`, `readActionForPlayer`, and `storeRetryableConflict`, and
`completeAction` writes a `200` completed envelope. There is no way to store a
`failed` action with a saved problem body. `D4-O` adds `storeTerminalFailure`,
used only by `P4-12`.

### 9.5 `agent_runs.inference_profile` is `NOT NULL`

Decision 010 treats the inference profile as optional deployment configuration
(*"the resolved Bedrock model ID **or** inference-profile ARN"*), but
`0008_operations_ledger.sql` declares both `model` and `inference_profile` as
`STRING NOT NULL`. A deployment using a bare model ID must still write
something. `D4-N` records the resolved ARN when configured and the resolved
model ID otherwise, and rejects the empty string, so the column is never a
silent lie.

### 9.6 Reservation uniqueness forces an attempt-ordinal scheme

`uq_model_cost_reservations__player_action` is
`(player_action_id, purpose, attempt_ordinal)`. One `ask` can legitimately make
a dialogue call, a transport retry, a repair, and then — after a revision rerun
— all three again. Without a defined allocation, the second attempt collides
with the first. `D4-N` fixes the ordinal sequence and makes it a property of the
attempt loop rather than of the call site.

### 9.7 The contract-version check constraint splits the telemetry writer

`ck_agent_runs__contract_versions` requires `prompt_sha256`,
`task_input_version`, `output_schema_version`, and `validation_policy_version`
to be **all null** for `episode_embedding`/`query_embedding` and **all non-null**
for every other purpose. A single generic `appendRun` that always writes the
four columns fails on embeddings, and one that always omits them fails on
dialogue. `P4-05`'s writer branches on purpose, and its tests assert both
directions against the live constraint rather than in application code alone.

### 9.8 A Phase 4 `tell` makes the next `leave` fail

Phase 3's `leave` deliberately treats an eligible ambient event in the departure
range as an explicit `500` rather than a fake `waiting`
(`application/actions/inputs/leave.ts`, Phase 3 `G19`). `tell` writes a
`claim_transmitted` event and evidentiary `show` writes `evidence_shown`; both
are ambient-eligible. So in any Phase 4 build, a player who tells an NPC
anything and then leaves gets a `500`.

The phase plan already acknowledges the state (*"Tell and evidentiary Show can
create ambient-eligible events, while the accepted eligible-range Leave path is
not complete until Phase 5"*), but it does not say what that means for the
acceptance journey it also specifies. `D4-P` makes it explicit: the `P4-24`
two-browser proof uses concurrent presence rather than departure, and the
integration profile's documentation states that `leave` after a mutation is a
known Phase 5 gap rather than a regression. `D4-R`'s capability flag is what
keeps that state out of any shared environment.
