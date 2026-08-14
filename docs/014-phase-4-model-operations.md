# Phase 4 model operations

- **Project:** The Town Remembers
- **Status:** Accepted
- **Date:** 2026-08-14
- **Scope:** How to configure, warm, evaluate, and operate the Bedrock/Titan
  model layer Phase 4 adds; the causal trace an operator or judge can
  reconstruct from a completed action; and the exact Phase 4/Phase 5
  boundary (`P4-23`).

## 1. Bedrock/Titan configuration

`packages/runtime-config/src/model.ts#loadModelConfig` reads these
environment variables (all required except the two inference-profile ARNs):

| Variable | Purpose |
|---|---|
| `TTR_AWS_REGION` | Region for both the Bedrock Converse client and the Titan embed client. |
| `TTR_BEDROCK_HAIKU_MODEL_ID` | Resolved model ID used for Haiku-role calls (dialogue under reduced-cost mode; claim normalization; ambient choice; structured repair). |
| `TTR_BEDROCK_SONNET_MODEL_ID` | Resolved model ID used for Sonnet-role calls (dialogue in normal cost mode). |
| `TTR_BEDROCK_TITAN_MODEL_ID` | Titan embedding model ID (episode and query embeddings). |
| `TTR_BEDROCK_HAIKU_INFERENCE_PROFILE_ARN` | Optional — when set, the ARN is used instead of the raw Haiku model ID (`bedrock/model-resolution.ts`). |
| `TTR_BEDROCK_SONNET_INFERENCE_PROFILE_ARN` | Optional — same, for Sonnet. |

`agent_runs.inference_profile` (`D4-N`) always records whichever of the two —
ARN or resolved model ID — was actually used for that call, never the empty
string.

Local development picks up the `.env` defaults `scripts/local-env.mjs`
applies; every script in this section (`embed:seed`, `model:prewarm`,
`prompts:eval:live`) calls `applyLocalDefaults()` first, matching the
pattern `pnpm db:up` already uses for CockroachDB.

## 2. Seed embedding

```bash
pnpm embed:seed <contentVersion> [townId]
```

Resumable backfill of `episodes.embedding`/`embedding_status` for one content
version (every eligible town) or one town. `contentVersion` is required and
never defaulted, so a bare invocation cannot silently scan the whole
database. Safe to kill and rerun at any point — `attemptOrdinalCount`
(`application/commands/embed-seed.ts`) makes each attempt idempotent per
`world_event_id`. Needs real AWS credentials and `pnpm db:up` running (it
writes real `episodes`/`agent_runs`/`model_cost_reservations` rows).

## 3. Prewarm

```bash
pnpm model:prewarm
```

Runs all four `WARMUP_PAIRS` (`model-contracts/src/versions.ts`) — the
`(model role, schema)` combinations Bedrock's own structured-output grammar
compilation needs kept warm, since a cold compile can take minutes and
cannot fit inside the 24-second application budget:

| Model role | Schema |
|---|---|
| `haiku` | `claim_normalization_v1` |
| `haiku` | `ambient_choice_v1` |
| `haiku` | `npc_dialogue_v1` |
| `sonnet` | `npc_dialogue_v1` |

Writes no database row of any kind (no player action, no town) — it calls
`runPrewarmCommand` directly against a real Bedrock client with no HTTP
route in between. `WARMUP_INTERVAL_HOURS` (20) is how often a scheduled
prewarm should run in a real deployment; Phase 4 does not wire that
scheduler itself.

## 4. Deterministic and live prompt evaluations

```bash
pnpm prompts:eval          # deterministic, no Bedrock call, always in `pnpm validate`
pnpm prompts:eval:live     # adds the four-pair warmup smoke above
```

