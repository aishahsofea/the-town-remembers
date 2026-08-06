# Contributing

## Bootstrap

Use Node.js `24.18.0` and bootstrap the repository with the integrity-pinned
pnpm `11.20.0` release:

```sh
corepack pnpm install --frozen-lockfile
```

No application secrets are required to install the empty workspace skeleton.
Run the repository boundary checks before submitting workspace changes:

```sh
corepack pnpm check:boundaries
corepack pnpm test:boundaries
```

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

Shared-package export maps intentionally point to future `dist` outputs. P0-03
owns TypeScript configuration, source entry points, and build generation; source
files must not be exposed from package manifests in the meantime.

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
7. Run `check:boundaries`, `test:boundaries`, and a frozen install from a clean
   checkout.

Toolchain upgrades are one atomic change: update `package.json`,
`pnpm-workspace.yaml`, `.node-version`, the package-manager integrity pin, and
`pnpm-lock.yaml` together.
