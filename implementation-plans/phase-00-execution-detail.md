# Phase 0 — Execution Detail

- **Status:** Working execution plan for
  [Phase 0 — Engineering Foundation](phase-00-engineering-foundation.md)
- **Scope:** Concrete file layout, library selections, module contracts, test
  cases, and command definitions for `P0-01` through `P0-14`
- **Authority:** This document refines *how* Phase 0 is built. It never
  redefines *what* decisions 001–011 accept. Where the phase plan and an
  accepted decision disagree, the decision wins and the discrepancy is recorded
  in section 9.

## 1. Completion state

All tasks are complete. The commit that delivered each one:

| Task | Commit |
|---|---|
| `P0-01` Pin the repository toolchain | `d6d26d1` |
| `P0-02` Establish workspace ownership boundaries | `88dff45` |
| `P0-03` Configure strict TypeScript and module builds | `ca1ba45` |
| `P0-04` Create the shared HTTP contract package | `e4683f9` |
| `P0-05` Mirror the Bedrock structured-output contracts | `da3abfb` |
| `P0-06` Implement deterministic serialization primitives | `c428833` |
| `P0-07` Centralize and validate configuration | `21850ae` |
| `P0-08` Build the Game API health shell | `c227e57` |
| `P0-09` Build the Ambient and Recovery worker shells | `2083961` |
| `P0-10` Build the React/Vite health shell | `b1cf210` |
| `P0-11` Create a synthesizable CDK shell | `996cec1` |
| `P0-12` Standardize the quality gates | `e8a42e4`, `9d24ed1`, `af61244` |
| `P0-13` Add the CI baseline | `b0f5e9b` |
| `P0-14` Document setup and boundaries | `f01590b`, `6084a26` |

The recorded toolchain is Node.js `24.18.0` and pnpm `11.20.0`. Every command
in this plan runs on that pair.

## 2. Implementation decisions

These are structural choices Phase 0 is explicitly permitted to make. They are
recorded here so later phases inherit them instead of rediscovering them.

| ID | Decision | Rationale |
|---|---|---|
| `D0-A` | TypeScript project references (`tsc -b`) drive ordered library builds; Vite builds only `apps/web` | Ordered builds and declaration output are required by `P0-03`; a bundler is only needed for the browser |
| `D0-B` | Zod 4 is the schema runtime, and `z.toJSONSchema` generates the drift comparison | `P0-05` requires generated-versus-checked-in comparison; Zod 4 emits Draft 2020-12, the subset Decision 010 uses |
| `D0-C` | Vitest projects split `contracts`, `config`, `runtime-shells`, and `web` | The verification matrix addresses those four concerns by name |
| `D0-D` | CDK synthesis is programmatic (`new App(); app.synth()`), not the `aws-cdk` CLI | Phase 0 only promises deterministic synthesis; the CLI is a Phase 7 deployment concern |
| `D0-E` | Environment variables use the `TTR_` prefix; browser-public variables use `VITE_TTR_` | A single visible prefix makes the browser/secret split checkable by a rule, not by memory |
| `D0-F` | Unimplemented routes and wrong methods return `404`, never `405` | The Decision 006 status table has no `405`; inventing one would widen the accepted contract |
| `D0-G` | `X-Request-Id` is always server-generated and never echoed from the client | A client-controlled identifier would flow into logs |
| `D0-H` | `IsoTime` is strictly `YYYY-MM-DDTHH:MM:SS.sssZ`, including on the health route | Decision 006 defines exactly three fractional digits as the canonical timestamp form (see 9.1) |
| `D0-I` | Grapheme-cluster bounds use `Intl.Segmenter` | Decision 006 bounds text in grapheme clusters, not UTF-16 code units |
| `D0-K` | TypeScript is pinned to `6.0.3`, not `7.0.2` | The 7.x package ships no TypeScript API surface, and typescript-eslint 8 needs it for type-checked linting. Revisit when a compatible typescript-eslint release exists |
| `D0-L` | Committed non-secret local defaults live in `.env.defaults`, read only by repository tooling | A clean checkout must validate without hand-set variables, while the runtime loaders keep failing closed because they never read a file |
| `D0-M` | `pnpm typecheck` runs before `pnpm lint` in the aggregate gate | Packages resolve each other through their `dist` declarations, so type-aware lint rules need the ordered build to have run |

## 3. Dependency selection

