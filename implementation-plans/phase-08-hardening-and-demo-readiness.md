# Phase 8 — Hardening and Demo Readiness

- **Project:** The Town Remembers
- **Status:** Draft implementation plan
- **Depends on:** Known-good deployed Phase 7 release
- **Goal:** Repeatable live judging, safe degradation, and verifiable evidence

## 1. Objective and user-visible proof

Demonstrate that the deployed project can survive repeated judging runs,
explain its agentic memory behavior precisely, and degrade honestly when a
dependency is slow, duplicated, unavailable, or returns invalid output.

The final proof is not a single happy-path recording. It is a release candidate
for which:

1. the two-player live demo succeeds repeatedly from a fresh town;
2. a Managed MCP inspection session reconstructs every shown transmission,
   belief change, contradiction, item state, model validation outcome, and
   retry identity from durable records;
3. scripted dependency, concurrency, retry, and deadline failures end in the
   accepted safe state without duplicate effects, leaked authority, or a
   stranded player;
4. measured latency and cost remain inside the accepted runtime and `$12.50`
   operating envelope; and
5. the deployed commit, migration, content/rules versions, prompt/schema/model
   versions, runbook, demo script, and submission materials all name the same
   release.

## 2. Scope

### In scope

- Full regression orchestration across unit, contract, schema, database, API,
  model, queue, browser, infrastructure, security, cost, and inspection
  boundaries.
- Prompt/model regression gate for all accepted control, failure, injection,
  edge, and repair cases.
- Concurrency, retry, dependency, timeout, ambiguous-commit, queue, recovery,
  and terminal-state fault injection.
- Browser compatibility and a final accessibility audit, including manual
  checks that automation cannot establish.
- Latency, bounded-load, CockroachDB RU/storage, token, and cost measurement.
- Fresh-town bootstrap/reset strategy, fixtures, operator and incident
  runbooks, rehearsal script, evidence capture, and submission verification.
- Repeated live two-browser plus MCP rehearsals and documented failure demos.

### Explicitly out of scope

- New gameplay, another mystery, new prompt responsibility, architectural
  migration, visual redesign, or speculative production-scale work.
- Lowering deterministic, grounding, tenant, security, accessibility, or cost
  requirements to make a test or rehearsal pass.
- Destructive mutation of retained judging towns, raw database editing during
  the live demo, or a hidden admin retry control.
- Continuous simulation, private networking, CI/CD infrastructure, exhaustive
  Internet-scale load, formal penetration testing, or certification.

Phase 8 is a hardening and proof phase, not the first owner of baseline quality.
Tests, accessible semantics, safe logs, fallbacks, and observability required
by earlier phases must already exist. Findings are fixed in their owning layer
and receive a regression here.

## 3. Prerequisites and accepted contracts

### Required Phase 7 handoff

- A deployed release manifest identifying commit/build, migrations,
  `bell-mystery-v1`, `mvp-rules-v1`, HTTP API `v1`, prompt/schema/validator
  versions, and resolved model/inference profiles.
- Passing complete-mystery E2E and public production smoke suites.
- Working alarms, dashboards, cost mode controls, log redaction, tenant
  isolation, deployment/rollback procedures, and fresh-town bootstrap.
- Read-only Managed MCP access to all accepted `inspection` views.
- Measured smoke latency/cost baseline and any contract-approved parameter
  tuning.

### Accepted sources of truth

- [MVP Product Direction](../docs/001-mvp-product-direction.md): expected visit,
  demo boundary, shared choice, and explainability.
- [MVP System Architecture](../docs/002-mvp-system-architecture.md): minimum test
  set, live two-browser/MCP proof, deployment sequence, security, and cost
  controls.
- [Infrastructure Cost Estimate](../docs/004-infrastructure-cost-estimate.md):
  baseline workload assumptions, thresholds, resource allowances, and
  re-estimation requirements.
- [Logical Data Model and Schema Contract](../docs/005-logical-data-model-and-schema-contract.md):
  high-risk invariants, inspection reconstruction, concurrency, and terminal
  operation state.
- [HTTP API Contract](../docs/006-http-api-contract.md): exact recovery,
  idempotency, rate, freeze, hidden-state, and public-error behavior.
- [MVP Reliability Parameters](../docs/007-mvp-reliability-parameters.md):
  deadlines, retries, fault outcomes, telemetry, alarms, and required
  verification.