`scripts/prompts-eval.mjs` (`P4-21`) runs every fixture under
`evals/phase-04/{normalization,dialogue,repair}/*.json` — every
control/known-failure/injection/boundary cell in Decision 010's evaluation
table except ambient choice (Phase 5 scope, see §6) — through the real
`model-runtime` semantic validators. No network call, no cost, deterministic
by construction. `evals/phase-04/baseline.json` pins each fixture's
pass/fail to the prompt/schema/validator versions in effect;
`--update-baseline` refuses while any fixture is failing, and a fixture that
regressed (passed in the baseline, fails now) always fails the run even
under `--update-baseline`.

`prompts:eval:live` (`TTR_PROMPTS_EVAL_LIVE=1`) additionally runs the same
four-pair warmup smoke §3 describes, after the deterministic fixtures pass.
Expected cost is well under $0.01 total — four small structured-output
calls at Haiku/Sonnet rates (`packages/model-runtime/src/cost/price-catalog.ts`),
each capped at a few hundred output tokens. Needs the same AWS credentials
`model:prewarm` does.

Haiku dialogue (reduced-cost mode, §5) is gated on this same baseline: since
structural/semantic validation is model-agnostic, "Haiku passes the same
suite" means the baseline's `dialogue` family carries no failure —
`scripts/prompts-eval.mjs#reducedCostDialogueAllowed` is the pure function
that checks this, covered by `scripts/prompts-eval.test.mjs`. There is no
separate Haiku-specific fixture set to maintain.

`pnpm test:model` (`vitest run --project model-runtime`) and
`pnpm test:model:live` (`TTR_MODEL_LIVE_TESTS=1 vitest run --project
model-live`) are the adapter/unit-level counterparts — `test:model` is
already part of the full `pnpm test` coverage run; `pnpm validate` also runs
it and `prompts:eval` explicitly, for a gate a reader can point at without
tracing through `vitest.config.ts`'s project list.

## 5. Cost modes

`packages/model-runtime/src/cost/mode.ts` (Decision 004's monthly-spend
ladder):

| Mode | Threshold | Effect |
|---|---|---|
| `normal` | below $8.00 | Sonnet dialogue; every model call admitted. |
| `reduced_cost` | ≥ $8.00 | Dialogue switches to Haiku; every other model call still admitted. |
| `tighten` | ≥ $9.50 | Same as `reduced_cost`, plus an operator-facing "stop new towns" signal (`shouldStopNewTowns`) — not enforced by this package itself. |
| `fallback_only` | ≥ $10.35 (hard cap) | No model call is admitted at all; every model-backed action uses its authored fallback. |

`monthlySpendMicroUsd` passed into `resolveCostMode` must already include the
current call's own worst-case reservation — admission checks the state a
commit would produce, not the state before it. `recordModelCostAdmission`
(§7) emits one metric per admission decision, segmented by purpose and mode.

## 6. Fallback testing

`content/dialogue/fallbacks.ts`'s `GENERIC_ACTION_FALLBACKS` (and any
NPC-specific lines) are the authored last resort when both selection and
repair fail. `assertFallbackCoverage`/`checkFallbackCoverage`
(`model-runtime/src/bundle/fallback.ts`) run a caller-supplied requirement
matrix against this content at startup — a line is missing content, not a
runtime bug, when this fails. `resolveFallbackLine` finds the exact
`(npcKey, actionKind, responseKind, gateResult)` match whose `outcomeIds` is
a superset of what's required; `evals/phase-04/repair/boundary.json`'s
`r-boundary-unrepairable-dialogue-falls-back`/`r-boundary-second-failure-falls-back-no-match`
fixtures exercise both the covered and uncovered case against the real
`bell-mystery-v1` content registry, and
`security/model-memory.db.test.ts` proves end to end that a hostile/injected
model output, once both its original and repair attempts are rejected,
produces only this authored text — byte-identical to the non-hostile
fallback case, with the injected content nowhere in the response or in any
persisted row (`P4-22`).

## 7. Metrics: purpose, model, and outcome