Only these external runtime and development dependencies enter the workspace in
Phase 0. Each has a named justification; anything else needs a plan amendment.

| Package | Where | Why |
|---|---|---|
| `typescript` 6.0.3 | root | `P0-03` strict builds; see `D0-K` |
| `zod` 4 | `http-contracts`, `model-contracts`, `runtime-config`, `browser-config`, both workers | `P0-04`, `P0-05`, `P0-07`, `P0-09` |
| `vitest`, `@vitest/coverage-v8` | root | `P0-12` unit, contract, and coverage gate |
| `@playwright/test` | root | `P0-12` browser health journey |
| `eslint`, `@eslint/js`, `typescript-eslint`, `globals` | root | `P0-12` lint gate |
| `prettier` | root | `P0-12` formatting gate |
| `@types/node` | root | Node typings for server projects and tooling |
| `@the-town-remembers/runtime-config` | root | `playwright.config.ts` reads the test-harness port surface |
| `react`, `react-dom` | `apps/web` | `P0-10` |
| `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` | `apps/web` | `P0-10` build and typings |
| `happy-dom`, `@testing-library/react`, `@testing-library/dom` | `apps/web` | `P0-10` component tests, resolved from the web workspace so React is not duplicated |
| `@types/aws-lambda` | the three Lambda apps | `P0-08`, `P0-09` typed event envelopes |
| `aws-cdk-lib`, `constructs` | `infrastructure` | `P0-11` |

`eslint-plugin-react-hooks` was planned but not installed: the health shell has
one hook, and the rule set would need a React-specific ESLint program that
Phase 3 is better placed to add alongside the real client.

No AWS SDK client, database driver, or model client is installed in Phase 0.
Their absence is part of the proof that the shells cannot reach a dependency.

## 4. Delivered file layout

```text
tsconfig.base.json          strict options shared by every project
tsconfig.node.json          server and tooling variant (node types, NodeNext)
tsconfig.portable.json      shared-library variant (no node types, no DOM)
tsconfig.browser.json       browser variant (DOM lib, jsx, bundler resolution)
tsconfig.json               solution file referencing all eleven projects
tsconfig.tests.node.json    test-only program for node projects and tooling
tsconfig.tests.web.json     test-only program for the browser project
eslint.config.js            flat config with per-area boundary rules
.prettierrc.json .prettierignore
vitest.config.ts            contracts, config, runtime-shells, and web projects
playwright.config.ts        deterministic ports and web-server lifecycle
.env.example                every variable name with a safe placeholder
.env.defaults               committed non-secret local values (see D0-L)
.github/workflows/ci.yml

scripts/
  check-workspace-boundaries.mjs   package ownership and dependency direction
  check-artifact-safety.mjs        refuses to publish an unsafe CI bundle
  check-bundle-safety.mjs          browser bundle carries no server concern
  local-env.mjs / .d.mts           committed local defaults for tooling only
  build-id.mjs                     build identity without reading a secret
  dev.mjs                          the local API and Vite pair
  synth.mjs                        programmatic CDK synthesis entry
  *.test.mjs                       node:test coverage for each of the above

packages/http-contracts/src/
  primitives.ts player-view.ts actions.ts problem.ts health.ts town.ts
  routes.ts fixtures.ts index.ts
  contracts.test.ts leakage.test.ts routes.test.ts

packages/model-contracts/src/
  claim-normalization.ts npc-dialogue.ts ambient-choice.ts
  versions.ts json-schema.ts index.ts
  json-schema.test.ts versions.test.ts

packages/serialization/src/
  canonical-json.ts digest.ts index.ts (+ tests)

packages/runtime-config/src/
  shared.ts reliability.ts
  game.ts ambient.ts recovery.ts deployment.ts test.ts operator.ts
  configuration.test.ts

packages/browser-config/src/ index.ts index.test.ts
packages/test-support/src/   log-capture.ts redaction.ts index.ts

apps/game-api/src/
  handler.ts local-server.ts main.ts
  http/{types,request-id,problem,router}.ts observability/log.ts
  routes/health.ts (+ router and local-server tests)

apps/ambient-worker/src/  handler.ts envelope.ts observability/log.ts (+ tests)
apps/recovery-worker/src/ handler.ts envelope.ts observability/log.ts (+ tests)

apps/web/
  index.html vite.config.ts vitest.config.ts
  src/{main.tsx,App.tsx,config.ts,styles.css,vite-env.d.ts}
  src/health/{HealthPanel.tsx,useHealth.ts} (+ tests)
  src/assets/{manifest.ts,placeholder.ts} (+ tests)

infrastructure/src/ app.ts foundation-stack.ts synth.ts (+ tests)
e2e/health.spec.ts
```

