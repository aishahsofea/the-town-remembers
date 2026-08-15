# Cross-Agent Test Governance

- **Project:** The Town Remembers
- **Status:** Proposed implementation plan
- **Date:** 2026-08-15
- **Scope:** Prevent future implementation phases and coding agents from adding
  redundant, vacuous, incorrectly layered, or unnecessarily expensive tests.
- **Depends on:** The ownership and performance terminology introduced by
  [Validate Performance and Test Rationalization](validate-performance-and-test-rationalization.md).
- **Primary outcome:** Coding agents may propose tests, but repository-owned
  policy and deterministic checks decide whether the test has a distinct claim,
  belongs at the selected boundary, and stays inside the accepted setup budget.

## 1. Objective

Create one versioned testing policy that is understood by humans and multiple
coding agents, then enforce its hard requirements independently of any agent's
prompt-following ability.

The completed system must make these statements true:

1. every newly introduced behavioral claim has one named primary test owner;
2. a second test for the same claim records the distinct boundary or failure
   mode it proves;
3. new tests default to the cheapest correct boundary;
4. new database, browser, model-evaluation, and validation-stage costs are
   explicit before implementation;
5. Codex, Claude, Copilot, and any later supported agent receive the same core
   rules through their native repository instruction file;
6. drift between agent-specific instruction files is detected automatically;
7. deterministic policy violations fail locally and in CI; and
8. a three-tier agent evaluation suite proves the instructions work for
   ordinary cases, known failure modes, and legitimate exceptions.

This is a governance and tooling change. It does not require immediate metadata
backfill across all existing tests and must not block current work on a manual
classification of more than two thousand historical cases.

## 2. Current grounding

### 2.1 Instruction coverage is agent-specific

The repository currently has `CLAUDE.md`, but no root `AGENTS.md` and no shared
machine-enforced test policy. `CLAUDE.md` contains useful scoped-run guidance,
but its recorded suite count is already stale relative to the current 2,168
Vitest-case inventory. Another coding agent may never read it.

The policy must therefore have one neutral source of truth and thin adapters
for agent-specific discovery conventions. Copying a large policy manually into
several instruction files would create the same drift problem this plan is
meant to prevent.

### 2.2 Existing traceability is not ownership enforcement

`packages/rules/src/testing/coverage-map.test.ts` proves that configured files
exist and contain a test-name substring. It does not establish that:

- the named test is collected and executed;
- the assertion is non-vacuous;
- another file does not prove the same behavior;
- the selected test boundary is the cheapest correct one; or
- expensive setup is justified.

The existing map remains useful historical traceability, but it is not the
cross-framework ownership ledger this plan requires.

### 2.3 Prose alone cannot enforce the goal

The recent validation audit found exact stage duplication, repeated prompt
fixtures, 44 empty static-scan cases, a vacuous security assertion, and
component/browser overlap. All of those tests could satisfy a vague instruction
such as "add comprehensive coverage."

The new rules must define both sides of the trade-off:

- missing a distinct failure mode is unacceptable; and
- repeating an already-owned claim without a distinct boundary is also
  unacceptable.

Hard properties—unique IDs, setup classifications, allowlists, budgets, file
existence, instruction drift—use deterministic code as the judge. Human review
is reserved for the genuinely semantic question: whether an asserted unique
failure mode is meaningfully different.

## 3. Governance model

### 3.1 Canonical policy and thin adapters

Use this ownership hierarchy:

```text
docs/agents/testing-policy.md
        |
        +-- generated core block --> AGENTS.md
        +-- generated core block --> CLAUDE.md
        +-- generated core block --> .github/copilot-instructions.md
        +-- future adapter only when another agent is actually adopted
```

`docs/agents/testing-policy.md` is authoritative. Agent-specific files may
contain additional tool-specific instructions, but the generated test-policy
block must be byte-identical and carry a source checksum. A synchronization
script updates it; a check script rejects hand-edited drift.

Do not create adapters speculatively for every agent product. Add one when the
repository actually uses that agent and include it in the synchronization
manifest.

### 3.2 Behavioral claim ledger

Add a framework-neutral ledger at `verification/test-claims.json`. A claim is a
behavior the system promises, not a test-file name and not an individual input
value.

Proposed shape:

