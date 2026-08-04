# Phase 0 — Engineering Foundation

- **Status:** Detailed implementation plan
- **Depends on:** Accepted decisions 001–011
- **Produces:** A buildable, testable TypeScript workspace and executable
  contract boundary for later phases
- **Task ID prefix:** `P0-`

## 1. Objective and user-visible proof

Create the smallest coherent TypeScript workspace that can build, lint, test,
and run the React, Game API Lambda, Ambient Tick Lambda, Recovery Lambda,
shared-contract, and CDK entry points through documented commands.

The user-visible proof is a local browser page that calls
`GET /api/v1/health` through the same `/api` path shape used by the deployed
application and renders API liveness plus build identity. The proof must not
claim database, Bedrock, queue, or cloud readiness. A clean checkout must be
able to install the pinned toolchain, run all quality gates, build every shell,
and execute the health journey without secrets.

## 2. Scope

### In scope

- A `pnpm` workspace and a pinned Node.js/package-manager contract.
- React + Vite, Lambda, shared-package, and AWS CDK TypeScript project shells.
- Strict TypeScript, linting, formatting checks, Vitest, and Playwright
  configuration.
- Versioned Zod/TypeScript contracts for the accepted HTTP and Bedrock result
  shapes, with drift checks against the checked-in JSON Schema snapshots.
- Central environment parsing that fails closed and separates browser-safe,
  runtime-secret, infrastructure, test, and operator-only configuration.
- A local Game API health route and browser health page.
- Safe structured-log and request-ID primitives used by server shells.
- Repository-wide commands, a CI baseline, and contributor setup
  documentation.

### Explicitly out of scope

- CockroachDB migrations, Kysely repositories, seed insertion, or live
  database connectivity; these begin in Phase 1.
- Gameplay calculations, reducers, player projections, or state transitions;
  these begin in Phase 2.
- Public gameplay routes, session handling, idempotency execution, or a
  playable browser journey; these begin in Phase 3.
- Bedrock calls, embeddings, prompt evaluation, queue publication/consumption,
  recovery behavior, or production AWS resources.
- Deploying an AWS environment, creating secrets, or selecting mutable cloud
  service settings that belong to Phase 7.
- Product behavior beyond decisions 001–011.

Temporary shells must report that unsupported work is unavailable. They must
not return fabricated success for persistence, model, queue, or gameplay
operations.

## 3. Prerequisites and accepted contracts

Implementation starts from an otherwise documentation-only repository. The
following accepted sources are normative:

- Decision 002 fixes TypeScript, React/Vite, CDK, Lambda, `pnpm`, Kysely/`pg`,
  Zod, Vitest, and Playwright as the stack.
- Decision 003 fixes the browser/API/component boundaries and prohibits raw
  rows or objective truth from crossing into player or model types.
- Decision 006 owns `/api/v1`, the strict action and response unions, problem
  shape, headers, health response, and player-safe view contract.
- Decision 007 owns time budgets and runtime parameter values; Phase 0 may
  expose typed constants but does not implement those workflows.
- Decision 010 and `docs/schemas/*.schema.json` own the three Bedrock output
  shapes and require a Zod/JSON-Schema drift test.
- Decision 011 owns local asset-key handling, client state boundaries, invite
  safety, and the eventual browser routes.

Before `P0-01` is closed, choose and record a currently supported Node.js LTS
version and compatible `pnpm` version. The accepted documents do not fix exact
versions. This is an implementation decision, not permission to change the
stack.

## 4. Ordered workstreams and tasks

### Workstream A — Workspace and toolchain

#### P0-01 — Pin the repository toolchain

**Deliverables**

- Root package manifest with `packageManager`, engine requirements, license,
  and private-workspace protection.
- `pnpm-workspace.yaml`, lockfile, Node version marker, and ignore files.
- One documented bootstrap command that does not require global unpinned
  packages.
- A recorded implementation decision for the exact Node and `pnpm` versions.

**Acceptance checks**

- A clean install is reproducible with the lockfile and rejects an unsupported
  runtime with a direct error.
- Dependency installation never needs application secrets.
- No generated dependency tree or local environment file is tracked.

#### P0-02 — Establish workspace ownership boundaries

**Depends on:** `P0-01`

**Deliverables**

- Workspace directories for the web app, Game API, Ambient worker, Recovery
  worker, infrastructure, accepted shared contracts, runtime configuration,
  and test support.
- Package names and dependency direction documented in the root contributor
  guide.
- Package export maps that expose public modules rather than cross-package
  source imports.

**Boundary rule**

The web package may consume player-safe contracts but cannot depend on database
or Lambda packages. Model-facing code must eventually receive approved bundles,
not database repositories. Infrastructure may compose build artifacts but may
not become a domain-logic package.

