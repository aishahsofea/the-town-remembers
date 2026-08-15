# Cross-Agent Test Ownership Policy

- **Status:** Canonical, versioned. This file is the single source of truth
  for how any coding agent — human-guided or autonomous — decides whether to
  add, extend, reuse, or refuse a test in this repository.
- **Audience:** Coding agents (Claude, Codex, Copilot, and any later
  supported agent) and human reviewers.
- **Relationship to adapters:** `AGENTS.md`, `CLAUDE.md`, and
  `.github/copilot-instructions.md` each carry a generated block copied
  verbatim from the `CORE` section below, delimited by
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
Before writing a test, search `verification/test-claims.json` and the
relevant test suites for the behavior. State in your implementation summary
whether you extended an existing owner, added a new claim, reused an
existing test unchanged, or are asking because ownership is ambiguous.

1. **TG-01 Search before adding.** Search the ledger and relevant suites
   first. State the decision (`add` / `extend` / `reuse` / `ask`) in your
   summary.
2. **TG-02 One primary owner.** Exactly one primary test owns a claim.
   Different input values are not different claims when they exercise the
   same branch and assert the same outcome — that is a parameter row, not a
   new claim.
3. **TG-03 Cheapest correct boundary.** Default to the cheapest boundary on
   the ladder that can observe the failure. Selecting a higher boundary
   requires recording what the lower boundary cannot prove.
4. **TG-04 Distinct secondary proof.** A second test for an already-owned
   claim MUST record `uniqueProof`: the specific property the first test's
   boundary cannot observe. "Extra confidence" and "comprehensive coverage"
   are not valid `uniqueProof` values.
5. **TG-05 Non-vacuous preconditions.** Prove the condition under test
   exists before asserting its absence or safety. A static scan must prove
   it found at least one relevant target; a non-leak test must prove the
   secret exists in the permitted source before checking forbidden
   surfaces.
6. **TG-06 Equivalence classes, not input counts.** Parameterized rows must
   each hit a distinct branch, contract boundary, or known regression — not
   repeat ordinary values through the same branch. Decision-required
   boundary matrices are exempt even when adjacent rows share code.
7. **TG-07 Compile-time claims stay compile-time.** Type assignability,
   narrowing, and exhaustiveness use `tsc` or a compile-time fixture, never
   a runtime assertion that only proves a line typechecks.
8. **TG-08 Expensive setup is shared by default.** New database tests use
   `db-shared` unless schema mutation, grants, database-global state, or
   concurrency isolation require `db-isolated`. Every `db-isolated`,
   `browser`, `model-live`, or `cloud-live` claim records an
   isolation/cost reason.
9. **TG-09 Browser ownership is browser-specific.** A Playwright test must
   assert at least one property the component/application layer cannot see:
   address bar, navigation lifecycle, storage, cookies, focus/selection,
   real server wiring, multi-page behavior, or a persisted cross-layer
   journey.
10. **TG-10 Validation stages execute once.** A command added to
    `pnpm validate` must not repeat a subset an earlier stage already runs.
    Targeted developer scripts may exist without joining the aggregate gate.
11. **TG-11 Meta-tests are not behavioral proof.** A test that only checks
    that another file exists, a name appears in source, a doc has a
    heading, a list is nonempty, or code does not throw cannot be the
    primary proof of runtime behavior. It may accompany the real assertion.
12. **TG-12 Test cost is part of the change.** Report the delta in named
    tests/rows, shared and isolated database lifecycles, browser
    journeys, prompt/live-model evaluations, and validation stages. An
    increase is fine when it proves a new claim; it must never be
    implicit.

**Uncertainty rule:** inspect first. If distinct ownership still cannot be
determined after searching, stop and ask — do not silently add an expensive
secondary test to be safe.
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