```json
{
  "schemaVersion": 1,
  "claims": [
    {
      "id": "V-JOIN-SECRET-NONLEAK",
      "requirement": "An allocated join secret reaches no player-visible surface",
      "primary": {
        "file": "apps/web/src/screens/Join.test.tsx",
        "test": "does not render an allocated join secret",
        "boundary": "component"
      },
      "cases": ["pending-request", "error-response"],
      "secondary": [
        {
          "file": "e2e/join.spec.ts",
          "test": "keeps the allocated secret out of browser surfaces",
          "boundary": "browser",
          "uniqueProof": "Checks address bar, cookies, storage, and browser console"
        }
      ],
      "setup": "dom",
      "source": "Decision 006"
    }
  ]
}
```

Rules for the ledger:

- IDs are stable and never reused for a different behavior.
- One claim has exactly one primary owner.
- Multiple cases under one owner are allowed only when each names a distinct
  branch, boundary, equivalence class, or regression.
- A secondary owner must use a different boundary or prove a distinct failure
  mode and must state `uniqueProof`.
- `source` links the claim to a decision, phase acceptance item, bug, security
  invariant, or other requirement.
- `setup` uses a closed vocabulary defined by the policy.

### 3.3 Incremental adoption

Do not require every historical test to receive a claim ID before this policy
can land.

Use two tracks:

1. **Governed track:** Every test added for the next implementation phase, and
   every materially changed test, must use the ledger.
2. **Legacy track:** Existing cases are recorded in a generated baseline and
   may continue unchanged. Touching a legacy test for behavioral reasons moves
   its owning claim into the governed track.

Updating the legacy baseline must be an explicit command and a visible review
artifact. CI must not regenerate it automatically.

## 4. Canonical rules

The policy must use `MUST`, `MUST NOT`, `SHOULD`, and `MAY` consistently and
include one compliant and one noncompliant example for rules that commonly
produce disagreement.

### Rule TG-01 — Search before adding

Before creating a test, an agent MUST search the ownership ledger and relevant
test suites for the behavior. Its implementation summary MUST say whether it
extended an existing owner, added a new claim, or added a justified secondary
boundary.

### Rule TG-02 — One primary owner

A behavioral claim MUST have exactly one primary test owner. Different input
values do not create different claims when they execute the same branch and
assert the same outcome.

### Rule TG-03 — Cheapest correct boundary

Tests SHOULD live at the cheapest boundary that can observe the failure:

```text
typecheck -> pure function -> component/hook -> API/application -> database
          -> real socket -> browser -> deployed/live
```

An agent MAY select a higher boundary only when it records what the lower
boundary cannot prove.

### Rule TG-04 — Distinct secondary proof

A duplicate claim at another boundary MUST include `uniqueProof`. "Extra
confidence," "comprehensive coverage," and "end-to-end coverage" are not
sufficient explanations.

Legitimate examples include browser address-bar behavior, real database
constraints, transaction races, adapter serialization, deployment wiring, and
defense-in-depth checks over a genuinely different attack surface.

### Rule TG-05 — Non-vacuous preconditions

A test MUST establish that the condition it intends to inspect exists before
asserting its absence or safety. Static scans MUST prove they discovered at
least one relevant target. Security non-leak tests MUST prove the secret or
marker exists in the permitted source before checking forbidden surfaces.

### Rule TG-06 — Equivalence classes, not input counts

Parameterized rows MUST correspond to distinct branches, contract boundaries,
or known regressions. Repeating several ordinary values through one branch is
redundant. Boundary matrices explicitly required by accepted decisions remain
valid even when adjacent rows share implementation code.

### Rule TG-07 — Compile-time claims stay compile-time

Type assignability, narrowing, and exhaustiveness MUST use TypeScript
typechecking or a compile-time fixture. Runtime tests MUST NOT exist solely to
prove that a line typechecks.

### Rule TG-08 — Expensive setup is shared by default

The closed setup vocabulary is:

```text
none | typecheck | filesystem | dom | socket | db-shared | db-isolated
     | browser | model-live | cloud-live
```

New database tests MUST use `db-shared` unless schema mutation, grants,
database-global state, or concurrency isolation requires `db-isolated`. Every
`db-isolated`, `browser`, `model-live`, or `cloud-live` claim MUST record an
isolation/cost reason.

### Rule TG-09 — Browser ownership is browser-specific