- [Authored Game Content](../docs/009-authored-game-content.md): canonical demo
  rumour, evidence reversal, both endings, fresh-town restrictions, and content
  verification.
- [Bedrock Prompt Contracts](../docs/010-bedrock-prompt-contracts.md): complete
  evaluation fixture classes and no-regression release gates.
- [Interface and Interaction Design](../docs/011-interface-and-interaction-design.md):
  browser journeys, recovery UX, responsive behavior, and accessibility.

## 4. Ordered implementation workstreams

### Workstream A — Freeze the release candidate and regression inventory

#### P8-01 — Create the release-candidate manifest and traceability ledger

**Work**

- Freeze one candidate commit/build and record its infrastructure stack version,
  migration set, content/rules version, HTTP API version, prompt hashes,
  input/schema/validator versions, resolved model/profile IDs, asset manifest,
  environment, and public URL.
- Build a traceability ledger from every high-risk verification priority and
  Phase 0–7 exit check to an automated test, manual audit, operational probe,
  or explicitly accepted non-goal.
- Fail release verification for an unowned gap; do not mark a documentary
  assertion as automated coverage.
- Record all later candidate changes so a fix invalidates and reruns the
  affected proof rather than silently reusing prior evidence.

**Deliverables**

- Machine-readable and human-readable release manifests.
- Contract/phase-to-test traceability ledger and rerun-impact map.

#### P8-02 — Orchestrate the full deterministic regression suite

**Work**

- Provide one release-gate command that runs formatting/type/build, contract
  snapshot drift, deterministic rules, content graph, database constraints and
  transactions, API unions/idempotency, queue/recovery, web components,
  accessibility automation, browser journeys, infrastructure synthesis,
  privilege/security, cost controls, and prompt evaluations.
- Keep CockroachDB transaction/concurrency tests on a real compatible database;
  mocks may supplement but not substitute for the claimed boundary.
- Classify tests by deterministic/offline, external-live, destructive-isolated,
  and manual so operators know what can run against production and what needs a
  disposable test town/resource.
- Retain screenshots, traces, logs, and result summaries only on failure or as
  named release evidence, with short retention and secret scrubbing.

**Deliverables**

- Release-gate runner, test classification, deterministic fixture controls,
  sanitized report bundle, and flake policy.

### Workstream B — Prompt and model regression

#### P8-03 — Complete and enforce the prompt evaluation gate

**Work**

- Implement every control, known-failure, injection, edge, and boundary case
  in Decision 010 for normalization, dialogue, ambient choice, and repair.
- Compare schemas, selected IDs, membership, required grounding, predicate
  signatures, gate consistency, length, persistence safety, and fallback
  result. Do not gate on exact generated prose or let a fuzzy tone score
  override hard safety.
- Include malicious instructions in player text, rendering text, event text,
  alleged-source text, invalid model output, and sanitized validation errors.
  All remain untrusted data.
- Prove repair has the same authority boundary, cannot invent IDs, is validated
  from scratch, and never receives a repair-of-repair attempt.
- Run the same hard cases for Sonnet dialogue and the accepted Haiku
  reduced-cost dialogue path. Any model/profile change reruns and must not
  regress the prior accepted version.
- Verify failed/invalid raw output is neither logged nor persisted while
  `agent_runs` retains exact reproducibility metadata and stable error codes.

**Deliverables**

- Versioned prompt evaluation corpus, runner, baseline result, safety-diff
  report, and release-blocking regression policy.

### Workstream C — Concurrency, retry, and dependency fault injection

#### P8-04 — Build bounded fault-injection controls and scenario isolation

**Work**

- Add test-only dependency adapters or scoped fault switches that can produce
  timeout, throttling/5xx, invalid structured output, connection loss before
  transaction, ambiguous commit acknowledgement, Lambda termination, SQS
  duplicate/redelivery, uncertain publication, stale claim, and delayed
  Recovery behavior.
- Make every switch unavailable from the public player surface and disabled in
  ordinary production traffic. Scope tests to explicit disposable towns,
  synthetic queue resources, or known operation IDs.
- Time-compress only through injected clocks/config in tests. A test parameter
  must not change the deployed accepted production value or operation
  semantics.
- Capture causal ledger state before/after each injection and restore/retire
  only the isolated fixture; never clean up by editing a judging town's causal
  history.

**Deliverables**

- Fault-injection harness, scenario isolation controls, production-disable
  assertion, and fixture lifecycle guide.

#### P8-05 — Prove player-action and transaction failure safety

**Work**

