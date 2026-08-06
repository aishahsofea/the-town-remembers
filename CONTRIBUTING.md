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
| `pnpm test:contracts` | The executable HTTP and Bedrock contracts alone |
| `pnpm build` | Library declarations, three Lambda bundles, and the web bundle |
| `pnpm check:bundle` | The built browser bundle carries no server concern or credential |
| `pnpm cdk:synth` | Deterministic CDK synthesis into `cdk.out/` |
| `pnpm test:e2e` | The browser health journey |
| `pnpm validate` | All of the above, in dependency order |

`pnpm typecheck` comes before `pnpm lint` on purpose. Packages resolve each
other through their `dist` declarations, so type-aware lint rules need the
ordered build to have run. `pnpm lint`, `pnpm test:e2e`, and `pnpm cdk:synth`
all read built output; run `pnpm typecheck` or `pnpm build` first when invoking
them on their own.

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

## Deferred work

Every shell in this phase names the phase that replaces it.

| Shell | Current behavior | Owning phase |
|---|---|---|
| `apps/game-api` routes | Health only; every other path returns `404` | Phase 3 |
| `apps/ambient-worker` | Parses the envelope, then reports `unsupported` | Phase 5 |
| `apps/recovery-worker` | Validates the schedule, then reports `no_work` | Phase 5 |
| `apps/web` health page | Foundation diagnostic, not the game shell | Phases 3 and 6 |
| `apps/web` asset manifest | Every authored key resolves to a placeholder | Phase 6 |
| `infrastructure` stack | Lambda bundling contracts only | Phase 7 |
| Bedrock contracts | Wire shapes only; no semantic validator | Phase 4 |
| `packages/serialization` | Primitives only; no player-view projection | Phase 2 |

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