Playwright tests MUST assert at least one property unavailable to the component
or application layer: address bar, navigation lifecycle, browser storage,
cookies, focus/selection, real server wiring, multi-page behavior, or a
persisted cross-layer journey.

### Rule TG-10 — Validation stages execute once

A command added to `pnpm validate` MUST NOT be a subset already executed by an
earlier stage. Targeted developer scripts MAY remain available without being
called by the aggregate gate.

### Rule TG-11 — Meta-tests do not substitute for behavior

Tests that only check that another test file exists, a name appears in source,
documentation contains a heading, a list is nonempty, or code does not throw
MUST NOT be recorded as the primary proof of runtime behavior. A non-vacuity
assertion MAY accompany the real owning assertion.

### Rule TG-12 — Test cost is part of the change

Every phase plan and implementation summary MUST report the change in:

- named tests and parameter rows;
- shared and isolated database lifecycles;
- browser navigations/journeys;
- prompt-corpus and live-model evaluations;
- validation stages; and
- measured validation time when the change affects an expensive boundary.

An increase is allowed when it proves a new claim. It is not allowed to remain
implicit.

## 5. Ordered implementation workstreams

### Workstream A — Define the contract and its evaluation before adapters

#### TAG-01 — Create the three-tier policy evaluation corpus

**Work**

- Add versioned scenarios under `verification/test-policy-evals/` before
  finalizing the wording of the agent adapters.
- Each scenario supplies a small repository context, an implementation request,
  expected decision, and machine-checkable expected artifacts.
- Include at minimum:
  - **control:** a genuinely new pure branch requiring one unit claim;
  - **control:** a new required boundary row extending an existing matrix;
  - **control:** an existing claim whose owner should be extended;
  - **known failure:** a requested E2E test duplicating component behavior;
  - **known failure:** a database test creating a fresh migrated database when
    the shared fixture is sufficient;
  - **known failure:** a `does not throw` or empty-scan assertion offered as
    behavioral proof;
  - **known failure:** a new `validate` stage that repeats an existing project;
  - **boundary:** defense-in-depth security checks at two distinct surfaces;
  - **boundary:** a schema/grant test that legitimately requires isolation;
  - **boundary:** a concurrency race whose lower unit boundary cannot prove the
    database outcome; and
  - **boundary:** a human-review-only documentation or UX-quality claim.

**Acceptance**

- Every scenario states why the accepted answer is correct.
- Hard expectations are represented as structured fields, not prose-only
  grading instructions.
- The corpus contains controls, known failures, and boundaries before adapter
  prompts are declared complete.

#### TAG-02 — Write the canonical testing policy

**Work**

- Create `docs/agents/testing-policy.md` containing the vocabulary, TG-01
  through TG-12, examples, exception rules, and required output contract for an
  agent's implementation summary.
- Keep the policy focused on decisions an agent must make. Put background and
  historical audit detail in links rather than repeating it in every adapter.
- Include an explicit trade-off section: do not under-test unique failure
  modes, and do not duplicate already-owned claims.
- Define how an agent handles uncertainty: inspect first; if distinct ownership
  still cannot be determined, stop and ask rather than silently add an
  expensive secondary test.

**Acceptance**

- Each MUST/MUST NOT rule maps to either a deterministic check or a named human
  review field.
- No rule depends on a specific agent's tool names or hidden reasoning.
- The policy examples pass the evaluation corpus's expected decisions.

### Workstream B — Add machine-readable ownership

#### TAG-03 — Define the claim-ledger schema

**Work**

- Add a JSON Schema for `verification/test-claims.json`.
- Define closed enums for boundary and setup.
- Require stable claim ID, requirement, source, primary owner, cases, and setup.
- Require `uniqueProof` and an isolation/cost reason where applicable.
- Add positive and negative schema fixtures to tooling tests.

**Acceptance**

- Duplicate JSON keys, unknown fields, unknown boundary/setup values, malformed
  IDs, and missing required fields fail deterministically.
- The schema can represent a parameterized boundary matrix without pretending
  each row is an unrelated behavior.
- A claim can represent justified defense-in-depth without allowing two primary
  owners.

#### TAG-04 — Seed the governed ledger without blocking on legacy backfill

**Work**

- Seed claims for the high-risk examples used by the validation-rationalization
  work: database isolation, prompt evaluation, model-project inclusion,
  transaction network safety, join-secret non-leak, CDK safety, and the two
  persisted browser journeys.
