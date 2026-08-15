# Validate Performance and Test Rationalization

- **Project:** The Town Remembers
- **Status:** Proposed implementation plan
- **Date:** 2026-08-15
- **Scope:** Make `pnpm validate` materially faster while preserving the
  repository's accepted deterministic, database, security, model-grounding,
  browser, and release guarantees.
- **Primary outcome:** Each required behavior is proved once at the cheapest
  correct boundary, and expensive infrastructure setup is reused safely.

## 1. Objective

Reduce the wall-clock time and flake surface of `pnpm validate` without lowering
coverage thresholds, replacing real CockroachDB checks with mocks, weakening a
security invariant, adding retries, or deleting a boundary test merely because
it is expensive.

The completed work must make these statements true:

1. the model-runtime Vitest project executes once per validation run;
2. each checked-in prompt-evaluation fixture executes once per validation run;
3. ordinary database integration files do not each create and migrate a new
   database;
4. schema/grant/migration tests retain isolated real-database coverage;
5. source scans contain no per-file tests whose assertion body examines zero
   relevant call sites;
6. browser journeys cover browser-only integration behavior rather than repeat
   component or HTTP-adapter assertions unchanged; and
7. a repeatable timing report demonstrates the improvement on a clean machine.

## 2. Grounding and measured baseline

### 2.1 Current validation topology

`package.json#validate` currently runs, in order:

1. formatting, source-text, workspace-boundary, and asset checks;
2. TypeScript checks, tooling tests, and ESLint;
3. the full covered Vitest workspace, including the database project;
4. the model-runtime project a second time;
5. deterministic prompt evaluation;
6. build, bundle inspection, CDK synthesis, and Playwright.

The collected Vitest inventory is:

| Project | Named cases |
|---|---:|
| `rules` | 665 |
| `database` | 448 |
| `api` | 274 |
| `contracts` | 221 |
| `model-runtime` | 203 |
| `config` | 159 |
| `web` | 130 |
| `runtime-shells` | 68 |
| **Total in `pnpm test`** | **2,168** |

Outside that run, validation executes 89 Node tooling tests, the same 203 model
tests again, 53 prompt fixtures, and 14 Playwright cases.

The count alone is not the bottleneck. Most rules cases complete in 0–3 ms. The
largest cost multiplier is database lifecycle setup.

### 2.2 Confirmed duplication and setup costs

- `pnpm test` includes `model-runtime`; the later `pnpm test:model` is an exact
  repeat of 203 cases. A targeted repeat took 5.78 seconds during the audit.
- `scripts/prompts-eval.test.mjs` calls `evaluateAll()` twice, and
  `pnpm prompts:eval` calls it a third time. The same 53 fixtures therefore run
  three times per validation.
- Forty-nine database test files declare 53
  `createDisposableDatabase()` calls. The helper creates a database and applies
  every migration by default.
- Six files in the `database` project never call
  `createDisposableDatabase()` and contain 63 pure or mocked cases. They are
  nevertheless serialized behind the real-database project:
  - `packages/database/src/domains.test.ts`;
  - `packages/database/src/runtime.test.ts`;
  - `packages/database/src/schema.test.ts`;
  - `packages/database/src/transaction.test.ts`;
  - `packages/database-admin/src/introspection.test.ts`; and
  - `packages/database-admin/src/operator-client.test.ts`.
- `infrastructure/src/foundation-stack.test.ts` synthesizes a fresh CDK app for
  nearly every assertion, approximately eight syntheses for eight cases.
- `no-network-in-transaction.test.ts` emits one test for 55 source files, but
  only 11 of those files contain a `runSerializable(` call. Forty-four cases
  currently pass over an empty callback list.

### 2.3 Baseline measurement constraint

The audit found another Vitest process already running database files against
the same local CockroachDB node. Under that contention, a representative
three-case database file timed out after 180 seconds before reaching an
assertion. That is evidence of missing inter-process isolation, not a clean
baseline.

Task `VPR-01` must therefore capture a new baseline only when:

- no other Vitest, Playwright, migration, or seed process is using the local
  node;
- CockroachDB reports healthy before the run;
- the pinned Node.js and pnpm versions are active; and
- cold and warm runs are recorded separately.

## 3. Non-negotiable constraints

1. Keep real CockroachDB coverage for composite foreign keys, partial indexes,
   vector behavior, grants, serialization, concurrency, and cross-town
   isolation.