## 5. Task-level execution detail

### `P0-03` — Strict TypeScript and module builds

**Compiler options (`tsconfig.base.json`).** `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`noPropertyAccessFromIndexSignature`, `isolatedModules`, `verbatimModuleSyntax`,
`erasableSyntaxOnly`, `declaration`, `declarationMap`, `sourceMap`, `composite`,
`skipLibCheck: false` for first-party projects.

**Variants.** `tsconfig.node.json` sets `module: NodeNext` and
`types: ["node"]`. `tsconfig.browser.json` sets `module: ESNext`,
`moduleResolution: Bundler`, `lib: ["ES2023", "DOM", "DOM.Iterable"]`,
`jsx: react-jsx`, and no `node` type inclusion.

**Per-project references.** `http-contracts`, `model-contracts`,
`serialization`, `browser-config`, and `runtime-config` are leaves.
`test-support` references the five leaves. Each app references only what its
`P0-02` boundary permits. The solution `tsconfig.json` references all of them.

**Build identity.** `scripts/build-id.mjs` resolves, in order:
`TTR_BUILD_ID`, then `git rev-parse --short HEAD`, then the literal
`unknown`. It prints one line and never reads an environment secret. Server
packages read `TTR_BUILD_ID` through `runtime-config`; the browser reads
`VITE_TTR_BUILD_ID`, injected at build time.

**Acceptance.**

1. `pnpm typecheck` builds every project through the solution file.
2. A fixture test asserts the browser project fails to compile a `node:fs`
   import (checked by an ESLint rule plus the absence of `node` types).
3. No `tsconfig` contains an absolute path.

### `P0-04` — Shared HTTP contract package

**Primitives.**

- `IdSchema`: non-empty string, 1–128 characters, no control characters.
- `IsoTimeSchema`: regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` plus a
  round-trip parse check.
- `IdempotencyKeySchema`: RFC 4122 UUID.
- `plainText(min, max)`: trims, rejects control characters and the markup
  characters `<` and `>`, then bounds grapheme clusters via `Intl.Segmenter`.
- `AskQuestionSchema` = `plainText(1, 500)`; `ClaimTextSchema` =
  `plainText(1, 500)`; `NoteTextSchema` = `plainText(1, 280)`;
  `DisplayNameSchema` = NFKC-normalized, whitespace-collapsed,
  2–24 grapheme clusters, letters/numbers/space/apostrophe/hyphen only.

**Schemas.** Every object is `.strict()`. Unions over a literal field use
`z.discriminatedUnion`. The complete set is the type list in Decision 006:
`PublicActor`, `LocationView`, `InspectableView`, `EncounterView`,
`InventoryItemView`, `RevealedItemView`, `DiscoveredClueView`,
`PromiseSubjectView`, `ActivePromiseView`, the four `CaseBoardEntryView`
members, `CaseBoardContradictionView`, `CaseAttemptView`,
`AccusationOptionView`, the three `ResolutionView` members, `PlayerView`,
the thirteen `ActionRequest` members, `NpcDialogue`, `PromiseOfferView`,
`DeniedActionResult`, the thirteen `ActionResultByKind` entries,
`CompletedActionResponse`, `ProcessingActionResponse`, `ProblemResponse`,
`HealthResponse`, `TownCreationResponse`, `InvitePreviewResponse`,
`JoinRequest`, and `JoinResponse`.

`CompletedActionResponse` is built by mapping each action kind to
`{ actionId, kind, status: "completed" } & ({ outcome: "applied" | "no_change";
result: <kind result> } | { outcome: "denied"; result: DeniedActionResult })`,
so a `denied` outcome can never carry a kind-specific result and an `applied`
outcome can never carry a `DeniedActionResult`.

**Fixtures and tests.**

1. Every union member accepts a documented-shape fixture.
2. Every union member rejects an added unknown property.
3. Cross-kind rejection: a `travel` result under `kind: "inspect"` fails; a
   `denied` outcome with a kind result fails; an `applied` outcome with a
   `DeniedActionResult` fails.
