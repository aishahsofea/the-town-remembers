# Cross-agent test-policy pilot

- **Status:** One agent piloted (Claude Sonnet 5). A second, independent
  agent family (Codex or Copilot) has **not** been piloted yet — this
  document says so explicitly rather than implying otherwise. TAG-11's exit
  bar ("at least two different coding agents pass the control,
  known-failure, and boundary corpus") is not yet met.
- **Policy checksum at capture time:** `9142f61a103d` (the checksum embedded
  in the current `AGENTS.md`/`CLAUDE.md` generated block — see
  `scripts/sync-agent-test-policy.mjs`). Re-run this pilot after any change
  to `docs/agents/testing-policy.md`'s CORE block changes that checksum.

## What was actually run

`verification/test-policy-evals/pilot-runs/claude-sonnet-5-2026-08-15.json`
is a real captured decision set: for each of the 11 scenarios in
`verification/test-policy-evals/`, it records the `add`/`extend`/`reuse`/
`ask` decision, claim ID, boundary, setup, and (where relevant)
`uniqueProof`/`isolationReason` that following `docs/agents/testing-policy.md`
implies. Scoring it —

```bash
node scripts/test-policy-eval.mjs verification/test-policy-evals/pilot-runs/claude-sonnet-5-2026-08-15.json
```

— produces **11/11 hard-passed, 1 needing human review of `uniqueProof`**
(the `boundary-defense-in-depth` scenario's server-log justification, which
is exactly the kind of free-text distinctness the runner is designed to hand
to a person rather than a heuristic).

## Methodology caveat

This run is not a blind evaluation: Claude authored the eval corpus, the
canonical policy, and this captured run in the same session. A clean score
here demonstrates that the runner and scoring logic work end-to-end and are
internally consistent with the policy's own stated reasoning — it does not
demonstrate that an agent unfamiliar with this specific corpus reaches the
same conclusions from the policy text alone. That is exactly what the second
pilot (below) is for.

**Running this pilot is what caught a real bug.** The first scoring attempt
against the initial `scoreDecision` implementation produced two false
failures (`known-failure-e2e-duplicates-component` and
`known-failure-fresh-db-when-shared-sufficient`): the scorer required a
`uniqueProof`/`isolationReason` on every scenario flagged
`uniqueProofRequired`/`isolationReasonRequired`, even when the correct
decision was `ask` — refusing to add anything, and therefore having nothing
to justify. `scripts/test-policy-eval.mjs`'s `scoreDecision` now only
enforces those fields when the decision actually proposes to create an
owner (`decisionCreatesOwner`), with a regression test for both directions.
This is the value of actually running the eval before trusting it, not
just writing it.

## Before repository-wide enforcement is fully warranted

1. Capture a second agent's decisions (Codex and/or Copilot) for the same
   11 scenarios into the same JSON shape (see the pilot run above for the
   format) and score them with the same command.
2. Both agents must reject every `known-failure` scenario's literal request
   and hard-pass every `control` scenario.
3. Review any `boundary` scenario disagreement between agents as a
   semantic/example-wording gap in `docs/agents/testing-policy.md`, not as
   an agent-specific exception (per the plan's explicit non-goal: "do not
   add agent-specific loopholes to make one model pass").
4. Re-run both pilots after any material change to the canonical policy's
   CORE block (the checksum changing is the deterministic signal that a
   re-run is due).

`pnpm check:test-policy` (the deterministic, always-on gate — see
[TAG-06/07](../../implementation-plans/cross-agent-test-governance.md)) does
not depend on this pilot passing; it already enforces the ledger, eval
corpus, and adapter-sync rules on every commit. What the second pilot adds is
confidence that the *prose* guidance reaches a second model family the same
way it reached this one — a semantic property no deterministic check can
substitute for.
