# `@the-town-remembers/rules`

The deterministic simulation core: every belief, relationship, disclosure,
world-state, recall, ambient, board, and action rule Decision 008 (and the
decisions it depends on — 005, 006, 009, 010, 011) fixes for
`mvp-rules-v1`. This package has no database client, no HTTP server, no
model client, and no queue — it is pure functions over plain data, built and
tested entirely offline. See
[`../../implementation-plans/phase-02-deterministic-simulation-core.md`](../../implementation-plans/phase-02-deterministic-simulation-core.md)
for the full plan this package implements; this README is the
implementer-facing summary a later phase actually needs.

## Authority boundary and the pure-input/effect-plan pattern

Every rule function is a pure function: `(inputs) => output`, never
`(inputs, dbClient) => Promise<output>`. Concretely:

- **Inputs** are one of the four shapes in `kernel/inputs.ts`
  (`CanonicalTownSnapshot`, `WorldEventHistory`, `NpcScopedKnowledge`,
  `PlayerSafePresentationInputs`) or a narrower, task-specific shape built
  from them. All are `readonly`-typed, and a caller that wants the runtime
  guarantee to match the type must freeze what it passes in — this package
  never mutates its own inputs, but it also does not defend against a caller
  handing it a value another concurrent call is still writing to.
- **Time and identity** are never read directly. A rule that needs "now" or
  a new ID takes a `Clock`/`IdentitySource` (`kernel/identity.ts`) as an
  explicit parameter. `kernel/determinism.test.ts` greps every non-test file
  in this package for `Date.now(`, `crypto.randomUUID(`, and `process.env`
  and fails the build if it finds one.
- **Outputs** are a `DecisionResult<TEffect>` (`kernel/decision.ts`) — an
  `outcome`, a `reasonCode`, an ordered `effects: readonly TEffect[]`
  (`kernel/effects.ts`: inserts, conditional state changes, and event-origin
  metadata — never a SQL statement or a Kysely query object), a
  `preconditions` block the caller re-checks at commit time, and a `trace`
  (`kernel/trace.ts`, inspection-only — see below) — or, for the six
  model-backed action kinds, an `external_selection_required` marker
  carrying a bounded `ApprovedDisclosureBundle` instead.