4. Leakage: a recursive walk over every player-safe schema's key set fails if it
   ever contains `revision`, `beliefScore`, `trustScore`, `suspicionScore`,
   `objectiveTruth`, `token`, `cookie`, `secret`, `password`, `sessionToken`,
   `promptText`, `sql`, or `row`.
5. Problem fixtures: a `ProblemResponse` carrying `stack`, `sql`, `query`, or
   `modelOutput` is rejected; `detail` values in the fixture set contain no
   stack-trace or SQL markers.
6. `API_VERSION === "v1"` and every exported route template starts with
   `/api/v1`.

### `P0-05` — Bedrock structured-output contracts

**Schemas.** Zod definitions mirroring the three checked-in files exactly,
including every `description` string, the `anyOf` nullable pattern, closed
enums, `additionalProperties: false`, and all-properties-required.

**Drift test.** For each schema: generate with `z.toJSONSchema(schema,
{ target: "draft-2020-12" })`, apply a documented normalization (drop `$schema`,
sort keys through the shared canonical serializer), read the checked-in file,
apply the same normalization, and assert deep equality. Failure prints both
canonical forms. The test never rewrites `docs/schemas/`.

**Version constants.**

- `PROMPT_VERSIONS`: `claim-normalization/1.0.0`, `npc-dialogue/1.0.0`,
  `ambient-choice/1.0.0`, `structured-repair/1.0.0`.
- `TASK_INPUT_VERSIONS`: `claim-normalization-input/1`,
  `npc-dialogue-input/1`, `ambient-choice-input/1`,
  `structured-repair-input/1` (see 9.2).
- `VALIDATION_POLICY_VERSIONS`: the three `*-validator/1.0.0` values; repair
  inherits its target's value.
- `OUTPUT_SCHEMA_NAMES`: `claim_normalization_v1`, `npc_dialogue_v1`,
  `ambient_choice_v1`.
- `INFERENCE_SETTINGS`: the temperature and max-token pairs from Decision 010.
- `REPAIR_VALIDATION_ERROR_CODES`: the eighteen permitted codes.

A comment on each export states that JSON Schema conformance is the first check
and that membership and semantic validation remain deterministic application
work owned by Phase 4.

### `P0-06` — Deterministic serialization primitives

**`canonicalJson(value): string`.** Recursively sorts object keys by code unit,
preserves array order, emits no insignificant whitespace, and throws
`CanonicalJsonError` for `undefined`, functions, symbols, `NaN`, `Infinity`,
`BigInt`, `Date`, `Map`, `Set`, class instances, and cycles.

**`digest.ts`.**

- `sha256Base64Url(input: string | Uint8Array): string`
- `domainSeparatedDigest(domain: string, payload: unknown): string` computing
  `base64url(SHA-256(domain + "\n" + canonicalJson(payload)))`
- `base64UrlUtf8(text: string): string` for the `promise-offer:v1` encoding

Callers supply every domain separator; the module hard-codes none.

**Tests.** Key reordering produces one output; array reordering produces two;
Unicode surrogate pairs and combining marks round-trip; nested empty
objects/arrays are stable; each rejected value type throws; and a child Node
process computing the same digest produces a byte-identical result.

### `P0-07` — Configuration

**Categories and variables.**

| Category | Entry point | Variables |
|---|---|---|
| Browser-public | `browser-config` | `VITE_TTR_ENV`, `VITE_TTR_BUILD_ID` |
| Game runtime | `runtime-config/game` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_LOG_LEVEL`, `TTR_APP_ORIGIN` |
| Ambient runtime | `runtime-config/ambient` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_LOG_LEVEL` |
| Recovery runtime | `runtime-config/recovery` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_LOG_LEVEL` |
| Deployment | `runtime-config/deployment` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_AWS_REGION`, `TTR_AWS_ACCOUNT` |
| Test | `runtime-config/test` | `TTR_E2E_API_PORT`, `TTR_E2E_WEB_PORT`, `TTR_E2E_BASE_URL` |
| Operator | `runtime-config/operator` | `TTR_MIGRATION_DATABASE_URL` |

`TTR_ENV` is `local | development | production`. Values default only for
`local`; `development` and `production` require an explicit `TTR_BUILD_ID`.

**Failure behavior.** A loader throws `ConfigurationError` whose message lists
the category and the offending variable names only. The error type carries a
structured `issues` array of `{ variable, category, code }`. No loader ever
places a value, or a substring of a value, in the message.

