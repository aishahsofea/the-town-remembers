# Contributing

## Bootstrap

Use Node.js `24.18.0` and bootstrap the repository with the integrity-pinned
pnpm `11.20.0` release:

```sh
corepack pnpm install --frozen-lockfile
```

Install rejects any other runtime, so a version mismatch fails immediately
rather than producing a build that only works on one machine. No application
secret is required to install, build, test, or run the local health journey.

The browser journey needs one Chromium download:

```sh
corepack pnpm exec playwright install chromium
```

## Commands

Run the aggregate gate before submitting anything. It is the exact command CI
runs, in the same order, so a local pass and a CI pass mean the same thing.

```sh
corepack pnpm validate
```

| Command | What it checks |
|---|---|
| `pnpm format:check` | Prettier formatting of code and configuration |
| `pnpm check:boundaries` | Package ownership, exports, and dependency direction |
| `pnpm test:tooling` | The repository scripts in `scripts/` |
| `pnpm typecheck` | Strict build of every project plus the test-only programs |
| `pnpm lint` | ESLint with type-aware rules across every project |
| `pnpm test` | Contract, configuration, runtime-shell, and browser-component tests, with coverage thresholds on the shared packages |
| `pnpm test:api` | `packages/game-server`'s pure suites — schema validation, executor branching, the security scans in `src/security/` — no database |
| `pnpm test:contracts` | The executable HTTP and Bedrock contracts alone |
| `pnpm test:db` | Schema, grant, constraint, transaction, vector, seed, inspection, and `game-server`'s own `*.db.test.ts` suites against real CockroachDB |
| `pnpm test:content` | The authored `bell-mystery-v1` registry and its validators |
| `pnpm build` | Library declarations, three Lambda bundles, and the web bundle |
| `pnpm check:bundle` | The built browser bundle carries no server concern or credential |
| `pnpm cdk:synth` | Deterministic CDK synthesis into `cdk.out/` |
| `pnpm test:e2e` | The browser health journey, the invite/join bootstrap journey, and `phase-03-first-playable` — the full create/join/travel/inspect/leave/away/return journey against a real running pair and its own disposable database (`e2e/global-teardown.ts`, `packages/game-server/README.md`) |
| `pnpm validate` | All of the above, in dependency order |

`pnpm typecheck` comes before `pnpm lint` on purpose. Packages resolve each
other through their `dist` declarations, so type-aware lint rules need the
ordered build to have run. `pnpm lint`, `pnpm test:e2e`, and `pnpm cdk:synth`
all read built output; run `pnpm typecheck` or `pnpm build` first when invoking
them on their own.

## Working with the database

Phase 1 verifies persistence against real CockroachDB, never a mock. A mock
cannot refute a composite foreign key, a partial unique index, a vector index,
or a serialization conflict, and those are precisely what the schema promises.

`pnpm db:up` downloads one pinned build into an ignored `.cockroach/` and starts
a single insecure node on the loopback interface. Docker is not involved.

```sh
corepack pnpm build
corepack pnpm db:up
corepack pnpm db:doctor
```

The build comes first because the operator commands import workspace packages
through their `dist` output, the same reason `pnpm typecheck` precedes
`pnpm lint`. On a fresh checkout `db:doctor`, `db:migrate`, and `db:seed` fail
with a missing-module error until something has built.

Only one node can hold port 26257, and every checkout resolves the same
`127.0.0.1:26257` by default. Start it once from whichever checkout you like;
`db:up` in another sees the running node and reuses it rather than downloading
a second 1.9 GB copy.

`db:migrate` and `db:seed` additionally need the operator credential, which
never defaults:

```sh
export TTR_MIGRATION_DATABASE_URL="postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable"
```

The test suite does not need it. It creates its own disposable databases
through the test category, which does default to the local node.