2. Preserve the coverage thresholds in `vitest.config.ts`: 90% statements,
   functions, and lines; 88% branches.
3. Do not add retries to make a flaky foundation gate pass.
4. Preserve failure locality. Consolidated checks must report every offending
   file/case, not only the first failure.
5. Keep the targeted developer commands (`test:model`, `test:db`,
   `prompts:eval`, and individual Playwright specs) even when validation no
   longer invokes a redundant command.
6. Keep the Phase 3 and Phase 4 full browser journeys. They prove persistence
   and cross-layer behavior that component tests cannot.
7. Keep database tests serial until shared-state cleanup has been proved
   deterministic. Faster parallel execution is a later, separately measured
   option.
8. Do not mix this work with gameplay, schema, API, prompt, or visual changes.

## 4. Ordered implementation workstreams

### Workstream A — Establish a trustworthy performance loop

#### VPR-01 — Add stage-level validation profiling

**Work**

- Add a no-dependency profiling entry point, `scripts/validate-profile.mjs`,
  that invokes the same stages as `pnpm validate`, records monotonic elapsed
  time and exit status per stage, preserves fail-fast behavior, and emits a
  machine-readable JSON summary plus a concise terminal table.
- Add `pnpm validate:profile`; do not replace `pnpm validate` in this task.
- Detect another active local database test owner before starting the database
  stage and fail with an actionable diagnostic rather than measuring a
  contended run.
- Record three cold and three warm runs on the pinned toolchain. Use the median
  of each set as the baseline.

**Acceptance**

- The profiler returns the same nonzero status as the first failing stage.
- It forwards output without exposing environment values or credentials.
- A JSON result names every stage, duration, and status.
- Baseline results are checked into this plan's implementation PR description
  or an adjacent sanitized report, not hard-coded as universal budgets.

#### VPR-02 — Add safe database-suite ownership

**Work**

- Add an inter-process ownership mechanism around local CockroachDB integration
  runs. Prefer an atomic lock file containing PID, start time, command kind, and
  a random run ID.
- Treat a dead owner as stale only after verifying the PID is absent. Never
  delete a live owner's lock.
- Ensure `test:db`, the database stage inside `pnpm test`, and Playwright's
  database setup either coordinate through the lock or use explicitly distinct
  run identities.
- Print the current owner and elapsed time when a second run is refused.

**Acceptance**

- Two database suites cannot silently migrate concurrently on the same local
  node.
- A crashed suite does not permanently block later runs.
- CI remains noninteractive and cleans ownership in `finally`/global teardown.

### Workstream B — Remove exact validation-stage duplication

#### VPR-03 — Execute model-runtime tests once

**Work**

- Remove `pnpm test:model` from the `validate` chain because `pnpm test`
  already includes the `model-runtime` Vitest project.
- Retain the `test:model` script for focused development and documentation.
- Add a configuration test that proves `model-runtime` remains a member of the
  full Vitest project list, so a future config edit cannot silently remove the
  coverage that justified this change.

**Acceptance**

- `validate` contains no second model-runtime invocation.
- `pnpm test:model` still passes independently.
- The full covered test run still reports all 203 current model-runtime cases,
  subject to later legitimate test changes.

#### VPR-04 — Execute prompt fixtures once

**Work**

- Keep `pnpm prompts:eval` as the named validation/release gate.
- Move corpus-shape assertions—nonempty families and required category cells—
  into the prompt runner's own single evaluation result.
- Change `scripts/prompts-eval.test.mjs` to unit-test runner helpers with small
  synthetic evaluations. It must not traverse and evaluate the real corpus.
- Keep baseline-regression, reduced-cost eligibility, and error-reporting unit
  tests, but feed them explicit fixtures.

**Acceptance**

- Instrumentation proves every checked-in prompt fixture is evaluated once in
  `pnpm validate`.
- `pnpm test:tooling` remains deterministic and does not call Bedrock.
- `pnpm prompts:eval` still checks current fixture results, category coverage,
  and regression against `evals/phase-04/baseline.json`.

#### VPR-05 — Remove duplicate real-repository tooling scans

**Work**

- Keep standalone real-repository checks in `validate` for source text,
  workspace boundaries, and asset-key drift.
- Keep tooling unit tests over synthetic valid and invalid repositories.
- Remove real-repository assertions from tooling tests when the preceding
  standalone stage proves the identical condition.