#### P0-03 — Configure strict TypeScript and module builds

**Depends on:** `P0-02`

**Deliverables**

- Root strict TypeScript base configuration plus browser, Lambda, test, and CDK
  variants.
- Project references or equivalent ordered builds for all workspace packages.
- Source maps and declaration output where packages are consumed across
  boundaries.
- Build metadata injection capable of supplying the health route's release or
  Git identity without embedding secrets.

**Acceptance checks**

- Every package type-checks independently and through the root command.
- Browser builds cannot import Node-only or server-secret modules.
- Server builds have no implicit dependency on a developer's local path.

### Workstream B — Executable contracts and configuration

#### P0-04 — Create the shared HTTP contract package

**Depends on:** `P0-03`

**Deliverables**

- Strict Zod schemas and inferred TypeScript types for `ActionRequest`,
  `CompletedActionResponse`, processing status, `ProblemResponse`, invite/join
  responses, health, and the complete `PlayerView` union from Decision 006.
- Shared primitive schemas for opaque IDs, UUID idempotency headers, canonical
  UTC timestamps, plain-text bounds, and closed enums.
- Fixtures proving every discriminated-union member accepts its documented
  shape and rejects unknown properties or cross-kind result combinations.
- Stable contract exports carrying API version `v1`.

**Security and leakage checks**

- Contract fixtures fail if canonical town revision, exact belief/trust/
  suspicion scores, objective truth, tokens, cookies, secrets, or raw database
  rows are added to player-safe types.
- Server problem fixtures never contain stack traces, SQL details, hidden IDs,
  credentials, or raw model output.

#### P0-05 — Mirror the Bedrock structured-output contracts

**Depends on:** `P0-03`

**Deliverables**

- Zod and TypeScript definitions for `claim_normalization_v1`,
  `npc_dialogue_v1`, and `ambient_choice_v1` without changing their accepted
  meanings.
- A deterministic snapshot/drift test comparing generated or normalized schema
  output with all three checked-in files under `docs/schemas/`.
- Version constants for the four prompt versions, three task-input versions,
  three validation-policy versions, and three output schema names accepted by
  Decision 010.

**Acceptance checks**

- Schema mismatch is a test failure; implementation does not silently rewrite
  the accepted JSON snapshots.
- Dynamic membership and semantic checks remain explicit future validators;
  JSON Schema is not presented as sufficient authorization.

#### P0-06 — Implement deterministic serialization primitives

**Depends on:** `P0-04`

**Deliverables**

- A shared canonical-JSON utility that recursively sorts object keys,
  preserves caller-established array order, emits UTF-8 without insignificant
  whitespace, and rejects unsupported values.
- SHA-256/base64url helpers for future request fingerprints and player-view
  versions, with domain separators supplied by callers.
- Unit fixtures for stable serialization, Unicode, reordered object keys,
  meaningful array order, and byte-identical hashes across Node executions.

This task establishes primitives only. Phase 2 owns the actual player-safe
projection and `player-view:v1` hash input.

#### P0-07 — Centralize and validate configuration

**Depends on:** `P0-03`

**Deliverables**

- Separate schemas/loaders for browser-public, Game runtime, Ambient runtime,
  Recovery runtime, CDK/deployment, test, and operator-only migration
  configuration.
- An `.env.example` containing names and safe placeholders only.
- Fail-fast tests for missing, malformed, or accidentally browser-exposed
  secret variables.
- Typed placeholders for accepted runtime values from Decision 007, clearly
  separated from credentials and cloud resource identifiers.

**Security constraints**

- The migration administrator credential is operator-only and cannot be
  imported into Lambda packages.
- Browser configuration cannot include the judge code, application security
  keys, database URLs, model prompts, or session material.
- Configuration errors log variable names and categories, never values.

### Workstream C — Executable application shells

#### P0-08 — Build the Game API health shell

**Depends on:** `P0-04`, `P0-07`

**Deliverables**

- Lambda-compatible Game API entry point and local adapter exposing only
  `GET /api/v1/health`.
- Health response validation against the shared contract: liveness, build, and
  server time only.
- Request-ID creation/propagation and a minimal JSON log event containing safe
  route template, status, and latency.
- Explicit `404`/problem response for every unimplemented route.

**Acceptance checks**

- Health does not query or claim readiness for CockroachDB, Bedrock, SQS, or
  Secrets Manager.
- Logs exclude raw URLs, request bodies, headers, cookies, authorization,
  invite tokens, and environment values.

#### P0-09 — Build Ambient and Recovery worker shells

**Depends on:** `P0-07`

**Deliverables**