**Security tests.**

1. Missing required variable in `production` throws and names the variable.
2. Malformed enum or port throws without echoing the submitted value.
3. `browser-config` throws when any supplied key matches
   `/SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE|DATABASE_URL|JUDGE|SESSION/i`,
   even when `VITE_`-prefixed.
4. `browser-config` ignores every non-`VITE_TTR_` key, so a leaked server
   variable in the same process cannot reach the bundle.
5. Importing `runtime-config/operator` from a Lambda package is a boundary
   violation, proven by a negative fixture in the boundary test.

**`.env.example`** lists every name above with placeholders such as
`local`, `unknown`, `info`, `http://localhost:5173`, and
`postgresql://user:password@host:26257/db` — no real credential, and a header
comment stating that operator variables belong only to an operator shell.

### `P0-08` — Game API health shell

**Router.** A table of `{ method, template, handler }`. Matching is exact.
Unmatched path or method produces `404` with code `RESOURCE_NOT_FOUND`
(`D0-F`). Every response sets `Content-Type`, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and
`X-Request-Id`.

**Health handler.** Returns `{ status: "ok", build, time }`, validated against
`HealthResponseSchema` before serialization. `build` comes from
`runtime-config/game`. `time` is generated at request time in the canonical
format. The handler performs no I/O and imports no dependency client.

**Request ID.** `req_` plus 22 base64url characters from
`crypto.randomUUID()` bytes. Generated per request, never read from the
request.

**Logging.** One JSON line per request:
`{ event: "http_request", requestId, routeTemplate, method, status, durationMs, build, env }`.
`routeTemplate` is the matched template or the literal `unmatched`. The raw
path, query, headers, cookies, and body never reach the logger; the logger's
input type makes them unrepresentable.

**Local adapter.** `node:http` server binding `127.0.0.1` on
`TTR_E2E_API_PORT` (default `5174`), translating to and from the same internal
request/response objects the Lambda handler uses.

**Tests.**

1. `GET /api/v1/health` returns `200`, validates against the contract, and its
   body key set is exactly `status`, `build`, `time`.
2. The response contains no `database`, `bedrock`, `queue`, `secrets`, or
   `dependencies` key at any depth.
3. `GET /api/v1/towns`, `POST /api/v1/health`, and `/health` all return `404`
   problem+json with a stable code.
4. A captured log line for a request carrying a cookie, an authorization
   header, a query string, and a body contains none of those values.
5. Every response carries `X-Request-Id`, and two requests differ.

### `P0-09` — Ambient and Recovery worker shells

**Ambient envelope.** `AmbientJobMessageSchema` = strict
`{ version: "ambient-tick/1", townId: Id, outboxId: Id, jobKey: Id }`, matching
the Decision 005 statement that SQS carries only town, outbox, and job
identity. The handler parses `event.Records`, requires exactly one record
(batch size is one), parses its body, and returns
`{ outcome: "unsupported", ownerPhase: 5 }` for a valid envelope or
`{ outcome: "rejected", code: "invalid_envelope" }` otherwise.

**Recovery envelope.** `ScheduledEventSchema` = strict
`{ source: "aws.events", "detail-type": "Scheduled Event", time: IsoTime }`
subset. A valid event returns `{ outcome: "no_work", ownerPhase: 5 }`.

**No effects.** Neither handler imports a database, queue, or model client;
neither writes a file; neither performs a network call. A test asserts the
built module graph contains no AWS SDK or `node:net` import.

**Logging.** `{ event: "worker_invocation", requestId, worker, outcome, code }`
only. A test feeds a malformed body containing the marker string
`SENSITIVE-PAYLOAD-MARKER` and asserts it is absent from captured output.

### `P0-10` — React/Vite health shell

**States.** `loading` (`role="status"`, `aria-live="polite"`), `healthy`
(build identity and server time), and `unavailable` (a neutral message with a
retry button). The failure state never prints the fetch error, the response
body, or a dependency name.

**Fetch.** Relative `/api/v1/health`, validated with `HealthResponseSchema`.
An invalid body is treated as `unavailable`.

**Vite.** `server.proxy["/api"]` targets `http://127.0.0.1:${TTR_E2E_API_PORT}`.
The browser never constructs an absolute API URL.