`packages/game-server/src/observability/metrics.ts`. Every function
validates its closed-set dimensions at runtime (`metrics.test.ts`) before
emitting a `metric_*` structured-log line (`events.ts`) — the same safe
stdout channel `security/log-redaction.test.ts` already covers, so no metric
needs its own separate leak check.

| Dimension (Decision 010 gate / `P4-23` acceptance 1) | Where it lives |
|---|---|
| Latency, tokens, cost — segmented by purpose and model | `recordModelRun({ purpose, model, outcome, latencyMs, estimatedCostMicroUsd, inputTokens, outputTokens, validationErrorCode })`, called once per resolved attempt from `persistence/model-runs.ts#logRunRecorded` — the single choke point every model-backed action's `appendRun` call already passes through. |
| Validation failure | `recordModelRun`'s own `validationErrorCode` field — one of the eighteen `REPAIR_VALIDATION_ERROR_CODES`, `null` on an accepted attempt. Never the raw rejected output (`P4-22` acceptance 4). |
| Repair, fallback | Values of `recordModelRun`'s own `outcome` (`AGENT_RUN_OUTCOMES`: `accepted`/`repaired`/`rejected`/`fallback`/`failed`/`superseded`) — segmenting by outcome *is* segmenting by repair/fallback rate; no separate metric exists for either. |
| Embedding failure | The same `recordModelRun` choke point, for `purpose ∈ {episode_embedding, query_embedding}` with `outcome: "failed"` — embeddings flow through the identical recording path as every structured call, so no dedicated embedding metric exists either. |
| Recall candidate count | `recordRecallCandidates({ vectorCandidateCount, anchorCandidateCount, rankedCandidateCount, embeddingAvailable })`, called once per `ask` from `application/actions/inputs/ask.ts` right after `rankRecallCandidates` resolves. Counts only — never an episode ID or its summary. |
| Revision rerun | `recordActionProcessing`'s existing `conflicts` field (`P3-18`) — one full model-backed action attempt is rerun (a fresh model call and all) each time `application/actions/model-executor.ts`'s `runClaimedModelAction` loop hits `RevisionConflictError`/a superseded pre/post revision compare and `continue`s (module doc: "One rerun after the first revision loss"); `attempt`/`conflicts` on the terminal `action_lifecycle`/`metric_action_processing` events is that count. No separate metric exists because this is already a first-class dimension of the existing action-processing metric. |
| Deadline exhaustion | `recordActionProcessingExhausted(actionKind)` (`P3-18`) at the action level; a model call that cannot finish inside its own remaining budget surfaces as a transport failure through the identical `outcome: "failed"` path `recordModelRun` already covers — `bedrock/deadline.ts#fitsBeforeReserve` is the admission arithmetic underneath, not a separately-metered event. |

Every `recordX` function's parameters are already closed-enum-typed at
compile time; the runtime `assertMember` check inside each one is defense in
depth against a value that reached the call site through an `as`-widened
type instead of a real one (`P3-18` acceptance 2).

## 8. Causal trace: action → run → interaction/event → transmission/episode → evidence/belief/relationship

Every step below joins on an ID a player, an operator, or a judge can
already see or that `persistence/inspection.ts` already exposes — never a
hidden score, an exact belief value, or a raw database row beyond what that
module deliberately surfaces.