- Generate a legacy baseline of current test declarations for change detection.
- Document the command and review requirements for updating that baseline.
- Do not assign claim IDs mechanically to every historical `it()` call.

**Acceptance**

- New governed claims pass schema and ownership validation.
- Existing unmodified tests remain allowed.
- Adding a new ungoverned test declaration fails the policy check unless the
  legacy baseline is explicitly and visibly updated.

### Workstream C — Distribute identical rules to coding agents

#### TAG-05 — Generate agent instruction adapters

**Work**

- Create a short generated core block from the canonical policy.
- Create root `AGENTS.md` with the core block and repository navigation links.
- Replace or augment the relevant portion of `CLAUDE.md` while preserving its
  useful tool-specific scoped-run guidance.
- Add `.github/copilot-instructions.md` only if Copilot is an actively supported
  agent for this repository.
- Add `scripts/sync-agent-test-policy.mjs` with `--check` and `--write` modes.
- Delimit generated content with stable start/end markers and include the
  canonical source checksum.

**Acceptance**

- `--check` fails after any adapter block is manually changed.
- `--write` changes only generated blocks and preserves surrounding
  agent-specific instructions.
- Every supported adapter tells the agent to read the canonical policy before
  adding or materially changing tests.
- The generated block is concise enough to remain salient in an agent's
  instruction context.

### Workstream D — Enforce the hard rules in tooling and CI

#### TAG-06 — Implement the deterministic policy checker

**Work**

- Add `scripts/check-test-policy.mjs` and synthetic Node tests.
- Validate:
  - claim-ledger schema;
  - unique primary owner per claim;
  - unique claim IDs;
  - file existence and source marker/test-name presence;
  - required `uniqueProof` for secondary owners;
  - required cost/isolation reason for expensive setup;
  - no direct `createDisposableDatabase()` outside the reviewed isolation
    allowlist/harness;
  - no new ungoverned test declarations beyond the legacy baseline;
  - synchronized agent-policy blocks; and
  - committed setup/count budgets.
- Report all violations in one run with file, claim ID, rule ID, and repair
  guidance.

**Acceptance**

- Each hard TG rule that can be decided mechanically has a failing fixture.
- The checker never rewrites files in check mode.
- Output contains no environment values, fixture secrets, or raw protected
  data.
- One command produces a complete actionable violation list.

#### TAG-07 — Add the policy check once to validation

**Work**

- Add `check:test-policy` to `package.json` and call it once from
  `pnpm validate`.
- Keep its unit tests in `test:tooling`; unit tests use synthetic fixtures and
  do not repeat the real-repository scan.
- Add the adapter synchronization check to the same policy command rather than
  a second validation stage.
- Update CI only if the aggregate gate cannot express a necessary base-branch
  comparison; otherwise keep CI calling the same `pnpm validate` used locally.

**Acceptance**

- The real policy scan executes once per validation.
- Local and CI behavior agree.
- The validation profiler shows the new check's cost and confirms it does not
  re-run tests or start CockroachDB/browser infrastructure.

### Workstream E — Put ownership decisions into planning and review

#### TAG-08 — Add the test-delta contract to phase plans

**Work**

- Add a required test-delta table to the execution-detail template used for
  future phases:

  | Claim | Existing owner | Proposed owner | Boundary | Unique failure | Setup | Decision |
  |---|---|---|---|---|---|---|

- Require each phase task that adds behavior to identify whether it reuses,
  extends, or creates a claim.
- Require the phase exit gate to report aggregate setup/count deltas.
- Update future phase execution plans as they are activated; do not rewrite
  completed historical plans solely for formatting consistency.

**Acceptance**

- No future implementation task says only "add tests" without identifying
  claim and boundary ownership.
- Expensive setup is visible during planning rather than discovered after the
  suite slows down.

#### TAG-09 — Add PR/implementation-summary review fields

**Work**

- Add or update the pull-request template with:
  - claims added, extended, or reused;
  - existing tests searched;
  - unique secondary-boundary explanation;
  - test/setup count delta;
  - scoped verification run; and
  - final aggregate gate status.
- Define the same output contract in the canonical agent policy so agents
  provide it even when no hosted PR is being created.

**Acceptance**

- A reviewer can decide test ownership without reconstructing the agent's
  search process.
