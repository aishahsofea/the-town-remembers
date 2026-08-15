<!--
Test ownership and cost are part of the change, not an afterthought.
See docs/agents/testing-policy.md for the full policy this section enforces
(TG-01..TG-12) and AGENTS.md/CLAUDE.md for the generated summary every
coding agent gets. `pnpm check:test-policy` (part of `pnpm validate`)
enforces the hard parts of this deterministically; this section is where a
human reviewer reads the reasoning behind them.
-->

## Summary

<!-- What changed and why, in a sentence or two. -->

## Test delta

<!-- Claims added, extended, or reused, by ID. A zero-test change states why
     no new claim was required. -->

| Claim | Existing owner | Proposed owner | Boundary | Unique failure (secondary owners only) | Setup | Decision |
| ----- | --------------- | --------------- | -------- | ---------------------------------------- | ----- | -------- |
|       |                 |                 |          |                                           |       |          |

- **Existing tests searched:**
- **Test/setup count delta:** (named tests/rows; shared vs. isolated database
  lifecycles; browser journeys; prompt/live-model evaluations; validation
  stages)
- **Security/concurrency exceptions to the cheapest-boundary default, if
  any:**

## Verification

- **Scoped command(s) run locally:**
- **Final aggregate gate status:** (`pnpm validate`, or state why it was not
  run — see `CLAUDE.md` for the scoped-run-first, full-run-last workflow)