- Run coalesced double-click, lost HTTP response, concurrent identical action,
  different action while one is processing, expired-claim takeover,
  late-worker commit, three-attempt exhaustion, one/two town revision conflicts,
  serialization exhaustion, and ambiguous commit scenarios.
- Prove status polling never starts work; takeover reuses the same body/key only
  after database-time expiry; an old/replaced token cannot commit.
- Prove the saved response and all effects commit atomically, and a replay after
  a lost response returns byte-equivalent canonical JSON without extra events,
  custody changes, transmissions, evidence, or cost-generating model work.
- Run simultaneous unique-item transfers, correct accusations, and resolution
  choices. Exactly one conditional winner commits and the loser sees the
  accepted safe stored result.
- Verify deadline reserve behavior for Titan/Bedrock/DB delays: dialogue falls
  back before API timeout; normalization stores the accepted terminal `503`;
  no unconfirmed effect appears in the UI.

**Deliverables**

- Player/concurrency fault matrix with durable before/after assertions and
  client recovery evidence.

#### P8-06 — Prove ambient delivery, recovery, and terminal-state safety

**Work**

- Inject crash-before-send, uncertain SQS acknowledgement, duplicate publish
  within and outside FIFO deduplication, duplicate Lambda delivery, early
  delivery before `not_before`, expired/replaced ambient claim, invalid choice,
  model timeout, five receive failures, late delivery, and non-active town.
- Prove every publication/redrive retains `town_id`, `outbox_id`, `job_key`,
  payload hash, and numbered event effect identities.
- Prove one failed invocation has a useful retry opportunity before the
  transition deadline under the real relationship among 20-second delay,
  30-second Lambda, 45-second claim, and 180-second visibility.
- Prove deadline terminalization produces abandoned delivery and quarantined
  execution with no partial effects, raises the required signal, lets the
  player re-enter, and makes later delivery a no-op.
- Exercise DLQ alarm and a documented manual redrive in an isolated resource;
  the redrive must preserve the original body/keys and must not duplicate an
  already-completed effect.
- Confirm tick-created events do not feed the same range, one claim/speaker
  limits hold, and a `do_nothing` completion is a valid terminal outcome.

**Deliverables**

- Ambient fault matrix, DLQ/redrive evidence, terminal-transition browser
  evidence, and inspection reconstruction for each terminal class.

### Workstream D — Performance, capacity, cost, compatibility, and accessibility

#### P8-07 — Characterize latency, bounded capacity, and cost per visit

**Work**

- Run an isolated workload representing the accepted baseline visit mix and a
  small concurrency burst within configured API/Lambda/ambient limits. Do not
  perform unbounded load against shared production infrastructure.
- Report p50/p95/p99 for database reads, vector retrieval, Titan, Haiku,
  Sonnet, validation, final commit, full actions, ambient jobs, and transition
  age.
- Prove the 24-second application budget, final four-second reserve, and
  500-millisecond response reserve at the slow-tail cases. Confirm claims remain
  longer than their workers and visibility remains at least six times Ambient
  timeout.
- Measure per-visit calls, tokens, cache dimensions, retries/repairs, Lambda
  duration, CloudWatch ingestion, CockroachDB RU/storage, and estimated invoice.
  Replace planning assumptions with actual cost per visit and p95 tokens.
- Exercise the `$8`, `$9.50`, and `$10.35` cost-mode transitions with a test
  ledger; ensure no public error reveals its dollar value and retained towns
  remain readable in authored-fallback mode.
- If tuning is necessary, update the reliability contract, CDK/runtime config,
  cost estimate, tests, and coupled invariant analysis in the same candidate.

**Deliverables**

- Latency/capacity report, actual cost-per-visit model, CockroachDB usage
  report, cost-mode evidence, and any approved tuning decision.

#### P8-08 — Close browser compatibility and accessibility audit findings

**Work**

- Run the complete critical journeys in the current stable Chromium, Firefox,
  and WebKit/Safari-compatible Playwright engines and perform one real-device or
  real-browser spot check where available.
- Verify IndexedDB journal, `BroadcastChannel` fallback, cookies, visibility
  polling, History API invite stripping, offline/online recovery, focus, and
  responsive drawers across engines.
- Audit at 320 CSS pixels, 200% zoom, keyboard only, screen-reader landmarks and
  labels, contrast, reduced motion, live regions, countdown announcements,
  dialogs, board provenance, and contradiction relationships.