- Lambda-compatible entry points with strict versioned event-envelope parsing.
- Safe structured logs and stable unsupported/no-work results for local smoke
  execution.
- Tests showing malformed events are rejected without side effects and raw
  queue/event payloads are not logged.

These shells do not publish, process, retry, quarantine, clear join secrets, or
touch persistence. Phase 5 owns those behaviors.

#### P0-10 — Build the React/Vite health shell

**Depends on:** `P0-04`, `P0-08`

**Deliverables**

- Accessible React entry page with loading, healthy, and safe failure states.
- Local Vite routing/proxy configuration that calls `/api/v1/health` without a
  cross-origin workaround.
- A versioned local asset-manifest abstraction with neutral fallback behavior;
  no final illustrations are required in this phase.
- Component tests proving no secret or dependency-readiness claim is rendered.

The page is a foundation diagnostic, not the accepted game shell from Decision
011.

#### P0-11 — Create a synthesizable CDK shell

**Depends on:** `P0-03`, `P0-07`, `P0-08`, `P0-09`, `P0-10`

**Deliverables**

- CDK application and stack entry points that synthesize deterministically.
- Build/bundling contracts for the web and three Lambda artifacts.
- Tests or assertions that no plaintext secret values enter synthesized
  templates.
- Clearly named placeholders for production resources deferred to Phase 7.

The shell need not create the complete CloudFront, API Gateway, Lambda, SQS,
EventBridge, Secrets Manager, CloudWatch, or budget topology yet. It must not
grant wildcard access as a temporary shortcut.

### Workstream D — Quality gates and handoff documentation

#### P0-12 — Standardize lint, formatting, unit, build, and browser commands

**Depends on:** `P0-03` through `P0-11`

**Deliverables**

- Root commands for formatting check, lint, type-check, unit/contract tests,
  build, CDK synthesis, the local development pair, and the browser health
  journey.
- Vitest projects or equivalent package-aware configuration with coverage
  focused on shared boundaries rather than arbitrary percentage gaming.
- Playwright configuration with deterministic ports and lifecycle management.
- A single aggregate validation command used locally and in CI.

#### P0-13 — Add the CI baseline

**Depends on:** `P0-12`

**Deliverables**

- CI workflow that installs from the lockfile, caches only safe package/build
  artifacts, and runs the same aggregate validation command as local work.
- Concurrency cancellation for superseded branch runs.
- Test output and build artifact retention sufficient to diagnose failures,
  excluding `.env` files, cookies, request bodies, raw URLs, and secret values.

CI/CD deployment remains deferred. This task validates code; it does not mutate
AWS or CockroachDB.

#### P0-14 — Document setup, architecture boundaries, and failure handling

**Depends on:** `P0-12`

**Deliverables**

- Contributor guide covering prerequisites, install, validation, local health
  startup, package map, configuration categories, and common failures.
- A short contract-change procedure: update the accepted decision first when
  semantics change, then implementation/schema snapshots/tests together.
- Logging rules and a secret-redaction checklist referenced from each server
  package.
- Explicit deferred-work markers naming the owning later phase for every
  placeholder shell.

## 5. Artifacts

Expected artifact classes, with exact paths finalized by `P0-02`:

| Area | Artifacts |
|---|---|
| Repository | Workspace manifest, root scripts, lockfile, runtime pin, ignore files |
| Shared contracts | HTTP Zod schemas/types, prompt-result Zod schemas/types, version constants, canonical JSON and hash utilities |
| Web | React/Vite health shell, public configuration boundary, asset-key fallback abstraction |
| Runtime | Game API health handler, Ambient handler shell, Recovery handler shell, safe log/request-context primitives |
| Infrastructure | CDK app/stack shell and synth assertions |
| Verification | Vitest contract/unit projects, Playwright health journey, CI workflow |
| Documentation | Contributor setup, package/dependency map, configuration and logging rules |

## 6. Dependencies and sequencing

```text
P0-01 -> P0-02 -> P0-03
P0-03 -> P0-04 -> P0-06
P0-03 -> P0-05
P0-03 -> P0-07
P0-04 + P0-07 -> P0-08
P0-07 -> P0-09
P0-04 + P0-08 -> P0-10
P0-08 + P0-09 + P0-10 -> P0-11
P0-03..P0-11 -> P0-12 -> P0-13
P0-12 -> P0-14
```

`P0-04` and `P0-05` may run in parallel once package boundaries exist.
Application shells may run in parallel after shared configuration is stable.
The phase exits only after the aggregate validation command exercises all of
them from a clean install.

## 7. Verification matrix

Commands below are planned interfaces introduced by this phase; they are not
claimed to exist before implementation.