**Asset manifest.** `resolveAssetKey(key)` returns
`{ state: "resolved", src }` or `{ state: "fallback" }` and calls
`recordAssetLookupFailure(key)` for the second case. The versioned manifest
registers the seven `bell-mystery-v1` keys from Decision 011 against a single
neutral placeholder; final illustrations are out of scope.

**Tests.** The three states render; the healthy state shows only build and
time; the failure state contains no dependency claim; an unknown asset key
yields the fallback and records exactly one client error; and a scan of the
rendered DOM finds no `VITE_`-prefixed variable value other than the two
allowed public ones.

### `P0-11` — CDK shell

**Structure.** `FoundationStack` creates one IAM-free construct set: three
`lambda.Function` definitions whose code assets are the built Lambda output
directories, with explicit `runtime: NODEJS_22_X`, `architecture: ARM_64`,
`memorySize`, and the Decision 007 timeouts (`28`, `30`, `30` seconds).
Environment contains only `TTR_ENV` and `TTR_BUILD_ID`. No bucket,
distribution, gateway, queue, schedule, secret, or alarm is created; each is
named in a `DEFERRED_TO_PHASE_7` constant list.

**Determinism.** `synth.mjs` sets a fixed stack name and passes explicit
`env`. Nothing reads the clock or a random source.

**Tests.** `Template.fromStack` assertions:

1. Exactly three functions exist with the expected timeouts.
2. No IAM statement has `Action: "*"` or `Resource: "*"`.
3. A recursive scan of the synthesized template finds no value matching the
   secret-name denylist and no value from a poisoned environment fixture.
4. Two synth runs of the same source produce identical template JSON.

### `P0-12` — Commands and test configuration

| Script | Definition |
|---|---|
| `format` | `prettier --write .` |
| `format:check` | `prettier --check .` |
| `lint` | `eslint .` |
| `typecheck` | `tsc -b tsconfig.json` |
| `test` | `vitest run` |
| `test:contracts` | `vitest run --project contracts` |
| `test:e2e` | `playwright test` |
| `build` | `tsc -b tsconfig.json && pnpm --filter @the-town-remembers/web build` |
| `cdk:synth` | `node scripts/synth.mjs` |
| `dev` | `node scripts/dev.mjs` |
| `validate` | the ordered aggregate below |

`validate` runs: `format:check`, `lint`, `check:boundaries`,
`test:boundaries`, `typecheck`, `test`, `build`, `cdk:synth`, `test:e2e`.

Vitest projects: `contracts` (node, `packages/http-contracts`,
`packages/model-contracts`, `packages/serialization`), `config` (node,
`packages/runtime-config`, `packages/browser-config`), `runtime-shells` (node,
`apps/game-api`, `apps/ambient-worker`, `apps/recovery-worker`), and `web`
(happy-dom, `apps/web`). Coverage is collected for the five shared packages
with a `statements`/`branches`/`functions`/`lines` floor of 90; application
shells are excluded because their boundary proof is behavioral.

Playwright uses `TTR_E2E_WEB_PORT` (default `5173`), starts the API and Vite
through `scripts/dev.mjs`, runs Chromium only, and disables retries so a flaky
gate cannot pass silently.

### `P0-13` — CI baseline

`.github/workflows/ci.yml` on `push` and `pull_request`:

1. `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`.
2. `actions/checkout`, `actions/setup-node` with `node-version-file:
   .node-version`, `corepack enable`.
3. Cache the pnpm store keyed on `pnpm-lock.yaml`.
4. `pnpm install --frozen-lockfile`.
5. `pnpm exec playwright install --with-deps chromium`.
6. `pnpm validate`.
7. On failure, upload `playwright-report/` and `test-results/` only.

`scripts/check-artifact-safety.mjs` runs before upload and fails if any
candidate path contains a `.env` file, a `*.pem`, or a file matching the secret
denylist. No AWS or database credential is referenced anywhere in the workflow.

### `P0-14` — Documentation

`CONTRIBUTING.md` gains: prerequisites and bootstrap, the command table, local
health startup, the configuration-category table, a contract-change procedure
(accepted decision first, then Zod schema, JSON snapshot, and tests together),
logging rules with a secret-redaction checklist, a common-failures table, and a
deferred-work table naming the owning phase for every shell.

`README.md` gains a short "run it locally" section pointing at the same
commands.

## 6. Goals

Phase 0 is finished when every goal below is objectively true. Each maps to the
phase exit checklist.