- Fix findings in their owning component/state layer and add a regression. Do
  not waive a required action because the design calls mobile-first
  optimization a non-goal.
- Record tool versions and manual evidence; automated axe output alone is not a
  complete accessibility audit.

**Deliverables**

- Browser matrix, final accessibility report, manual checklist, issue/fix log,
  and regression coverage.

### Workstream E — Operations, demo, evidence, and release decision

#### P8-09 — Finalize fresh-town, incident, and rollback runbooks

**Work**

- Document a fresh-town workflow that creates a new isolated town through the
  accepted bootstrap path and never requires clearing a prior town's causal
  rows. Record the town ID/invite securely and retire it only under the accepted
  lifecycle.
- Define pre-demo checks for release identity, public health and authenticated
  smoke, four prompt warmups, queue/DLQ state, alarms, cost mode, CockroachDB
  resource headroom, MCP access, browser profiles, and network stability.
- Define incident decision trees for API/DB/model/embedding/queue/MCP slowness,
  secret/capability exposure, cost threshold, alarm, failed deployment, and
  ambiguous commit. Prefer existing safe fallback/ledger inspection over blind
  retries or direct data edits.
- Include post-recording/post-judging credential rotation, evidence retention,
  and eventual town/environment retirement.
- Walk the runbook with a second reader or cold start from a clean operator
  shell and correct every missing prerequisite.

**Deliverables**

- Operator runbook, incident decision trees, fresh-town checklist, rollback and
  rotation procedures, and cold-run feedback record.

#### P8-10 — Rehearse the canonical live demo and inspection narrative

**Work**

- Rehearse the exact fresh-town live sequence: Player A tells Mara the garden
  rumour, leaves, ambient propagation selects Nessa or valid Corin fallback,
  Player B receives changed dialogue, shows `guard_cart_ruts`, and inspection
  shows the belief reversal while the item remains in the Old Chapel.
- Make the script branch explicitly on the actual selected recipient rather
  than assuming Nessa. Do not pre-create the player actions, clue, ambient
  transmission, contradiction, or inspection records shown live.
- Keep the judged narrative under three minutes while retaining a longer
  operator rehearsal that also proves full mystery/ending readiness.
- Prepare exact MCP inspection questions/queries using the live town/action/job
  IDs and explain: root source, hop, trust snapshot, evidence weights,
  contradiction, selected belief, unchanged objective state, prompt/validator
  identity, and retry/outbox state.
- Rehearse normal dependency latency and the documented safe fallback stories.
  Never simulate success text for an external effect that did not occur.
- Run at least five consecutive successful fresh-town primary rehearsals,
  including one successful authored-dialogue-fallback path. Run the ambient
  quarantine/failure rehearsal separately in an isolated fixture, and record
  every pass, failure reason, and recovery.

Five consecutive passes is the implementation plan's initial release threshold,
not a product-contract value. `P8-01` may raise it after measuring variance; any
reduction requires a recorded release-risk decision rather than an undocumented
shortcut.

**Deliverables**

- Timed primary script, branch card for Nessa/Corin, MCP inspection script,
  presenter/operator checklist, and rehearsal log.

#### P8-11 — Capture evidence and make the final release decision

**Work**

- Capture sanitized screenshots/video/log extracts/inspection results that
  prove live AWS use, CockroachDB vector memory and Managed MCP inspection,
  persistent cross-player effect, deterministic grounding, and safe fallback.
- Ensure evidence shows request/release/prompt/content identities needed for
  correlation but no invite token, judge code, cookie, join secret, database
  credential, raw prompt/output, or avoidable player text.
- Verify README/submission copy, architecture diagram, public URL, demo video,
  runbook, cost statement, and service/model claims against the release
  manifest. Do not claim deferred integrations or unmeasured scale.
- Rerun all affected gates after the last code/config/content/prompt change.
- Hold a go/no-go review: unresolved correctness, security, tenant isolation,
  duplicate-effect, no-soft-lock, accessibility-critical, inspection, or hard
  cost-control failures are release blockers.

**Deliverables**

- Sanitized submission evidence bundle, final test/inspection/cost summaries,
  claim-to-evidence index, and signed go/no-go checklist.

## 5. Artifacts

Phase 8 is expected to produce or finalize:

- release manifest and traceability ledger;
- one-command regression gate and classified test suites;
- prompt evaluation corpus, baselines, and safety diff;
- isolated fault-injection harness and scenario matrices;
- latency, bounded-capacity, token, cost, and CockroachDB usage reports;
- cross-browser and accessibility audit reports;
- fresh-town, incident, rollback, rotation, and pre-demo runbooks;
- timed two-player demo and Managed MCP inspection scripts;
- rehearsal log and sanitized evidence/submission bundle;
- final go/no-go record.

All evidence artifacts must follow the same secret, invite, logging, and raw
model-output prohibitions as the production system.

## 6. Dependencies and sequencing

```text
P8-01 -> P8-02
P8-01 -> P8-03
P8-02 -> P8-04 -> P8-05 -> P8-06
P8-02 + P8-03 -> P8-07
P8-02 -> P8-08
P8-05 + P8-06 + P8-07 -> P8-09
P8-03 + P8-08 + P8-09 -> P8-10
P8-01 + P8-02 + P8-07 + P8-10 -> P8-11
```

- P8-01 freezes traceability, not development. Any fix creates a new release
  candidate revision and invalidates affected evidence.
- Fault injection runs only after the normal regression is green, so failures
  can be attributed to the injected condition.
- Performance measurement occurs after observability is verified and uses
  isolated towns/resources; cost tests use a test ledger rather than spending
  through real thresholds.
- P8-08 audits the already-implemented accessibility baseline. Findings are
  fixed immediately and rerun before rehearsal.
- Demo evidence is captured only from a release candidate that has passed the
  applicable normal and fault gates.

## 7. Verification matrix

Commands below are **planned command surfaces** to be reconciled with the
workspace. Production-affecting commands require the operator safeguards and
isolated targets described above.

| Concern | Boundary and evidence | Planned command |
|---|---|---|
| Deterministic release gate | Build, unit, contracts, content, DB, API, UI, infra | `pnpm verify` |
| Prompt safety | All four prompt roles, both dialogue models, injections, repair/fallback | `pnpm prompts:eval` |
| Full browser regression | Complete mystery, multiplayer, recovery, resolution | `pnpm test:e2e` |
| Player fault matrix | Claims, duplicate/lost response, ambiguity, concurrency, deadline | `pnpm test:faults --suite player` |
| Ambient fault matrix | Send uncertainty, duplicate/redelivery, expiry, DLQ, quarantine | `pnpm test:faults --suite ambient` |
| Public production smoke | Deployed authenticated flow and terminal ambient transition | `pnpm smoke-test` |
| Latency/cost | Bounded isolated workload with p50/p95/p99 and per-visit cost | `pnpm test:performance --profile mvp-demo` |
| Browser matrix | Chromium, Firefox, WebKit critical journeys | `pnpm test:e2e --project chromium --project firefox --project webkit` |
| Accessibility | Automated suite plus referenced manual audit | `pnpm test:a11y` |
| Cloud/security/privilege | CDK drift, headers/logs, IAM/DB/MCP negative permissions | `pnpm test:cloud` and `pnpm test:privileges --target production` |
| Demo readiness | Fresh town, two browsers, canonical rumour, evidence reversal, MCP reconstruction | `pnpm demo:rehearse` |
| Final release | Manifest consistency and all non-manual release blockers | `pnpm release:verify` |

Minimum retained evidence for a fault scenario is the fixture/release identity,
injected condition, expected stable outcome, player-visible result, durable
operation/event counts, relevant alarm/metric, inspection reconstruction, and
secret-scan result.

## 8. Risks, decisions, and fallback strategy

