# Working in this repo

## Test coverage: don't run the full suite on every iteration

`vitest.config.ts`'s `coverage.thresholds` (`branches: 88`, `statements`/`functions`/`lines: 90`)
is checked **globally**, across every `packages/*/src/**/*.ts` file in the
monorepo at once — there is no per-package or per-PR threshold. That means
the only way to know the true pass/fail number is `pnpm test` (or
`TTR_REQUIRE_DB_TESTS=1 pnpm test` to include the CockroachDB-backed suites),
and that run takes roughly **9–10 minutes**: 1373+ tests across every
workspace package, including `database`-project tests that run serialized
against a real local CockroachDB rather than in parallel.

Do not run the full coverage suite after every small fix while closing a
coverage gap or debugging a failing test — it is far too slow to be a tight
feedback loop. Instead:

1. Iterate with scoped runs while developing or fixing gaps:
   - `vitest run --project api packages/<pkg>` for pure/unit tests (fast,
     no DB).
   - `TTR_REQUIRE_DB_TESTS=1 vitest run --project database packages/<pkg>/src/path/to/file.db.test.ts`
     for one DB-backed file (still needs `pnpm db:up` running, but only pays
     for the tests actually touched — seconds, not minutes).
2. To find *which specific branches* are uncovered in a file you just
   touched, run once with a JSON reporter and inspect it — this is far
   faster than reasoning about `text-summary` percentages alone:
   ```bash
   TTR_REQUIRE_DB_TESTS=1 pnpm exec vitest run --coverage --coverage.reporter=json --coverage.reporter=text-summary
   ```
   then read `coverage/coverage-final.json`'s `b`/`branchMap` for the file(s)
   you're working on (a short Node script filtering by file path is the
   fastest way — see any recent session for the exact snippet).
3. Only run the full suite (or the full coverage suite) once, as the final
   gate, when you believe the change is actually done — not as a debugging
   tool.

This matters more as Phase 3 (and later phases) grow: burning 10 minutes per
iteration on a coverage gate compounds fast across many commits in one
phase. The scoped-run-first, full-run-last workflow is the accepted default
for this repo, not just a one-off shortcut.