All fifteen goals are met. The proof for each was executed on a fresh clone,
not on the working copy, so stale build output could not mask a failure.

| Goal | Proof |
|---|---|
| `G1` | `pnpm install --frozen-lockfile` succeeds on Node 24.18.0 from a clean checkout |
| `G2` | `pnpm format:check` and `pnpm lint` pass |
| `G3` | `pnpm typecheck` builds every project |
| `G4` | `pnpm test:contracts` proves every HTTP union member, its rejections, and the leakage rules |
| `G5` | All three `docs/schemas/*.json` files pass the drift test unchanged |
| `G6` | Configuration fixtures fail closed and never echo values |
| `G7` | Health returns liveness/build/time only and claims no dependency readiness |
| `G8` | Worker shells reject malformed events with no external effect |
| `G9` | Captured logs contain no URL, body, header, cookie, token, or secret |
| `G10` | `pnpm build` produces web, five library, and three Lambda outputs |
| `G11` | `pnpm cdk:synth` is deterministic, secret-free, and wildcard-free |
| `G12` | `pnpm test:e2e` drives a real browser through health and the API-down state |
| `G13` | `pnpm validate` passes as one command |
| `G14` | CI runs the identical gate with concurrency cancellation and safe artifacts |
| `G15` | Setup, boundaries, configuration, logging, and deferred owners are documented |

## 7. Execution order

```text
P0-03 -> P0-04 -> P0-06
P0-03 -> P0-05
P0-03 -> P0-07
P0-04 + P0-07 -> P0-08 -> P0-10
P0-07 -> P0-09
P0-08 + P0-09 + P0-10 -> P0-11
all -> P0-12 -> P0-13 -> P0-14
```

Each task lands as its own commit once its own tests pass. The aggregate gate
runs after `P0-12` and again after `P0-14`.

## 8. Risks carried into execution

| Risk | Mitigation |
|---|---|
| `z.toJSONSchema` output differs structurally from the checked-in snapshots | Normalize both sides; if generation cannot be made stable, hand-maintain the three small schemas and keep the deep-equality test, as the phase plan's fallback allows |
| `exactOptionalPropertyTypes` conflicts with library types | Confine the conflict to adapter modules rather than relaxing the flag |
| Playwright browser download is unavailable | The e2e gate is reported as blocked with its exact failure rather than skipped silently |
| A shell reads as a working integration | Every shell returns an explicit unsupported outcome and carries a `Phase N owns this` marker |

## 9. Discrepancies found while planning

### 9.1 Health-route timestamp precision

Decision 006 defines `IsoTime` as "UTC RFC 3339 with exactly three fractional
digits", but its health example shows `"2026-08-02T00:00:00Z"`. This plan
implements the canonical three-digit form everywhere (`D0-H`) so one timestamp
rule governs the whole API. The example is illustrative; if the accepted
document should instead permit a second timestamp form, that is a Decision 006
amendment, not an implementation choice.

### 9.2 Task-input version count

The Phase 0 plan text says `P0-05` exports "three task-input versions".
Decision 010 defines four, including `structured-repair-input/1`. The decision
is normative, so all four are exported.

### 9.3 Toolchain availability

`P0-01` pinned Node `24.18.0`. That version was not present on the development
machine and was installed before execution began. `pnpm install` fails closed on
any other runtime, which is the intended `P0-01` behavior.

## 10. Result

`pnpm validate` passes end to end from a fresh `git clone` with no environment
variable set and no secret available. It runs, in order: formatting, workspace
boundaries, tooling tests, strict type-checking of every project, type-aware
lint, 291 unit and contract tests with coverage thresholds on the shared
packages, every build, the browser bundle safety check, deterministic CDK
synthesis, and a six-case Chromium health journey.

Two findings were surfaced by the exit checks rather than by review:

1. The aggregate gate linted before type-checking. On a working copy with
   stale `dist` output it passed; on a fresh clone every cross-package type was
   unresolvable. Fixed in `af61244`.
2. React StrictMode double-invokes effects in development, so the browser
   journey's request-count assertion was not stable. The assertion now checks
   that the health path is the only API path the page requests, which is the
   property that actually matters.

The CI workflow has not yet executed: this branch has no remote. It runs the
same `pnpm validate` command that passes locally, plus the artifact-safety
check, so its first run is expected to be a confirmation rather than a
discovery.