1. **Action.** `player_actions.id` — the idempotent request a player made.
2. **Run.** `agent_runs.player_action_id = player_actions.id`. Zero, one
   (accepted), or several rows (a rejected original plus its one repair
   attempt, `security/model-memory.db.test.ts`'s own fixture shape) — never
   the prompt or raw output, only identity, versions, and measures
   (`model-runs.ts#AppendRunParams`).
3. **Interaction/event.** `npc_interactions.player_action_id =
   player_actions.id`, joined to its causal `world_events` row via
   `npc_interactions.event_id`. `persistence/inspection.ts#readInspectedInteraction`
   is the one function that reconstructs this step — the exact NPC text the
   player saw, the response mode, and the event's `sequence_no` — reachable
   only from operator/judge tooling, never from `http/router.ts` or the
   player-facing view builder (`P4-17`).
4. **Transmission/episode.** From the same interaction, `claim_transmissions.interaction_id`
   joined to `inspection.claim_paths` (already inside
   `readInspectedInteraction`'s second query) gives every claim transmission
   that turn produced, in real speaking order, each with its `hop_count` and
   `root_transmission_id` — the provenance root a hearsay chain traces back
   to. `episodes.event_id = world_events.id` is the parallel join for the
   episode(s) that same event created, scoped by `(town_id, npc_id)` exactly
   like every other Phase 4 read (`security/model-memory.db.test.ts`'s
   cross-tenant/cross-npc isolation proofs).
5. **Evidence/belief/relationship.** `npc_beliefs.updated_event_id` and
   `npc_player_relationships.updated_event_id` (the latter has no
   auto-backfill default — every planner that touches it must pass the
   plan's own event id explicitly), and `promises.accepted_event_id`/
   `resolved_event_id`, all point back to the
   same `world_events.id` from step 3 — the deterministic state change one
   accepted action caused, reconstructable without ever reading a raw score.

`e2e/phase-04-grounded-memory.spec.ts` (`P4-24`) is the automated version of
walking this exact chain for a real two-browser journey.

## 9. The local two-browser memory proof

The manual/judge-facing version of §1's objective (`implementation-plans/
phase-04-grounded-npc-and-memory-loop.md` §1): open the same town in two
browser profiles (or one normal + one private window), each joined as a
different player.

1. **Player A** confirms a claim to an NPC (Tell) and **stays in town**
   (`D4-P` — Phase 4 never calls `leave` after a mutation; the eligible-range
   Leave path is Phase 5).
2. Once that action's response has returned (confirming the commit landed),
   **Player B** asks the same NPC a relevant question in their own browser
   and receives a response selected from a bundle now affected by the
   episode/belief Player A's action just committed.
3. Player B shows a verified clue (Show), producing a deterministic
   belief/relationship change plus a grounded response.
4. Using `persistence/inspection.ts#readInspectedInteraction` (or the raw
   SQL it wraps) against either action's `player_action_id`, reconstruct the
   claim, transmission, episode, evidence, current belief, selected
   rendering, and model run per §8 — while confirming the authoritative
   `items` row for the claim's subject (e.g. `festival_bell`) is unchanged,
   proving a false or unverified claim never touched real state.

This proof runs in an isolated integration environment and is not itself a
player release — Phase 4 and Phase 5 share one player-facing release gate
(§10).

## 10. The Phase 4/5 boundary

Phase 4 owns live Bedrock dialogue, claim normalization, Titan embeddings,
and vector recall — direct player→NPC memory only. **No NPC-to-NPC
transmission exists until Phase 5**: nothing in this codebase propagates a
claim between two NPCs, or lets an NPC's own belief update from anything
other than a direct player action against that NPC. Tell and evidentiary
Show can create ambient-eligible events (rows a future ambient tick could
consume), but nothing in Phase 4 consumes them — the eligible-range `leave`
path itself remains Phase 3's explicit `500` until Phase 5 (`D4-P`).

Direct player→NPC memory (§8's causal trace, proven end to end by §9's
two-browser journey) is sufficient for Phase 4's own exit gate
(`P4-24`) — ambient propagation, NPC-to-NPC rumor spread, and the canonical
two-browser *rumor* proof (as opposed to this phase's two-browser *memory*
proof) are Phase 5's acceptance criteria, not this phase's.

## References

- [Decision 010: Bedrock Prompt and Structured-Output Contracts](010-bedrock-prompt-contracts.md)
- [Decision 004: Infrastructure Cost Estimate](004-infrastructure-cost-estimate.md)
- [Phase 4 — Grounded NPC and Memory Loop](../implementation-plans/phase-04-grounded-npc-and-memory-loop.md)
- [Phase 4 execution detail](../implementation-plans/phase-04-execution-detail.md)