- Measure the second `tsc -b` currently reached through `pnpm build`. Split out
  a build-artifact-only command for `validate` only if the repeated compile is
  measurable; preserve `pnpm build` as the complete standalone build command.

**Acceptance**

- Each real repository scan appears once in `validate`.
- Synthetic unit coverage of scanner failure modes remains.
- Build output and bundle-safety checks remain unchanged.

### Workstream C — Rebuild the database fixture lifecycle

#### VPR-06 — Classify database tests by isolation requirement

**Work**

- Assign every current database-project file to exactly one class:
  1. `pure`: no live database;
  2. `shared-migrated`: reads/writes ordinary runtime data and can start from a
     reset migrated schema;
  3. `isolated-schema`: changes or verifies migrations, grants, roles, schema
     identity, indexes, or other database-global state;
  4. `isolated-concurrency`: needs a dedicated database because its lock or
     failure behavior cannot be safely reset around neighboring files.
- Document the reason for every file placed in an isolated class.
- Move the six confirmed pure files and their 63 cases to a normal Node
  project that may run with the other pure projects.

**Acceptance**

- No file is classified by filename alone; classification follows what its
  setup and assertions mutate.
- `pure` files run without starting CockroachDB.
- Required real-database assertions remain in a database-backed class.

#### VPR-07 — Add a suite-owned migrated database

**Work**

- Extend the test-support harness with a suite-owned database lifecycle:
  create once, migrate once, expose its administrative/runtime URLs through
  explicit test state, and drop once in global teardown.
- Keep `createDisposableDatabase()` for isolated-schema/concurrency tests.
- For `shared-migrated` files, reset data before each file using an explicit,
  reviewed table-reset routine. Do not infer table names from application
  input and do not issue destructive statements against an unvalidated name.
- Reset mutable rows, test-created users/roles if applicable, and any state
  whose persistence could make file order observable.
- Keep file parallelism disabled for the shared database initially.
- Make teardown resilient to a failed test while preserving the original test
  failure.

**Acceptance**

- A normal shared-migrated run applies migrations once.
- Running the shared files in their default order and reversed order produces
  the same results.
- Running a selected shared file alone produces the same result as running it
  after the entire shared group.
- The reset routine refuses a database name that does not match the disposable
  test pattern.
- An interrupted suite leaves no reusable dirty database and reports cleanup
  instructions if automatic teardown cannot complete.

#### VPR-08 — Preserve isolated schema and concurrency proofs

**Work**

- Keep per-file or per-group isolated databases for migration runner, grants,
  schema identity/audit, vector concurrency, transaction integration, and any
  game-server concurrency suite shown by `VPR-06` to require it.
- Group isolated files only when their cleanup contract is explicit and
  verified; do not group merely to meet a target number.
- Measure migration count and wall time before and after grouping.

**Acceptance**

- All contract-required real CockroachDB behavior still executes.
- The total default validation count drops from 53 database creations/migration
  paths to no more than 10, unless the implementation report documents why a
  higher count is required for correctness.
- No isolated test can observe data or schema mutations from another file.

### Workstream D — Rationalize low-value and vacuous cases

#### VPR-09 — Repair static source scans

**Work**

- Change `no-network-in-transaction.test.ts` to scan only files containing at
  least one extracted `runSerializable` callback, or use one aggregate test
  that returns a complete list of offenders.
- Keep a non-vacuity assertion requiring at least one real callback.
- Consolidate the two rules determinism passes so each source file is read once
  and checked against both ambient-input and database-import restrictions.
- Preserve file paths and matched patterns in failure output.

**Acceptance**

- No generated test passes solely because its per-file callback list is empty.
- Deliberately inserting a forbidden call/import in a fixture makes the
  corresponding scan fail with the exact file.
- Deliberately removing all discoverable call sites makes the non-vacuity guard
  fail.

#### VPR-10 — Remove duplicated or non-behavioral rules cases

**Work**

- Remove the weaker duplicate property cases for repeat protection, score
  clamping, and ambient eligibility; retain the stronger owning-module tests.
- Review the remaining permutation and mutation properties independently and
  keep them only if no owning suite proves the same invariant.
- Remove the five scenario `produces at least one step` cases because each
  named scenario has a stronger golden outcome assertion.
- Remove one of the duplicated `both_endings` determinism assertions while
  preserving determinism coverage for every named scenario.