- A zero-test change may state why no new claim was required.
- Security/concurrency exceptions are explicit and reviewable.

### Workstream F — Prove consistency across agents and roll out

#### TAG-10 — Build the cross-agent evaluation runner

**Work**

- Add a runner that presents each policy-eval scenario to a supplied agent
  output artifact and scores structured decisions deterministically.
- Keep actual model invocation outside the default offline validation gate;
  agent outputs may be captured manually or by an opt-in command.
- Score hard fields with code: action (`add`, `extend`, `reuse`, `ask`), claim
  ID, boundary, setup class, and required exception fields.
- Use human review only for whether free-text `uniqueProof` describes a truly
  distinct failure surface.
- Record agent/model/version, policy checksum, scenario version, result, and
  reviewed disagreements.

**Acceptance**

- The same captured output receives the same score on repeated runs.
- The runner never treats fluent prose as evidence that hard fields passed.
- Results can compare two agent types or versions without changing the policy
  corpus.

#### TAG-11 — Pilot with at least two different coding agents

**Work**

- Run the complete control/failure/boundary corpus with at least two supported
  coding agents.
- Require 100% on deterministic hard violations before enabling repository-wide
  enforcement for new tests.
- Review semantic boundary disagreements and improve examples or vocabulary;
  do not add agent-specific loopholes to make one model pass.
- Re-run after every material canonical-policy change and after adopting a new
  agent family.

**Acceptance**

- Both agents reject the known redundant/vacuous scenarios.
- Both agents accept and justify legitimate database/security/concurrency
  exceptions.
- The evaluation report names policy and scenario checksums.

#### TAG-12 — Roll out to the next implementation phase

**Work**

- Enable governed-claim enforcement before the next phase starts adding tests.
- Pilot the test-delta table on the first two tasks of that phase.
- Audit false positives, agent questions, review time, and policy-check runtime.
- After the pilot, make governed metadata mandatory for the rest of the phase.
- Schedule legacy migration only when a historical test is materially changed
  or when an audit targets its area.

**Acceptance**

- New phase tests all have governed claim ownership.
- No new direct isolated database lifecycle or unexplained E2E overlap lands.
- The policy checker adds negligible time compared with the test suite and
  starts no expensive infrastructure.
- Reviewers report no unresolved ownership ambiguity in the pilot tasks.

## 6. Planned file impact

| File or area | Expected change |
|---|---|
| `docs/agents/testing-policy.md` | Canonical neutral policy, vocabulary, examples, exception process |
| `verification/test-claims.schema.json` | Machine-readable claim-ledger schema |
| `verification/test-claims.json` | Governed behavioral ownership ledger |
| `verification/legacy-test-baseline.json` | Grandfathered historical declarations |
| `verification/test-policy-evals/` | Control, known-failure, and boundary scenarios |
| `AGENTS.md` | Codex/OpenAI discovery adapter and generated policy block |
| `CLAUDE.md` | Synchronized core block plus existing Claude-specific workflow |
| `.github/copilot-instructions.md` | Adapter only if Copilot is supported |
| `scripts/sync-agent-test-policy.mjs` | Generate/check adapter blocks |
| `scripts/check-test-policy.mjs` | Deterministic repository enforcement |
| `scripts/check-test-policy.test.mjs` | Positive and negative policy fixtures |
| `scripts/test-policy-eval.mjs` | Deterministic scoring of captured agent decisions |
| `.github/pull_request_template.md` | Test-delta and ownership review fields |
| `package.json` | `check:test-policy` and optional eval commands |
| `CONTRIBUTING.md` | Human workflow, exceptions, baseline update procedure |
| future execution-detail plans | Required claim/boundary/setup delta table |

## 7. Commit sequence

Keep policy wording, enforcement, and rollout separately reviewable:

1. **`test-policy: add control failure and boundary eval corpus`** — `TAG-01`.
2. **`docs: define canonical test ownership policy`** — `TAG-02`.
3. **`test-policy: add claim ledger schema and governed seed`** —
   `TAG-03`–`TAG-04`.
4. **`chore(agents): synchronize repository test instructions`** — `TAG-05`.
5. **`test-policy: enforce ownership setup and adapter rules`** —
   `TAG-06`–`TAG-07`.
6. **`docs: require test deltas in plans and reviews`** —
   `TAG-08`–`TAG-09`.
