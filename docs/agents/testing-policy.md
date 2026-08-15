# Cross-Agent Test Ownership Policy

- **Status:** Canonical, versioned. This file is the single source of truth
  for how any coding agent — human-guided or autonomous — decides whether to
  add, extend, reuse, or refuse a test in this repository.
- **Audience:** Coding agents (Claude, Codex, Copilot, and any later
  supported agent) and human reviewers.
- **Relationship to adapters:** `AGENTS.md` and `CLAUDE.md` carry a generated
  block copied verbatim from the `CORE` section below, delimited by
  `<!-- test-policy:start checksum=... -->` / `<!-- test-policy:end -->`
  markers. `scripts/sync-agent-test-policy.mjs` generates and checks that
  block. Do not hand-edit the generated block in an adapter file — edit this
  document and re-run the sync script.
- **Background:** See
  [Cross-Agent Test Governance](../../implementation-plans/cross-agent-test-governance.md)
  for the plan that created this policy, and
  [Validate Performance and Test Rationalization](../../implementation-plans/validate-performance-and-test-rationalization.md)
  for the audit that motivated it.

## Vocabulary

**Boundary ladder** (cheapest first). A test belongs at the cheapest boundary
that can observe the failure it claims to prove:

```text
typecheck -> pure function -> component/hook -> API/application -> database
          -> real socket -> browser -> deployed/live
```

**Setup classes** (closed vocabulary — `setup` field in the claim ledger MUST
be one of these):

```text
none | typecheck | filesystem | dom | socket | db-shared | db-isolated
     | browser | model-live | cloud-live
```

**Claim** — a behavior the system promises, not a test-file name and not an
individual input value. Claims live in `verification/test-claims.json`,
validated against `verification/test-claims.schema.json`.

**Agent decision actions** — every time an agent considers adding a test it
records one of: `add` (new claim), `extend` (add a case or parameter row to
an existing primary owner), `reuse` (the behavior is already fully proven;
no new test needed), `ask` (ownership or distinctness cannot be determined
from the search — stop and ask a human rather than guessing).

## Core rules for coding agents

<!-- test-policy:core:start -->
Before adding or materially changing a test, search
`verification/test-claims.json` and relevant suites. Choose and report
`add`, `extend`, `reuse`, or `ask`.

1. **TG-01 Search first.** Report decision, claim IDs, and suites searched.
2. **TG-02 One primary owner.** Same branch and outcome with new inputs means
   one parameterized owner, not another claim.
3. **TG-03 Cheapest correct boundary.** Higher boundaries must record what a
   lower boundary cannot prove.
4. **TG-04 Distinct secondary proof.** Secondary owners require a concrete
   `uniqueProof`; “extra confidence” is invalid.
5. **TG-05 Non-vacuous preconditions.** Prove the target or permitted secret
   exists before asserting absence, safety, or non-leakage.
6. **TG-06 Equivalence classes.** Each parameter row must hit a distinct
   branch, contract boundary, or regression unless a decision requires a
   boundary matrix.
7. **TG-07 Compile-time claims stay compile-time.** Use `tsc` or a compile-time
   fixture, not a runtime assertion.
8. **TG-08 Share expensive setup.** Default DB tests to `db-shared`.
   `db-isolated`, `browser`, `model-live`, and `cloud-live` require a recorded
   isolation or cost reason.
9. **TG-09 Browser tests prove browser behavior.** Assert browser-only state or
   lifecycle: URL/navigation, storage/cookies, focus/selection, real wiring,
   multi-page behavior, or a persisted cross-layer journey.
10. **TG-10 Validation stages execute once.** Never add a `pnpm validate`
    stage that repeats an earlier stage's work.
11. **TG-11 Meta-tests are not behavioral proof.** File/name/heading/nonempty
    scans or “does not throw” checks cannot be primary runtime proof.
12. **TG-12 Report test cost.** State deltas for named tests/rows, shared and
    isolated DB lifecycles, browser journeys, model evaluations, and validation
    stages.