| Concern | Verification | Planned command |
|---|---|---|
| Reproducible install | Clean lockfile-only install on the pinned runtime | `pnpm install --frozen-lockfile` |
| Formatting and lint | Repository formatting check and static rules | `pnpm format:check` and `pnpm lint` |
| Type boundaries | Strict type-check of every workspace project | `pnpm typecheck` |
| HTTP contracts | Accept valid union fixtures; reject unknown/cross-kind/unsafe fields | `pnpm test:contracts` |
| Prompt schema drift | Compare all Zod/JSON Schema snapshots byte-semantically | `pnpm test:contracts -- prompt-schema-drift` |
| Configuration | Missing/malformed/secret-crossing fixtures fail closed | `pnpm test -- config` |
| Runtime shells | Health is minimal; invalid worker events have no effects; logs are redacted | `pnpm test -- runtime-shells` |
| Builds | Build web, shared packages, three Lambdas, and CDK app | `pnpm build` |
| Infrastructure shell | Deterministic synth contains no plaintext secrets or wildcard placeholder grants | `pnpm cdk:synth` |
| Browser proof | Browser opens the local page, observes health, and sees a safe outage state when API is stopped | `pnpm test:e2e -- health` |
| Whole phase | Run the exact local/CI aggregate gate | `pnpm validate` |

The clean-checkout exit check should run in a fresh temporary working copy or
CI job so undeclared global tools and stale build output cannot mask failure.

## 8. Risks, decisions, and fallback strategy

| Risk or decision | Plan | Fallback / escalation |
|---|---|---|
| Exact Node and `pnpm` versions are unspecified | Select supported compatible versions in `P0-01`, pin both, and record the choice | If a required AWS/CDK/Vite package conflicts, choose the nearest supported LTS combination; do not change the accepted stack silently |
| Workspace layout is not accepted product behavior | Keep paths replaceable and enforce dependency direction through package exports and tests | Record only structural changes in contributor docs; no decision-document change is needed unless authority boundaries move |
| Zod-to-JSON-Schema tooling may emit a different but equivalent document | Compare normalized schema semantics and preserve checked-in Decision 010 files as authority | Hand-maintain the small accepted schemas if generation cannot be made stable |
| A local proxy could hide production routing mistakes | Keep browser URLs relative and test the exact `/api/v1/health` path | Phase 7 repeats the journey through CloudFront/API Gateway before deployment exit |
| Shells are mistaken for working integrations | Return explicit unsupported/no-work outcomes and label deferred owners | Remove a shell if it cannot communicate its limitations safely |
| CI exposes sensitive diagnostics later | Start with allowlisted logs/artifacts and add secret-pattern tests before credentials exist | Fail CI artifact publication rather than uploading an unreviewed diagnostic bundle |

No fallback may introduce mock objective truth, persist secrets, weaken strict
schemas, or report an external dependency as healthy without checking it at the
phase that owns that dependency.

## 9. Exit checklist

- [ ] `P0-01` through `P0-14` are complete and linked to their delivered
  artifacts.
- [ ] A clean checkout installs with the pinned Node/`pnpm` versions and
  lockfile.
- [ ] Formatting, lint, strict type-check, contract/unit tests, builds, CDK
  synthesis, and the browser health journey pass locally and in CI.
- [ ] All HTTP and Bedrock result unions have executable Zod/TypeScript
  contracts, and all three checked-in JSON schemas pass drift tests.
- [ ] The browser imports only player-safe contracts and public configuration.
- [ ] The health route reports liveness/build/time only and makes no dependency
  readiness claim.
- [ ] Worker shells reject malformed events and perform no external effects.
- [ ] Safe logs contain request/operation context without raw URLs, request
  events, bodies, headers, cookies, tokens, credentials, or secret values.
- [ ] The CDK shell synthesizes without plaintext secrets or wildcard
  placeholder permissions.
- [ ] Local setup, aggregate commands, package boundaries, configuration
  categories, and deferred owners are documented.

## 10. Handoff to Phase 1

Phase 1 may begin when the shared packages, strict builds, configuration
boundary, test harness, and CI gate are stable. Its implementation should reuse:

- `P0-02` package/dependency boundaries for database and content packages;
- `P0-04` accepted API types where persisted response JSON must later be
  validated;
- `P0-05` version constants for future `agent_runs` metadata;
- `P0-06` canonical serialization and hashing primitives;
- `P0-07` operator-only versus Lambda runtime credential separation; and
- `P0-12`/`P0-13` test and CI entry points.

Phase 1 must not retrofit database concerns into the web package or put the
operator-held `migration_admin` credential into any Lambda configuration. Any
contract mismatch discovered while implementing migrations is reconciled in
the accepted decision documents and shared schemas before SQL is treated as
authoritative.