Nothing in this package commits anything. A caller loads state, calls a
planner, and is responsible for persisting the returned effects — see
[Handoff examples](#handoff-examples-for-phase-345) below.

## Adding a new rules or content version

`RULES_REGISTRY.rulesVersion` (`kernel/version.ts`) is `"mvp-rules-v1"`,
frozen. A town's `towns.content_version` pins it to the content *and* rules
version it was seeded under (Decision 008) — an existing town never
silently starts running under a newer version's numbers.

To add a new rules version without touching an existing town:

1. Add a new content registry entry in `packages/content` (a new
   `contentVersion` string, e.g. `"bell-mystery-v2"`), with its own
   `rulesVersion` field.
2. Do not edit `RULES_REGISTRY` in place if the new version's numbers
   differ from `mvp-rules-v1`'s. Instead, this package's kernel constants
   (`RULES_REGISTRY`) are versioned as a whole: a genuinely different rules
   version needs its own registry object and its own dispatch wiring,
   selected by `content.rulesVersion` at the call site — never a runtime
   branch inside a shared function on "which version is this."
3. `kernel/numeric.ts#assertCompatibleVersions(contentVersion, rulesVersion)`
   is the fail-closed check: it looks up the content registry by the town's
   stored `content_version` and throws `ContentVersionMismatchError` if that
   content's own `rulesVersion` does not match what the caller expected,
   rather than silently running a town's history under the wrong version's
   formulas.
4. Never change an already-shipped `RULES_REGISTRY` numeric value. If a
   balance number was wrong, that is a new rules version, not a hotfix —
   existing towns keep resolving under the version they were seeded with.

## The five-step action order

Every one of the 13 `ACTION_KINDS` (`actions/dispatcher.ts`) follows the
same order, split between this package (steps 1–3) and the caller (steps
4–5):

1. **Validate** authority, location, custody, and the pre-action snapshot.
   A failure here is `denied` and stops the plan.
2. **Calculate** deterministic evidence/relationship deltas from that one
   pre-action snapshot (`kernel/numeric.ts#sumEventContributions`: summed
   by target, clamped once — never clamped per contribution).
3. **Derive** disclosure/item/capability/promise-offer/progression gates
   against the *post-action* state (after step 2's deltas are applied on
   paper, not yet committed).
4. *(Caller)* For the seven deterministic action kinds
   (`DETERMINISTIC_ACTION_KINDS`), step 3's `DecisionResult` is already
   terminal. For the six model-backed kinds (`MODEL_BACKED_ACTION_KINDS`),
   the caller hands the model only the bounded `ApprovedDisclosureBundle`
   this package built, and resumes with either a validated result or an
   authored fallback — this package never calls a model itself
   (`actions/dispatcher.ts#resumeWithDialogue`).
5. *(Caller)* Validate the rendered response and commit effects + gate
   result + response atomically against the same town revision. A failed
   revision check discards the *entire* predicted bundle from step 3, not a
   partial subset — a `Show` that crossed trust 40 and predicted an
   unlocked promise offer loses that offer too if the commit fails.

## Stable-ordering catalog (`kernel/ordering.ts`)

One named comparator per documented tie-break rule, each a total order over
its shape (no two legally-distinct rows compare equal), implemented once
and reused everywhere it applies:

| Comparator | Used for | Order |
|---|---|---|
| `compareRecallAnchors` | Recall candidate pool (`recall/scoring.ts`) | importance desc, `occurred_at` desc, episode ID asc |
| `compareRecallResults` | Final recall ranking | recall score desc, `occurred_at` desc, episode ID asc |
| `compareAmbientCandidates` | Ambient shortlist (`ambient/eligibility.ts`) | priority desc, normalized claim key, speaker ID, recipient ID |
| `compareByMapOrder` | `PlayerView.map` | authored `(mapOrder, id)` |
| `compareByNormalizedNameThenId` | `inspectables`/`encounters`/`inventory`/`discoveredClues` | normalized display name, then ID |
| `compareByDiscoverySequenceThenPlayerId` | A clue's `contributors` | discovery sequence, then player ID |
| `compareByAcceptedAtThenId` | `activePromises` | `(acceptedAt, promiseId)` |
| `compareByCreatedAtThenId` | `caseBoard`, `caseAttempts` | `(createdAt, id)` |
| `compareByPair` | `caseBoardContradictions` | `(firstEntryId, secondEntryId)` |
| `compareByAuthoredOrder` | Accusation options (suspects/motives/locations) | frozen authored order, then ID |
| `compareResolutionChoices` | Resolution `choices` | `expose_cover_up` before `restore_bell_quietly` |

## External-selection seam catalog

Exactly `http-contracts#MODEL_BACKED_ACTION_KINDS` — `ask`,
`normalize_claim`, `tell`, `show`, `give`, `accept_promise`
(`actions/model-backed.ts`) — return
`{ kind: "external_selection_required", effects, trustedContext, trace }`
instead of a terminal result. `trustedContext` is always an
`ApprovedDisclosureBundle` (`disclosure/bundle.ts`), the exact
`trusted_context` shape Decision 010 names for `npc_dialogue_v1`:

- `approvedDisclosures` — claim ID, belief/hearsay stance, source episode or
  parent transmission, disclosure tier, permitted entity IDs.
- `requiredDisclosureIds` — never more than four.
- `approvedOutcomes` / `requiredOutcomeIds` — never more than three
  required.
- `approvedEpisodes` — spoiler-safe summaries only.

Membership in a tier (`disclosure/tiers.ts#meetsDisclosureTier`) and the
belief/contestation gate (`beliefs/labels.ts#isSelectedBelief`) are
independent, both-required checks for an ordinary claim; a direct
observation or reported claim bypasses only the belief gate.

The ambient equivalent is `ambient/selection.ts#planAmbientSelections`,
which accepts an already schema-validated `AmbientChoiceV1` and validates it
semantically — six named failure modes, each degrading only its own
selection to `do_nothing`.

## Trace-field catalog (`kernel/trace.ts`)

A `RuleTrace` is inspection-only. Its field names are structurally disjoint
from every player-facing type's field names (`trace.test.ts` proves this
the same way `packages/http-contracts/src/leakage.test.ts` proves the
reverse direction), so a future accidental `{ ...trace }` spread into a
response body shows up as a duplicate-key type error, not a silent leak.

| Field | Contents | Player-visible? |
|---|---|---|
| `rulesVersion` | The `RULES_REGISTRY.rulesVersion` this trace was produced under | No |
| `ruleName` | A stable dotted name, e.g. `"actions.show"` | No |
| `matchedStableKeys` | Authored or canonical keys the rule matched against — never a raw UUID alone | No |
| `evaluatedInputs` | Named inputs the rule consulted, for operator inspection | No |
| `matchedReasonCode` | The `ReasonCode` this trace explains | No |

The player-visible reason code lives on `DecisionResult.reasonCode`
directly (passed unchanged into `DeniedActionResult.reasonCode` — `D2-K`),
not inside the trace.

## Handoff examples for Phase 3/4/5

The five-step order from the caller's side, restated concretely:

```ts
// 1-3: load state, call a pure planner.
const snapshot = await loadCanonicalTownSnapshot(townId); // Phase 3's job
const plan = planShow(buildShowInputs(snapshot, request));

// 4: resume the external-selection seam, if any.
const result = isExternalSelectionRequired(plan)
  ? resumeWithDialogue(plan, await selectDialogue(plan.trustedContext)) // Phase 4's job
  : plan;

// 5: validate the rendered response and commit atomically against the
//    same town revision the snapshot was read at. A revision mismatch
//    discards the whole plan, including anything step 3 predicted.
await commitEffectsAtRevision(townId, snapshot.town.revision, result.effects); // Phase 3's job
```

For the ambient worker (Phase 5): build a shortlist with
`ambient/eligibility.ts#buildAmbientShortlist`, send it to the model as
`ambient_choice_v1` candidates, then validate the returned choice with
`ambient/selection.ts#planAmbientSelections` before committing — the same
pattern, one call instead of a per-action dispatch.

`testing/scenario-runner.ts` and `scripts/rules-scenario.mjs` (run
`pnpm rules:scenario [<scenario-name>]`) show this pattern end to end for
five golden scenarios, entirely offline.