7. **`test-policy: add cross-agent evaluation runner`** — `TAG-10`.
8. **`docs: record cross-agent pilot and enable phase rollout`** —
   `TAG-11`–`TAG-12`.

Do not enable new-test enforcement before the policy fixtures, schema fixtures,
and adapter synchronization tests pass. Generate, evaluate, then repair the
policy rather than landing one untested instruction block.

## 8. Verification matrix

| Check | Purpose |
|---|---|
| policy schema fixture tests | Accept valid ledgers; reject malformed ownership/setup |
| adapter synchronization fixtures | Detect drift without overwriting in check mode |
| policy checker negative fixtures | Prove every deterministic rejection path |
| `pnpm check:test-policy` | Validate the real repository once |
| `pnpm test:tooling` | Validate checker/synchronizer/eval helpers synthetically |
| legacy baseline dry run | Prove historical tests are grandfathered without hiding new ones |
| one intentionally ungoverned test | Must fail with TG rule and repair guidance |
| one justified secondary browser claim | Must pass with `uniqueProof` |
| one unjustified isolated DB claim | Must fail with setup/isolation guidance |
| instruction edit in one adapter | `--check` must fail checksum comparison |
| control agent evals | Agents add/extend/reuse at the correct cheap boundary |
| known-failure agent evals | Agents reject redundant, vacuous, and repeated-stage requests |
| boundary agent evals | Agents allow justified defense-in-depth/isolation or ask when ambiguous |
| `pnpm validate:profile` | Policy check is measured and runs no expensive infrastructure |
| `pnpm validate` | Canonical repository gate passes |

## 9. Success measures

### Enforcement measures

- 100% of new phase behavioral tests have a governed claim ID.
- 100% of governed claims have exactly one primary owner.
- 100% of secondary owners include a distinct-boundary explanation.
- 100% of expensive setup claims include a cost/isolation reason.
- Zero supported agent adapters drift from the canonical generated block.
- Zero new direct disposable-database calls appear outside reviewed isolation
  points.

### Agent consistency measures

- Every supported agent passes all deterministic control, known-failure, and
  boundary fields before rollout.
- No known redundant/vacuous scenario is accepted by one agent and rejected by
  another without a documented policy ambiguity.
- Semantic disagreements produce policy/example improvements, not per-agent
  hidden exceptions.

### Workflow measures

- The real policy check completes without starting CockroachDB, Playwright, a
  model client, or cloud tooling.
- The next phase's first two tasks complete the test-delta table without
  unresolved ownership questions.
- Reviewers can identify what unique failure each new expensive test catches
  from the ledger and implementation summary alone.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Policy becomes a long prompt agents ignore | Keep adapters short; canonical detail stays linked; eval salience |
| Agent-specific files drift | Generated checksum block and `--check` in CI |
| Ledger becomes bureaucracy | Govern new/materially changed claims; grandfather legacy tests |
| Claim IDs are assigned mechanically without meaning | Require requirement/source and distinct cases; review first phase pilot |
| Checker relies on test-name substrings only | Combine ledger/schema checks, source markers, baseline deltas, and framework collection where practical |
| Legitimate defense-in-depth is rejected | Explicit secondary-owner and `uniqueProof` model |
| Agents optimize for fewer tests and miss risks | Policy states both costs; control/boundary evals require new tests when justified |
| Baseline update bypasses enforcement | Explicit command, visible diff, PR justification, never automatic in CI |
| Cross-agent eval becomes subjective | Deterministic scoring for hard fields; human review only for semantic uniqueness |
| Policy checker slows validation | No database/browser/model startup; profile and budget the stage |
| A future agent ignores repository files | Deterministic repository check still rejects noncompliant output |

## 11. Exit gate

This plan is complete only when:

1. the canonical policy and closed vocabulary are accepted;
2. the three-tier evaluation corpus exists and passes its own schema checks;
3. the governed claim ledger and legacy baseline support incremental adoption;
4. every actively supported coding agent receives the synchronized core block;
5. local and CI validation reject hard TG-rule violations deterministically;
6. future phase plans and implementation summaries include claim, boundary,
   setup, and cost deltas;
7. at least two different coding agents pass the control, known-failure, and
   boundary corpus;
8. the next phase pilots the process on two implementation tasks; and
9. the policy checker adds no expensive infrastructure lifecycle and no
   meaningful validation-time regression.