If ownership remains ambiguous after inspection, choose `ask`; never add an
expensive secondary test speculatively.
<!-- test-policy:core:end -->

## Rule examples

### TG-02 — one primary owner

- **Compliant:** A new claim `V-INVITE-EXPIRY` gets one primary test at the
  application boundary. A later task needing to also cover "expired token
  reused twice" adds a `case` to that same primary test rather than a new
  file.
- **Noncompliant:** Two files each assert "an expired invite returns 410" at
  the same application boundary with no `uniqueProof`. The second is a
  duplicate, not a secondary owner.

### TG-04 — distinct secondary proof

- **Compliant:** `V-JOIN-SECRET-NONLEAK` has a component-level primary test
  (does not render the secret) and a browser secondary test with
  `uniqueProof: "Checks address bar, cookies, storage, and browser console"`
  — properties the component test cannot observe.
- **Noncompliant:** The same claim gets a second Playwright test whose
  `uniqueProof` says "extra confidence in the full stack." Rejected — no
  distinct observable property named.

### TG-05 — non-vacuous preconditions

- **Compliant:** A static scan test asserts `matches.length > 0` before
  asserting none of the matches contain a forbidden pattern.
- **Noncompliant:** A scan that would pass identically if the glob matched
  zero files, because it never asserts the corpus was non-empty.

### TG-08 — expensive setup is shared by default

- **Compliant:** A new query test uses the shared `db-shared` fixture
  database already running for the suite.
- **Noncompliant:** A new query test calls `createDisposableDatabase()` for
  a read-only query with no schema mutation or isolation need, and records
  no cost/isolation reason.

### TG-11 — meta-tests are not behavioral proof

- **Compliant:** `coverage-map.test.ts` records traceability alongside real
  behavioral tests, not instead of them.
- **Noncompliant:** A test asserting `packages/rules/src/foo.ts` "contains
  the string `throw`" is submitted as the primary proof that `foo()` throws
  on invalid input. It must call `foo()` with invalid input and assert the
  throw.

## Required output contract

When an agent adds, extends, reuses, or explicitly declines to add a test,
its implementation summary (and, where a PR exists, the PR template's
test-delta section) states:

- claim(s) added, extended, or reused, by ID;
- existing tests searched before deciding;
- for any secondary owner: the `uniqueProof` boundary explanation;
- the test/setup count delta (see TG-12); and
- the scoped verification command actually run, and the final aggregate
  gate status if it was run.

A zero-test change states why no new claim was required. Security or
concurrency exceptions to the cheapest-boundary default are explicit and
reviewable, not silent.

## Incremental adoption

Two tracks, not a full historical backfill:

1. **Governed track:** every test added for the current or a future
   implementation phase, and every materially changed test, uses the
   ledger.
2. **Legacy track:** existing cases are recorded once in
   `verification/legacy-test-baseline.json` and may continue unchanged.
   Touching a legacy test for behavioral reasons (not a rename or a
   mechanical refactor) moves its owning claim into the governed track.

Updating the legacy baseline is an explicit, reviewable command
(`node scripts/generate-legacy-baseline.mjs --write`), never automatic in
CI. `pnpm check:test-policy` fails on any test declaration that is neither
in the governed ledger nor the legacy baseline.

## Enforcement

- `pnpm check:test-policy` runs `scripts/check-test-policy.mjs` once, as
  part of `pnpm validate`. It validates the claim-ledger schema, unique
  claim IDs, unique primary ownership, required `uniqueProof` on secondary
  owners, required cost/isolation reasons on expensive setup, generated
  adapter synchronization, and that no test declaration falls outside the
  governed ledger or legacy baseline.
- `node scripts/sync-agent-test-policy.mjs --check` fails when a generated
  adapter block has drifted from this document. `--write` regenerates it.
- The checker starts no database, browser, or model infrastructure and
  reports every violation from one run, with file, claim ID, rule ID, and
  repair guidance.