| Risk or decision | Required response | Safe fallback |
|---|---|---|
| A hardening test finds an earlier-phase defect | Fix it in the owning application/infra layer and add a regression; update traceability | Cut a new release candidate and rerun affected gates |
| Fault switches can affect ordinary traffic | Require test-only build/config, explicit fixture scope, and production-disable assertion | Do not run that scenario against the deployed judging environment |
| Model variability makes exact demo wording unreliable | Assert and narrate structured claims, selected approved renderings, and saved outcomes | Follow authored fallback; never depend on generated prose for required progress |
| Ambient model chooses Corin instead of preferred Nessa | Treat both as valid accepted behavior and branch on the committed transmission | Follow the selected recipient in Player B and MCP inspection |
| Live model or embedding is slow/unavailable | Use accepted dialogue/recall fallbacks and show the saved honest result | Demonstrate causal state/inspection with the completed fallback; normalization is retried only as a new action after its terminal error |
| Queue work misses the demo window | Let deadline/recovery reach the honest terminal state and inspect why | Start a fresh prepared town for the primary demo only after recording the failed rehearsal; never patch the job |
| Rehearsal data contaminates the live proof | Create a fresh isolated town per run and record IDs securely | Retain/retire old towns per policy; never erase causal rows to make them look fresh |
| Browser/E2E flake hides a real race | Require deterministic seed, network/clock controls, traces, and repeat failure triage | Quarantine only a proven harness defect with an owner and manual release check; never ignore correctness assertions |
| Load test spends budget or harms judging traffic | Use bounded isolated profile, test ledger, concurrency caps, and scheduled window | Stop early and extrapolate only where labeled; do not claim unmeasured capacity |
| Cost estimate exceeds `$12.50` after measurement | Recalculate from actual usage and use accepted model/action/fallback controls | Stop new towns or remain in authored fallback while retaining readable data |
| MCP unavailable during judging | Diagnose separately without granting API/database admin access | Use previously captured sanitized evidence for explanation while stating the live inspection outage; restore MCP before claiming the exit gate |
| Evidence capture leaks a capability or secret | Run pre-publication scans and independent review | Revoke/rotate, delete unsafe artifact, and recapture; never redact only the visible frame if metadata remains |
| Last-minute config/content/prompt drift | Compare deployed identities to the release manifest immediately before demo | Redeploy the verified candidate or rerun affected gates; do not hand-edit production |

## 9. Exit checklist

- [ ] The release manifest exactly matches the deployed commit, infrastructure,
      migrations, content/rules, prompts/schemas/validators, models/profiles,
      assets, and runbook.
- [ ] Every accepted high-risk invariant and Phase 0–7 exit condition maps to a
      passing automated check, completed manual audit, operational probe, or
      explicit accepted non-goal.
- [ ] The full deterministic, integration, cloud, prompt, browser, security,
      privilege, and accessibility release gates pass for the candidate.
- [ ] Prompt evaluations cover control, failure, edge, injection, repair, both
      dialogue models, and prior-version hard-safety regression cases.
- [ ] Player action faults prove no duplicate/partial effect, safe saved replay,
      claim ownership, bounded retry, and ambiguous-commit read-before-retry.
- [ ] Ambient faults prove original key preservation, bounded retry, DLQ alarm,
      safe redrive, deadline quarantine/abandonment, late-delivery no-op, and
      guaranteed re-entry.
- [ ] Concurrency tests prove one unique-item, correct-accusation, and resolution
      winner without a duplicate effect.
- [ ] Measured p50/p95/p99 and reserve behavior fit accepted deadlines or an
      approved coupled tuning change; actual cost per visit and p95 token use
      are published.
- [ ] The measured cost model and hard `$10.35` fallback control preserve the
      `$12.50` ceiling, with AWS and CockroachDB guardrails verified.
- [ ] Chromium, Firefox, and WebKit critical journeys pass; the manual 320px,
      200% zoom, keyboard, screen-reader, contrast, focus, live-region, and
      reduced-motion audit has no unresolved critical issue.
- [ ] A cold operator can create a fresh town, preflight services, run/branch
      the demo, inspect causality, respond to failure, and rotate/retire access
      using the runbooks alone.
- [ ] At least five consecutive successful fresh-town primary rehearsals are
      logged, including valid Nessa/Corin branch handling where selected; the
      required failure rehearsals are logged separately in isolated fixtures.
- [ ] Managed MCP reconstructs every shown belief, evidence, provenance,
      relationship, item, model, idempotency, and ambient record without write
      authority or secret material.
- [ ] Submission copy and captured evidence make only verified claims, contain
      no secrets/capabilities/raw model output, and point to the exact deployed
      release.
- [ ] The final go/no-go review has no unresolved blocker in correctness,
      no-soft-lock, security, tenant isolation, duplicate effects,
      accessibility, inspection, operations, or cost controls.

## 10. Handoff and operating state

At completion, hand off one immutable release/evidence package containing:

- deployed release manifest and public URL;
- sanitized test, prompt, fault, latency, cost, accessibility, security, and
  inspection summaries;
- fresh-town, pre-demo, demo, incident, rollback, rotation, and retirement
  runbooks;
- the two-player/MCP rehearsal script and branch card;
- the final submission claim-to-evidence index and go/no-go record.

Keep the verified environment online through judging, watch alarms and cost
mode, and create a fresh town for each judged run. After judging, follow the
runbook to rotate credentials, retire access and towns at the chosen time, and
preserve only the sanitized evidence required by the submission.