- Replace runtime assertions whose only purpose is TypeScript assignability
  (`InsertEffect.ref` optionality and `GateResult` narrowing) with compile-time
  fixtures where needed, or rely on the existing test typecheck.
- Remove `RULES_REGISTRY` object-identity assertions unless a consumer depends
  on reference identity; retain value, version, and immutability behavior.
- Move literal documentation-heading checks to one lightweight documentation
  lint check, or remove them if no release contract requires those headings.

**Acceptance**

- Every removed behavior has an equal or stronger remaining proof, named in
  the implementation notes.
- Coverage remains above all thresholds without test-only branches added to
  compensate.
- The rules package's required Decision 008 boundary matrix remains intact.

#### VPR-11 — Repair the vacuous join-secret assertion

**Work**

- Replace the current test that confirms the join secret is undefined before
  submission with a test that pauses an actual join submission after the
  secret has been allocated.
- Inspect the rendered DOM, error surfaces, logs/console capture, and any
  player-visible state while the real secret exists in its permitted storage.
- Keep a separate assertion for clearing the session after successful join.

**Acceptance**

- The security test would fail if the generated secret were rendered or
  included in an error message.
- The test proves an existing secret is nonempty before checking absence from
  forbidden surfaces.

### Workstream E — Reuse infrastructure setup and narrow browser ownership

#### VPR-12 — Synthesize the foundation stack once per fixture

**Work**

- Create one app/template fixture for resource, environment, IAM, plaintext,
  account, and region assertions.
- Perform at most one additional independent synthesis for the determinism
  comparison.
- Keep the standalone `pnpm cdk:synth` stage because it produces and verifies
  the release artifact; do not treat the structural unit test as a replacement.

**Acceptance**

- Instrumentation shows no more than two `createApp()`/template syntheses in
  the infrastructure test file.
- All current structural and security assertions remain.
- The test completes inside its configured timeout on an otherwise idle
  supported machine without increasing that timeout.

#### VPR-13 — Consolidate health and join browser cases

**Work**

- Build a layer-ownership table for each current Playwright assertion:
  component, client hook, HTTP router, real socket adapter, browser-only, or
  full persistence journey.
- Consolidate health behavior into:
  1. one healthy/wiring case covering rendering and same-origin API use; and
  2. one outage/recovery case.
- Remove browser assertions for transport headers or readiness copy only when
  the router/socket/component layer proves the identical behavior more
  directly.
- Keep join cases that require a real address bar, browser storage/cookies,
  focus/selection, or navigation lifecycle.
- Remove existing-session and closed-town browser cases if the implementation
  comparison confirms they add no browser-specific assertion beyond
  `Join.test.tsx`.
- Keep `phase-03-first-playable.spec.ts` and
  `phase-04-grounded-memory.spec.ts` unchanged except for shared setup changes
  required by `VPR-07`.

**Acceptance**

- Every deleted Playwright assertion is mapped to an equal or stronger
  surviving test.
- Browser-only security and history/storage semantics remain in Playwright.
- The two full persisted journeys still pass against a disposable migrated
  database and real local servers.

## 5. Planned file impact

Expected files and areas; implementation may add narrowly-scoped helpers but
must not broaden product scope.

| Area | Expected change |
|---|---|
| `package.json` | Remove redundant validation stages; add profiling command |
| `scripts/validate-profile.mjs` | Stage timing and clean-run diagnostics |
| `scripts/vitest-database-setup.mjs` | Suite ownership and shared database lifecycle |
| `packages/test-support/src/database/harness.ts` | Shared migrated fixture and safe reset support |
| `vitest.config.ts` | Pure database-unit project/classification and database groups |
| `scripts/prompts-eval.mjs` / `.test.mjs` | One real corpus evaluation, synthetic helper tests |
| `infrastructure/src/foundation-stack.test.ts` | Cached synth fixture |
| `packages/game-server/src/application/actions/no-network-in-transaction.test.ts` | Remove empty per-file cases |
| `packages/rules/src/testing/*.test.ts` | Remove weaker duplicate/meta cases |
| `packages/rules/src/kernel/*.test.ts` | Consolidate source scans and type-only assertions |
| `apps/web/src/screens/Join.test.tsx` | Non-vacuous join-secret test |
| `e2e/health.spec.ts` / `e2e/join.spec.ts` | Browser-layer consolidation |
| `CONTRIBUTING.md` | New profiling command, DB ownership, and test classifications |