| Command | What it does |
|---|---|
| `pnpm db:up` | Starts the pinned local node, downloading it on first use |
| `pnpm db:status` | Reports whether anything is listening |
| `pnpm db:down` | Stops the node; the store survives |
| `pnpm db:doctor` | Proves the target supports vectors, predicated vector indexes, discriminated foreign keys, partial unique indexes, and transactional DDL |
| `pnpm db:migrate` | Applies forward migrations with `TTR_MIGRATION_DATABASE_URL` |
| `pnpm db:seed` | Materializes one inspectable `bell-mystery-v1` town |
| `pnpm db:snapshot` | Regenerates `packages/database-admin/schema-snapshot.json` |
| `pnpm db:types` | Regenerates the Kysely interface from that snapshot |

The integration suite creates its own `ttr_test_<random>` database per test
file, migrates it, and drops it. Teardown validates that prefix before issuing
`DROP DATABASE`, because the prefix is the only thing standing between a
mistyped DSN and a real database.

`TTR_SKIP_DB_TESTS=1` skips the suite for a contributor without the binary.
`pnpm validate` sets `TTR_REQUIRE_DB_TESTS=1`, and the two together are an
error, so the gate cannot pass by skipping the part of the phase that matters
most.

### Three credentials, three categories

| Identity | Variable | Held by | May |
|---|---|---|---|
| `migration_admin` | `TTR_MIGRATION_DATABASE_URL` | An operator shell | Change the schema |
| `app_runtime` | `TTR_DATABASE_URL` | A Lambda | Read and write game state; delete only expired rate-limit buckets |
| `inspection_reader` | CockroachDB managed MCP | Judges and developers | Read the thirteen `inspection` views and nothing else |

Only `packages/database-admin` may read the operator category, and only
`packages/database` may read the runtime one. The workspace boundary check
enforces both, so a credential cannot reach a request path by accident.

Outside `TTR_ENV=local`, a runtime DSN that does not request
`sslmode=verify-full` is refused.

### Changing the schema

Migrations are forward-only. Recovery from a bad migration is another
migration, never a destructive reset.

1. Read the accepted contract first. Decision 005 settles the entity
   boundaries, value domains, and required indexes; a migration that disagrees
   with it is a contract change, not an implementation detail.
2. Add `NNNN_lower_snake_case.sql`. Never edit an applied file — the runner
   compares checksums and refuses the whole run, naming the version.
3. Render closed domains from `packages/database/src/domains.ts` with
   `{{DOMAIN_NAME}}`. An unsubstituted placeholder is invalid SQL, so a typo
   fails at apply time rather than creating a check that matches nothing.
4. Update `ACCEPTED_TABLES` or `ACCEPTED_VIEWS` in `expected-schema.ts` if the
   inventory changed.
5. Run `pnpm db:snapshot`, then `pnpm db:types`, and read both diffs. The
   snapshot is the reviewable record of what the migrations produce, and the
   generated interface follows from it — one chain with no weak link, since a
   hand-written interface could be wrong in a way no test would notice until a
   query returned the wrong shape.
6. Review the grants in `0013_grants.sql`. A new table is unreachable by
   `app_runtime` until it is listed there.
7. Confirm the seed still materializes: `pnpm test:db`.

### When a migration fails

The file and its ledger row commit together, so a failure leaves neither. Fix
the SQL and run `pnpm db:migrate` again.

If a migration has already been applied and turns out to be wrong, write a new
one that corrects it. Editing the applied file makes the next run abort before
executing anything, which is the intended behavior: the database and the
repository disagree about history, and only a human can say which is right.

## Running the health journey locally

```sh
corepack pnpm build
corepack pnpm dev
```

`pnpm dev` starts the Game API adapter on `TTR_API_PORT` and Vite on
`TTR_WEB_PORT`, then the page at `http://127.0.0.1:5173` calls
`/api/v1/health` through the Vite proxy. That is the same relative path the
deployed application serves through CloudFront and API Gateway, so a local
convenience cannot hide a production routing mistake.

