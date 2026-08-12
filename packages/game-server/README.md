# `@the-town-remembers/game-server`

The synchronous game API: routing, the uniform failure boundary, session
authentication, the durable action claim/execute/commit machinery, and
structured logging/metrics. This package has no HTTP listener of its own —
`apps/game-api` (a thin Lambda/local adapter) is the only thing that binds a
socket and calls `routeRequest`. See
[`../../implementation-plans/phase-03-execution-detail.md`](../../implementation-plans/phase-03-execution-detail.md)
for the full plan this package implements; this README is the
implementer-facing summary a later phase actually needs.

## Starting the pair

```sh
pnpm db:up          # local CockroachDB, once per machine session
pnpm db:migrate      # apply schema migrations, once per fresh database
pnpm dev             # apps/game-api on TTR_API_PORT, apps/web on TTR_WEB_PORT
```

`pnpm dev` runs `scripts/dev.mjs`, which starts both from one place so their
ports cannot disagree — the same pair `e2e/phase-03-first-playable.spec.ts`
and a browser session both talk to. Pass `--api-only` to start just the API
adapter (what Playwright does for every `e2e/*.spec.ts` file — the browser
journey needs a real backend, but the mocked specs only need it to answer
`/health`).

Local development needs a real `.env` (copied from `.env.example`) — none of
`TTR_JUDGE_CODE`, `TTR_INVITE_SIGNING_KEYS`, `TTR_SESSION_TOKEN_PEPPER`, or
`TTR_IP_HASH_SECRET` has a committed default, on purpose (`runtime-config/security`
fails closed rather than inheriting a guessable one).

## Seeding a town

Two ways, for two different purposes:

- **Through the real route**, for anything that should exercise the
  creation ledger (idempotency, rate limiting, the actual response the
  client will parse):

  ```sh
  curl -s -X POST http://localhost:5174/api/v1/towns \
    -H "Authorization: Bearer $TTR_JUDGE_CODE" \
    -H "Origin: $TTR_APP_ORIGIN" \
    -H "Idempotency-Key: $(node -e 'console.log(crypto.randomUUID())')" \
    -H "Content-Type: application/json" -d '{}'
  ```

  Returns `{ townId, status, inviteUrl }`. Open `inviteUrl` in a browser to
  join as a player. `e2e/phase-03-first-playable.spec.ts` does exactly this,
  twice with the same idempotency key, as its first acceptance step.

- **Directly via `@the-town-remembers/town-seed#materializeTown`**, for a
  test that only needs a town to already exist and does not care how —
  every `*.db.test.ts` file in this package does this. It skips the
  creation ledger entirely, so never use it to test creation itself.

## Running each suite

| Command | What it covers |
|---|---|
| `pnpm test:api` (`vitest run --project api`) | Pure logic: schema validation, the executor's branching, the security scans in `src/security/` — no database |
| `pnpm db:up && TTR_REQUIRE_DB_TESTS=1 vitest run --project database packages/game-server` | Every `*.db.test.ts` here, against a real disposable CockroachDB |
| `pnpm test:e2e` | The full browser journeys, including `phase-03-first-playable.spec.ts` against a real running pair and its own disposable database |

Do not run the full coverage suite (`pnpm test`) on every small change while
iterating — see the repository's own `CLAUDE.md` for the scoped-run
workflow this package's own development used throughout Phase 3.

## Reading action recovery

Every player action (`start_visit`, `travel`, `inspect`, `leave` — the only
four kinds enabled this phase) goes through one shared path,
`application/actions/executor.ts#executeAction`, in five steps: claim
(`persistence/actions.ts#claimAction`) → load per-kind inputs → call the
pure planner (`@the-town-remembers/rules`) → build and schema-validate the
response → commit effects, numbered events, and the response atomically
(`application/actions/commit.ts`, `persistence/actions.ts#runCompleteActionUpdate`).

Three things can happen mid-flight that are not failures, each logged as an
`action_lifecycle` event (`observability/events.ts`) and counted as an
`metric_action_processing`/`metric_action_processing_exhausted` point
(`observability/metrics.ts`):

- **A town-revision conflict** (someone else committed between this
  attempt's read and its write): the whole plan reruns once
  (`MODEL_RETRIES.townRevisionRerunLimit`), logged `conflict_retry`; a
  second conflict after that stores a `409 ACTION_CONFLICT` the client
  retries, logged `conflict_exhausted`.
- **A takeover** (a prior attempt's processing claim expired without
  completing, and a new attempt reclaims it): logged `takeover` from
  `persistence/actions.ts`, distinct from the executor's own conflict
  handling — the claim ledger and the per-plan rerun loop are two different
  retry mechanisms that happen to share the word "retry" in casual
  conversation but never in a log line.
- **An ambiguous commit** (the connection died at the exact moment the
  database might have already acknowledged `COMMIT`): the durable ledger is
  read back rather than guessed at (`D3-O`), logged `ambiguous_resolved`
  with which way it actually landed.

`packages/game-server/src/observability/action-lifecycle.db.test.ts` and
`packages/game-server/src/persistence/actions.test.ts` prove all three from
captured stdout, not from a spy — the second of those two uses a scripted
`pg.Pool` double for the ambiguous-commit case specifically, since no route
in this phase can provoke a genuinely ambiguous commit against a real engine
on demand.

## Deliberate Phase 4/5 exclusions

This package recognizes all thirteen `ACTION_KINDS`
(`@the-town-remembers/http-contracts`) but only routes four of them
(`application/actions/enabled.ts#requireEnabledActionKind`). The other nine
are deliberately unbuilt here, not merely unfinished:

- **`ask`, `normalize_claim`, `tell`, `show`, `give`, `accept_promise`** —
  the six model-backed kinds. `@the-town-remembers/rules` already builds
  their `external_selection_required` seam and bounded
  `ApprovedDisclosureBundle`; calling the model and resuming with
  `resumeWithDialogue` is Phase 4's job, not this package's. A request for
  one of these kinds today gets the same `404`-equivalent
  `RESOURCE_NOT_FOUND` an unmatched route returns — never a fabricated
  success.
- **`add_note`, `accuse`, `resolve`** — the case-board and resolution
  kinds, Phase 6.
- **Ambient propagation** (gossip spreading between visits) — Phase 5's
  `apps/ambient-worker`. `leave`'s response always reports
  `transitionStatus: "not_required"` this phase (`D3-Q`): Phase 3 can never
  produce an ambient-eligible event for a worker to pick up, so the
  browser's away screen has no time-passes stage to build yet.

A shell in an unbuilt phase must report that the work is unavailable, never
return a fabricated success — the same rule `../../CONTRIBUTING.md`'s
"Deferred work" table states for every other workspace.