## 6. Commit sequence

Keep commits independently reviewable and revertible:

1. **`test: add validate stage profiler and clean baseline`** — `VPR-01`.
2. **`test(db): serialize local suite ownership`** — `VPR-02`.
3. **`chore(validate): remove exact model and prompt duplication`** —
   `VPR-03`–`VPR-05`.
4. **`test(db): classify pure and isolated database suites`** — `VPR-06`.
5. **`test(db): reuse one migrated database for runtime integration`** —
   `VPR-07`–`VPR-08`.
6. **`test: remove vacuous and weaker duplicate cases`** — `VPR-09`–`VPR-11`.
7. **`test: reuse CDK synthesis and narrow Playwright coverage`** —
   `VPR-12`–`VPR-13`.
8. **`docs: record validation ownership and measured result`** — final metrics,
   mappings, and contributor guidance.

Do not combine the database lifecycle change with case deletion. Reviewers must
be able to distinguish a faster fixture from reduced behavioral coverage.

## 7. Verification matrix

Run each check on the pinned Node.js/pnpm toolchain.

| Check | Purpose |
|---|---|
| `pnpm format:check` | Plan/implementation formatting |
| `pnpm typecheck` | Test and runtime assignability remains enforced |
| `pnpm lint` | Static correctness |
| `pnpm test:tooling` | Profiler, lock, and evaluator helper behavior |
| `pnpm test:rules` | Required deterministic matrix remains |
| `pnpm test:model` | Targeted command remains valid |
| `pnpm prompts:eval` | Real corpus executes once and baseline is enforced |
| `pnpm test:db` | All real database classes pass |
| reversed-order shared DB run | Reset removes order dependence |
| selected-file-after-group DB run | No state leakage into targeted tests |
| `pnpm test` | Covered full workspace remains above thresholds |
| `pnpm cdk:synth` | Release synthesis remains valid |
| `pnpm test:e2e` | Browser-only and persisted journeys pass |
| `pnpm validate:profile` ×3 cold/×3 warm | Median before/after comparison |
| `pnpm validate` | Final canonical gate passes without retries |

### Performance exit targets

Targets are relative to the clean baseline recorded by `VPR-01`:

- at least **40% lower median wall-clock time** for a warm `pnpm validate`;
- at least **60% lower database-stage time**;
- no more than **one** real prompt-corpus evaluation;
- no more than **one** model-runtime project execution;
- no more than **10** database creation/migration paths in the default gate;
- no increase in peak database test failures or retries; and
- no statistically meaningful regression in non-database stages after
  accounting for normal machine variance.

If the database redesign does not achieve the relative target, keep the
correct fixture changes and investigate measured remaining stages. Do not
delete required integration cases to force the number.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Shared DB leaks rows between files | Explicit reset catalog, reversed-order run, selected-file-after-group run |
| Schema-mutating test corrupts shared fixture | Isolation classification and dedicated disposable DB |
| Lock file strands later runs | PID verification, run ID, `finally` cleanup, documented recovery |
| Consolidation hides which source file failed | Aggregate every offender with file and matched pattern |
| Coverage falls after duplicate removal | Check coverage after each deletion commit; restore a meaningful owning-layer case if needed |
| Browser security behavior is moved too low | Keep address-bar, storage, cookie, focus, and lifecycle assertions in Playwright |
| Cached CDK fixture masks nondeterminism | Retain one independent second synthesis |
| Faster warm result hides cold-start cost | Record and compare cold and warm medians separately |
| Concurrent external process contaminates timing | Ownership check and clean-baseline precondition |

## 9. Exit gate

This plan is complete only when:

1. `pnpm validate` passes from a clean checkout on the pinned toolchain;
2. all accepted test-plan requirements in Decisions 002, 008, 009, 010, and
   011 remain mapped to a surviving automated or explicitly manual proof;
3. coverage remains at or above the existing thresholds;
4. the default gate evaluates model tests, prompt fixtures, and real repository
   scanners once each;
5. ordinary database tests reuse a migrated fixture while schema/concurrency
   tests remain isolated;
6. the before/after profile meets the performance targets or documents a
   reviewed reason it cannot without weakening correctness; and
7. `CONTRIBUTING.md` explains test ownership, targeted commands, database-suite
   coordination, and how to reproduce the timing report.