The page is a foundation diagnostic, not the game shell from Decision 011. It
reports API liveness, build identity, and server time, and it claims nothing
about CockroachDB, Bedrock, SQS, or Secrets Manager.

## Playing the Phase 3 slice locally

With the pair running, `pnpm town:new` creates one town through the real
judge-authenticated route and prints its invite URL; opening that URL in a
browser starts the join/travel/inspect/leave journey. Town creation belongs to
an operator, not a player, so it is the one step with no screen behind it —
everything after the invite is the actual UI. Passing the printed idempotency
key back (`pnpm town:new <key>`) replays the creation rather than making a
second town. See
[`packages/game-server/README.md`](packages/game-server/README.md) for what
each route does and which nine action kinds this phase deliberately does not
serve.

## Configuration

Every variable is documented with a safe placeholder in `.env.example`. Copy it
to `.env` for real local values; `.env` is ignored. Committed non-secret
defaults live in `.env.defaults` and are read only by repository tooling — the
runtime loaders never read a file, so a deployed Lambda missing its variables
still fails closed.

| Category | Import path | Variables |
|---|---|---|
| Browser-public | `@the-town-remembers/browser-config` | `VITE_TTR_ENV`, `VITE_TTR_BUILD_ID` |
| Game runtime | `runtime-config/game` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_LOG_LEVEL`, `TTR_APP_ORIGIN`, `TTR_API_PORT` |
| Ambient runtime | `runtime-config/ambient` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_LOG_LEVEL` |
| Recovery runtime | `runtime-config/recovery` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_LOG_LEVEL` |
| Deployment | `runtime-config/deployment` | `TTR_ENV`, `TTR_BUILD_ID`, `TTR_AWS_REGION`, `TTR_AWS_ACCOUNT` |
| Test harness | `runtime-config/test` | `TTR_API_PORT`, `TTR_WEB_PORT` |
| Operator only | `runtime-config/operator` | `TTR_MIGRATION_DATABASE_URL` |

Rules that the tests enforce rather than merely describe:

- Loaders fail closed. A default applies only when `TTR_ENV` is `local`, so a
  deployed environment cannot start on a fallback.
- A configuration error names the category and the offending variables. It
  never contains a value, because the only observable output is a log line.
- Browser configuration refuses to build when any `VITE_`-prefixed name looks
  like a credential. The mistake being caught is a secret given a browser
  prefix, not a secret being read there.
- The operator migration credential is reachable only through
  `runtime-config/operator`, and the boundary check rejects that import from
  every deployment unit.

## Logging and secret redaction

Server shells write one JSON object per line straight to stdout. Redaction is
structural, not procedural: each shell's log event type is closed, so there is
no field a secret could travel in.

Before adding a log field, confirm every line:

- [ ] The event type is a closed interface, not `Record<string, unknown>`.
- [ ] No raw URL, path, or query string. Log the route template, or the literal
      `unmatched`.
- [ ] No header, cookie, authorization value, invite token, or join secret.
- [ ] No request body, queue message body, or model output.
- [ ] No environment value. The deployment tier name and build identity are
      safe; a variable's value is not.
- [ ] An unrecognized enum-like value folds to a fixed label rather than being
      passed through.
- [ ] A rejection is reported as a stable code, never as the input that caused
      it.

`@the-town-remembers/test-support` exports the marker values and forbidden
property names those assertions use. Add a redaction test with every new log
event.

## Changing an accepted contract

Semantics live in `docs/`, not in code. When a contract must change:

1. Amend the accepted decision document first, and say why.
2. Update the Zod schema and, for a Bedrock output, the checked-in snapshot in
   `docs/schemas/` in the same change.
3. Update the fixtures and drift tests alongside them.
4. Never edit a snapshot to make a test pass. The drift test compares
   generation against the accepted file precisely so that cannot happen.

A structural change — a package split, a file move, a script rename — needs
only this guide updated. An authority change does not.

## Rules package

`packages/rules` is the deterministic simulation core: every belief,
relationship, disclosure, world-state, recall, ambient, board, and action
rule Decision 008 (and 005/006/009/010/011) fixes, as pure functions with no
database client, model client, or queue. See
[`packages/rules/README.md`](packages/rules/README.md) for the
authority-boundary pattern, the five-step action order, the stable-ordering
and external-selection-seam catalogs, and worked handoff examples for the
phases that call it.

`pnpm test:rules` runs its suite alone;
`pnpm test:rules -- <topic>` (e.g. `beliefs`, `ambient`, `determinism`) uses
vitest's positional filename filter against the file-naming convention its
tests follow. `pnpm rules:scenario [<scenario-name>]` replays one of the
named golden scenarios and prints its ordered plan and digest.

## Game server package

`packages/game-server` is the synchronous game API: routing, session
authentication, the durable action claim/execute/commit machinery
(`application/actions/executor.ts`), and structured logging/metrics
(`observability/`). It calls `@the-town-remembers/rules`' pure planners for
steps 1–3 of the five-step action order above and owns steps 4–5 for the
four action kinds this phase enables. See
[`packages/game-server/README.md`](packages/game-server/README.md) for
starting the local pair, seeding a town two different ways, running each of
its suites, reading the three non-failure things that can happen mid-action
(a town-revision retry, a takeover, an ambiguous commit — each logged and
counted, never silently retried), and exactly which action kinds this phase
deliberately does not route yet.

Everything in this package runs entirely locally, against the same local
CockroachDB `pnpm db:up` starts — no public-cloud deployment exists yet
(Phase 7's own job; see "Deferred work" below).

## Deferred work

Every shell names the phase that replaces it. `apps/game-api`,
`packages/rules`'s orchestration, and `packages/town-seed` are Phase 3 work
and have moved off this table — see
[`packages/game-server/README.md`](packages/game-server/README.md)'s own
"Deliberate Phase 4/5 exclusions" for the nine `ACTION_KINDS` Phase 3 still
does not route, and why that is a boundary, not a gap.

| Shell | Current behavior | Owning phase |
|---|---|---|
| `apps/game-api` routes | Four action kinds (`start_visit`/`travel`/`inspect`/`leave`) plus town creation, invite, join, and player-view; the other nine action kinds `404` | Phase 4 (six model-backed kinds) and Phase 6 (`add_note`/`accuse`/`resolve`) |
| `apps/ambient-worker` | Parses the envelope, then reports `unsupported` | Phase 5 |
| `apps/recovery-worker` | Validates the schedule, then reports `no_work` | Phase 5 |
| `apps/web` health page | Foundation diagnostic, not the game shell | Phase 6 (asset manifest) |
| `apps/web` asset manifest | Every authored key resolves to a placeholder | Phase 6 |
| `apps/web` away screen | No time-passes stage — `leave` always reports `transitionStatus: "not_required"` this phase (`D3-Q`) | Phase 5 |
| `infrastructure` stack | Lambda bundling contracts only | Phase 7 |
| Bedrock contracts | Wire shapes only; no semantic validator | Phase 4 |
| Repository layer | Schema and transaction primitives only; no typed repositories | Later phases, as the need arises |
| Production database | Local pinned node only; no cluster, secrets, or managed MCP | Phase 7 |

A shell must report that unsupported work is unavailable. None of them may
return a fabricated success for persistence, model, queue, or gameplay work.

## Common failures

| Symptom | Cause and fix |
|---|---|
| `Unsupported engine` on install | The runtime is not Node `24.18.0`. Switch versions; the pin is deliberate. |
| `ERR_PNPM_OUTDATED_LOCKFILE` | A manifest changed without the lockfile. Re-run `corepack pnpm install`. |
| `No inputs were found in config file` | A package has a `tsconfig.json` but no source yet. Add the source or remove the project reference. |
| `was not found by the project service` | A new file is outside every program. Add its directory to the ESLint `project` list. |
| `Cannot find module .../dist/...` | `pnpm build` has not run. `test:e2e` and `cdk:synth` read built output. |
| A wave of `no-unsafe-*` lint errors on a fresh clone | `dist` does not exist yet, so cross-package types are unresolvable. Run `pnpm typecheck` first. |
| Playwright times out waiting for a server | Another process holds `TTR_API_PORT` or `TTR_WEB_PORT`. Both use `strictPort`. |
| `phase-03-first-playable.spec.ts` 403s on town creation, or its DB queries find nothing | A `pnpm dev` (or an earlier `test:e2e` run) left a stale server bound to `TTR_API_PORT`/`TTR_WEB_PORT`; `reuseExistingServer` then reuses it instead of spawning a fresh one with this run's disposable database and `TTR_APP_ORIGIN` override. Kill whatever holds those ports and rerun. |
| Configuration error naming `TTR_ENV` | The variable is unset and `.env.defaults` was not read. Only repository tooling loads it; a bare `node` invocation must set it. |

## Workspace ownership

| Workspace | Responsibility | Public package surface |
|---|---|---|
| `apps/web` | React/Vite browser client | None; deployment unit |
| `apps/game-api` | Synchronous game HTTP API | None; deployment unit |
| `apps/ambient-worker` | Delayed ambient world processing | None; deployment unit |
| `apps/recovery-worker` | Scheduled recovery processing | None; deployment unit |
| `infrastructure` | AWS CDK deployment definitions | None; deployment unit |
| `packages/http-contracts` | Player-safe HTTP request and response contracts | Root export |
| `packages/model-contracts` | Bedrock structured-output contracts | Root export |
| `packages/serialization` | Shared wire and persistence serialization | Root export |
| `packages/browser-config` | Browser-safe configuration | Root export |
| `packages/runtime-config` | Role-specific server and operator configuration | Named role subpaths only |
| `packages/test-support` | Fixtures and helpers used only by tests | Root export |

Shared-package export maps point at `dist` outputs produced by `pnpm build`.
Source files are never exposed from a package manifest: a consumer that could
reach into another package's `src` would bypass both its public surface and the
boundary check.

`runtime-config` has no root export. Import the narrow surface for the current
role: `game`, `ambient`, `recovery`, `deployment`, `test`, or `operator`.

## Dependency direction

The browser can depend only on `http-contracts` and `browser-config`. The game
API can depend on `http-contracts`, `model-contracts`, `serialization`, and its
`runtime-config/game` surface. The ambient worker can depend on
`model-contracts`, `serialization`, and `runtime-config/ambient`. The recovery
worker can depend only on `runtime-config/recovery`. Infrastructure can consume
only `runtime-config/deployment` and must not acquire application or domain
logic.

Application deployment units never depend on one another. Shared production
packages never depend on applications or infrastructure. `test-support` may
consume shared packages, but production workspaces may reference
`test-support` only from `devDependencies`.

All internal dependencies use the exact `workspace:*` specifier. Import another
workspace by its `@the-town-remembers/*` package name; relative imports that
cross package roots are forbidden. These rules keep browser configuration free
of secrets, infrastructure free of game rules, and deployment units
independently buildable.

## Adding or changing a workspace package

When a new workspace is justified:

1. Add its path and canonical package name to
   `scripts/check-workspace-boundaries.mjs`.
2. Declare only permitted internal dependencies with `workspace:*`.
3. Give shared packages a `dist`-only export map; give deployment units no
   exports.
4. Update the ownership and dependency-direction sections above.
5. Regenerate `pnpm-lock.yaml` with the pinned pnpm release.
6. Add a negative boundary fixture for every new dependency or export rule.
7. Add its `tsconfig.json`, add it to the root solution and the ESLint program
   list, and give it a test project in `vitest.config.ts`.
8. Run `pnpm validate` and a frozen install from a clean checkout.

Toolchain upgrades are one atomic change: update `package.json`,
`pnpm-workspace.yaml`, `.node-version`, the package-manager integrity pin, and
`pnpm-lock.yaml` together.
