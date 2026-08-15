# Test-policy rollout status

- **Deterministic enforcement:** live now, for every commit, not deferred to
  a future phase. `pnpm check:test-policy` (part of `pnpm validate`, added in
  [TAG-06/07](../../implementation-plans/cross-agent-test-governance.md))
  already rejects an ungoverned test declaration, a malformed claim, a
  drifted adapter block, or a direct `createDisposableDatabase()` call
  outside the reviewed allowlist on any branch, starting with this one.
- **Governed metadata:** required for every task in the *next* phase to add
  or change behavior (see the [test-delta table](../../implementation-plans/README.md#test-delta-table)
  now required in the detailed-plan template and PR template). No phase has
  reached that point yet — per the phase map in
  [implementation-plans/README.md](../../implementation-plans/README.md),
  Phase 4 landed but has not run `pnpm validate` to a full green result, and
  Phases 5 through 8 have no implementation commits yet, only accepted plans.
- **Cross-agent pilot:** one agent piloted, not two — see
  [test-policy-pilot.md](test-policy-pilot.md). This is a real, disclosed gap,
  not a rounding error: TAG-11's exit bar is explicitly "at least two
  different coding agents," and only Claude has been run against the corpus
  so far.

## What "rollout" means given that state

TAG-12 asks to "enable governed-claim enforcement before the next phase
starts adding tests" and "pilot the test-delta table on the first two tasks
of that phase." Enforcement is already enabled — there is no separate
switch to flip later. What has **not** happened, because no phase task has
run since this policy landed, is the pilot audit TAG-12 also asks for (false
positives, agent questions, review time, policy-check runtime under real
phase work). That audit is real work for whoever starts the next phase task,
not something this governance change can complete on its own — completing it
early on synthetic tasks would just be inventing results.

## Checklist for whoever starts the next phase

1. Confirm `pnpm check:test-policy` still passes clean on the phase's
   starting commit (`node scripts/check-test-policy.mjs`).
2. For the first two tasks that add or change behavior, fill the
   [test-delta table](../../implementation-plans/README.md#test-delta-table)
   in that phase's execution-detail plan *before* implementing, then verify
   the actual claim(s) added match what was predicted.
3. Record here (append, do not overwrite) what showed up: any false
   positive from `check:test-policy`, any question the table didn't have a
   good answer for, and how long the check itself took
   (`pnpm validate:profile`'s `check:test-policy` stage duration).
4. Once two tasks have gone through cleanly, governed metadata becomes
   mandatory for the rest of that phase, per the plan.
5. Before or alongside that phase, run the second cross-agent pilot
   described in [test-policy-pilot.md](test-policy-pilot.md) — it does not
   block phase work, but it is a prerequisite the plan sets for calling
   TAG-11 (and therefore this governance plan's own exit gate) complete.

### Pilot log

_(Empty until the next phase's first two governed tasks run. Append entries
below, oldest first, with phase, task ID, and what was learned — do not
delete or rewrite prior entries.)_
