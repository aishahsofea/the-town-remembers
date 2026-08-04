# Phase 7 — Cloud Operations and Inspection

- **Project:** The Town Remembers
- **Status:** Draft implementation plan
- **Depends on:** Complete Phase 6 application and migration artifacts
- **Target topology:** AWS and CockroachDB Basic in `us-east-1`

## 1. Objective and user-visible proof

Run the complete mystery in its accepted AWS and CockroachDB Cloud topology so
that it is secure enough for the bounded MVP, observable, recoverable,
cost-governed, deployable by one operator, and causally inspectable by judges.

The proof has two linked paths:

1. A player uses the public CloudFront URL to create/join a fresh town, complete
   an authenticated saved action, leave through an ambient transition, and
   resume through the deployed Game, Ambient, Recovery, SQS, Bedrock, and
   CockroachDB boundaries.
2. A judge uses the separately authenticated, read-only CockroachDB Cloud
   Managed MCP connection to reconstruct the same town's objective item state,
   claim provenance, belief evidence, relationship change, agent runs,
   idempotency status, and ambient job without gaining mutation authority or
   credential material.

The environment must expose actionable health, latency, queue, failure, and
cost signals and support a documented deployment and rollback procedure from a
clean operator machine.

## 2. Scope

### In scope

- Production AWS CDK resources for S3, CloudFront, API Gateway HTTP API, Game,
  Ambient, and Recovery Lambdas, SQS FIFO and DLQ, EventBridge schedules,
  Secrets Manager references, CloudWatch telemetry, and AWS Budgets.
- Deployment-time model/config selection and the four required Bedrock
  model/schema warmups.
- CockroachDB Basic production bootstrap, roles/grants, TLS, resource limit,
  migrations, authored seed/bootstrap, and separately managed inspection
  access.
- Least-privilege IAM, public-edge security/cache/logging controls, sanitized
  structured application logs, metrics, alarms, dashboards, and cost modes.
- Read-only inspection views and a judge/developer MCP inspection runbook.
- Deploy, migrate, seed, prewarm, smoke-test, and rollback commands.
- Security, tenant-isolation, queue, alarm, and public endpoint verification at
  the real service boundary.

### Explicitly out of scope

- Private networking, VPC, NAT Gateway, PrivateLink, provisioned concurrency,
  provisioned Bedrock throughput, containers, a separate vector database,
  multiple persistent environments, or CI/CD infrastructure.
- An admin mutation/retry dashboard, direct MCP mutation tools, or exposing
  inspection tables through player HTTP routes.
- Full-scale production compliance or high-sensitivity data controls; the
  accepted temporary MVP uses the public CockroachDB endpoint with
  `sslmode=verify-full` and least privilege.
- Broad fault campaigns, browser compatibility closure, final rehearsal, and
  submission evidence packaging; Phase 8 owns them. Phase 7 still proves that
  deployed alarms and bounded recovery work.
- Changing gameplay/content/prompt contracts merely to simplify deployment.

## 3. Prerequisites and accepted contracts

### Required capabilities from earlier phases

- Complete production builds for the React app and the Game, Ambient, Recovery,
  and CDK entry points.
- Repeatable migration and `bell-mystery-v1` town bootstrap commands, including
  the `inspection` schema and views.
- Passing deterministic, API, model-boundary, queue/idempotency, complete
  mystery, recovery, and accessibility suites.
- Stable structured log fields, public error codes, prompt/schema versions,
  and model-cost calculation inputs.
- An operator-controlled AWS account/region, CockroachDB Cloud organization,
  Bedrock model access, and DNS-free CloudFront deployment target.

### Accepted sources of truth

- [MVP System Architecture](../docs/002-mvp-system-architecture.md): topology,
  service responsibilities, security, inspection, deployment, cost modes, and
  demo proof.
- [Technical Architecture and Runtime Flows](../docs/003-technical-architecture-and-schema.md):
  component boundaries, public-edge behavior, model authority, and queue flow.
- [Infrastructure Cost Estimate](../docs/004-infrastructure-cost-estimate.md):
  `$12.50` ceiling, `$10.35` model fallback threshold, three-secret floor,
  budget allocation, retention, and re-estimation requirements.
- [Logical Data Model and Schema Contract](../docs/005-logical-data-model-and-schema-contract.md):
  runtime/inspection privileges, `agent_runs`, outbox/execution state, and the
  required inspection views.
- [HTTP API Contract](../docs/006-http-api-contract.md): cache, Origin, cookie,
  referrer, logging, rate-limit, health, and public response requirements.
- [MVP Reliability Parameters](../docs/007-mvp-reliability-parameters.md): exact
  Lambda, claim, database, FIFO, visibility, recovery, DLQ, and alarm values.
- [Bedrock Prompt Contracts](../docs/010-bedrock-prompt-contracts.md): model
  configuration, schema warmup, telemetry, and prompt versioning.

Infrastructure parameters marked tunable may change only after measurement and
must keep their coupled invariant. Any such change updates CDK, runtime config,
tests, cost analysis, and the reliability contract together.

## 4. Ordered implementation workstreams

### Workstream A — Environment contract and production CDK baseline

#### P7-01 — Define validated deployment configuration and release identity

**Work**

- Define one typed configuration surface for account, region, stage, public
  origin, build/release ID, asset version, resolved Bedrock model or inference
  profile IDs, CockroachDB secret reference, security-key version, log
  retention, alarms, budget recipients, and concurrency controls.
- Reject missing, placeholder, mutually inconsistent, or non-`us-east-1`
  production settings before synthesis/deploy.
- Keep secret values out of CDK context, CloudFormation outputs, bundled web
  configuration, shell history instructions, and source control.
- Tag resources with project, environment, release, and cost-owner identifiers.

**Deliverables**

- Typed deployment configuration module, example non-secret environment file,
  validation tests, and configuration reference.
- Release metadata injected into web/API health and operational logs without
  exposing secrets.

#### P7-02 — Provision the Lambda, queue, and recovery data plane

**Work**

- Deploy Game Lambda at a 28-second timeout; Ambient and Recovery Lambdas at 30
  seconds. Configure bounded memory and small runtime database pools without
  provisioned concurrency.
- Deploy one SQS FIFO source queue with 20-second queue delay, 180-second
  visibility, four-day retention, batch size one, `maxReceiveCount = 5`, and a
  14-day DLQ.
- Configure Ambient event-source and reserved concurrency at five. Preserve
  `MessageGroupId = town_id` and `MessageDeduplicationId = job_key` in runtime
  publication rather than synthesizing new identities in infrastructure.
- Schedule Recovery once per minute and the non-player structured-output
  warmup every 20 hours during live judging.
- Grant only the intended service-to-service actions: Game publishes to the
  source queue; Ambient consumes it; Recovery reads due database state and
  republishes original jobs; none can redrive or purge through player paths.

**Deliverables**

- CDK constructs and synth assertions for functions, FIFO/DLQ, event-source
  mapping, concurrency, schedules, and retention.
- Runtime configuration mapping the exact reliability parameter values.

### Workstream B — Public edge and static delivery

#### P7-03 — Deploy the S3, CloudFront, and API Gateway route topology

**Work**

- Store the versioned Vite build in a private S3 origin and serve it through
  CloudFront with SPA route fallback that does not preserve invite tokens in
  logs or redirects.
- Route `/api/*` through API Gateway HTTP API to Game Lambda. Configure the
  accepted 30-second integration timeout, same-origin behavior, exact
  application Origin validation, and no arbitrary CORS.
- Disable shared API caching. Apply `private, no-cache` plus `Vary: Cookie` to
  authenticated views and `no-store` to mutations, status, preview, create, and
  join responses.
- Emit `Referrer-Policy: no-referrer` on HTML/API responses and the remaining
  security headers selected for the MVP. Load no third-party invite-page
  resources.
- Disable CloudFront standard/real-time access logs and S3 server-access logs
  because their URI fields can contain invite capabilities.
- Configure only the sanitized API Gateway access-log template: request ID,
  route template, status, and integration latency.
- Deliberately select/attach the CloudFront Free flat-rate plan when supported
  by the account and record verification of its allowance association.

**Deliverables**

- Edge/API CDK construct, response-header policy, cache behavior, private S3
  access, and sanitized access-log configuration.
- Synth/production probes proving cache, referrer, Origin, cookie, and SPA
  behavior.

### Workstream C — Credentials, data bootstrap, and least privilege

#### P7-04 — Provision secrets and IAM without credential overlap

**Work**

- Reference exactly the runtime database credential, judge code, and versioned
  application security key in AWS Secrets Manager; do not commit or output
  their values.
- Grant the runtime database secret only to Game, Ambient, and Recovery. Grant
  the judge/security secrets only to the Lambda paths that actually use them.
- Keep `migration_admin` exclusively in the operator's encrypted local
  credential store. Never deploy it to AWS or make it readable by a Lambda.
- Keep inspection authentication inside the CockroachDB Cloud Managed MCP
  connection. Do not mirror it into Secrets Manager.
- Use random 256-bit credentials and document post-recording/post-judging
  rotation and historical application-security-key retention rules.
- Run an IAM policy analysis/synth test that rejects wildcards where a resource
  ARN or action subset is known.

**Deliverables**

- Least-privilege role and secret grants, secret bootstrap/rotation procedure,
  and IAM assertion suite.

#### P7-05 — Bootstrap CockroachDB Cloud roles, schema, and resource controls

**Work**

- Configure a CockroachDB Basic cluster in `us-east-1` with an explicit Basic
  resource limit and the accepted public endpoint.
- Enforce `sslmode=verify-full`, connection timeout three seconds, statement
  timeout up to three seconds, transaction deadline up to five seconds, pool
  size two per warm Lambda environment, and parameterized SQL.
- Apply migrations with `migration_admin`, grant `app_runtime` only required
  DML and sequence/schema usage, and deny it inspection/admin DDL.
- Create/update the `inspection` schema and views through migration authority;
  grant the Managed MCP inspection identity read-only access to those views and
  no base-table writes.
- Run a fresh migration and seed/bootstrap through operator commands. Validate
  all vector columns/indexes and town-prefixed query plans at production scale.

**Deliverables**

- CockroachDB bootstrap/grant scripts or documented SQL artifacts, privilege
  assertions, production migration evidence, and configured resource limit.
- A safe repeatable demo-town bootstrap command that does not overwrite an
  existing town.

### Workstream D — Bedrock deployment and cost enforcement

#### P7-06 — Wire Bedrock models, prompt identity, and grammar warmup

**Work**

- Resolve the configured Sonnet, Haiku, and Titan model/inference-profile IDs
  at deployment and fail fast when required access is absent.
- Grant only the Bedrock invocation actions and resources needed by Game and
  Ambient; Recovery receives no model authority.
- Prewarm Haiku + normalization, Haiku + ambient, Haiku + dialogue, and Sonnet
  + dialogue with the exact checked-in schemas after deploy and in the public
  smoke workflow.
- Make scheduled warmups create no town or `agent_runs` records while emitting
  cost, latency, and outcome telemetry. A failure alarms and never weakens
  normal fallbacks.
- Verify every real `agent_runs` record contains resolved model/profile,
  prompt/hash/input/schema/validator versions, tokens, latency, outcome, and
  estimated cost without raw prompt or model output.

**Deliverables**

- Bedrock configuration/permissions, prewarm command and schedule, warmup
  telemetry, and deployment checks.

#### P7-07 — Enforce the internal cost modes and external budgets

**Work**

- Aggregate actual input/output/cache token dimensions and inference-profile
  rates into the monthly model ledger.
- Enforce the accepted state machine: below `$8` Sonnet dialogue; `$8`–`$9.50`
  Haiku dialogue; `$9.50`–`$10.35` stop new towns and tighten action limits;
  at/above `$10.35` authored fallbacks while retained data remains readable.
- Make transitions conditional/idempotent so concurrent requests cannot spend
  past a threshold under stale mode. Never reveal ledger dollar values in
  player errors.
- Create one AWS Budget with alerts at `$5`, `$9`, and `$11`; document billing
  delay and the internal ledger's role as the immediate control.
- Add dashboards for cost by model/purpose, calls per visit, fallback mode,
  token p95, CockroachDB RU/storage, and platform spend. Set 7–14 day log
  retention and avoid high-cardinality custom metrics without an operational
  decision.

**Deliverables**

- Cost ledger/mode service, threshold concurrency tests, AWS Budget resources,
  cost dashboard, and operator alerts.

### Workstream E — Observability, alarms, and inspection

#### P7-08 — Implement sanitized structured telemetry and operational alarms

**Work**

- Standardize structured records around request/job/action IDs, town-safe
  correlation, release, attempt, token suffix/hash, model/prompt versions,
  dependency latency/category, transaction retries, claim takeover, stale
  rejection, ambiguous-commit decision, outbox send, queue receive count,
  outcome, and stable error code.
- Never log raw requests/events, URLs, paths containing invite tokens, queries,
  bodies, headers, cookies, authorization, join secrets, connection strings,
  raw player text, prompts, or rejected model output.
- Measure p50/p95/p99 separately for database reads, embeddings, model calls,
  validation, commit, full player action, ambient job, and transition age.
- Alarm immediately on a visible DLQ message, infrastructure quarantine,
  outbox abandonment, `ACTION_PROCESSING_EXHAUSTED`, warmup failure, repeated
  Lambda timeout, or processing age beyond twice its claim duration.
- Add service dashboards for API status/latency, Lambda errors/throttles,
  outbox/ambient terminal states, SQS age/depth/DLQ, database timeouts/retries,
  model fallback/validation failures, and cost mode.
- Route alarms to the documented operator contact without placing player or
  secret data in notifications.

**Deliverables**

- Structured logger/metrics contracts, log redaction tests, dashboards, alarms,
  retention policies, and a metric-to-response reference.

#### P7-09 — Establish the read-only Managed MCP inspection path

**Work**

- Configure CockroachDB Cloud Managed MCP at its managed endpoint with a
  separately authenticated inspection identity.
- Expose and verify only the accepted views:
  `npc_beliefs`, `belief_evidence`, `claim_paths`,
  `relationship_timeline`, `promise_status`, `object_history`,
  `objective_truth`, `case_progress`, `world_event_timeline`, `agent_runs`,
  `idempotency_status`, `ambient_jobs`, and `access_operations` in the
  `inspection` schema.
- Verify the views omit session/invite/join hashes, cookies, raw processing
  tokens, database credentials, raw model output, and unvalidated text.
- Create a short judge runbook that starts from a known town/action or job ID
  and reconstructs the canonical demo path in causal order, including the
  unchanged item location and a belief reversal.
- Add privilege tests that fail every attempted insert/update/delete/DDL and
  reject access outside the inspection surface.

**Deliverables**

- Working Managed MCP connection, read-only role/grants, view contract tests,
  and judge/developer inspection runbook with safe example questions/queries.

### Workstream F — Deployment, rollback, and real-boundary verification

#### P7-10 — Make deploy, bootstrap, rollback, and smoke procedures repeatable

**Work**

- Implement/document the accepted operator sequence: install/validate, CDK
  bootstrap, synth/diff/deploy, migrate, seed/bootstrap, prompt prewarm, and
  public smoke test.
- Separate infrastructure deploy from destructive/irreversible schema change.
  Require migration backups/compatibility checks appropriate to the change and
  keep application rollback compatible with the deployed schema.
- Define rollback by failure class: web asset/CloudFront release, Lambda/CDK
  release, prompt/model configuration, migration, and credential compromise.
  Never claim a data rollback can be automatic when causal rows are already
  committed.
- Record stack outputs that are safe for operators: public URL, region, release,
  queue/alarm identifiers, and secret ARNs/names, never secret values or invite
  capabilities.
- Smoke the health route plus authenticated create/join/view/action/leave/status
  behavior over CloudFront. Confirm queued work reaches a terminal transition
  and inspection can reconstruct it.

**Deliverables**

- Operator deployment and rollback runbook, versioned release manifest, smoke
  runner, and retained sanitized smoke evidence.

#### P7-11 — Run the deployed security, isolation, and operations gate

**Work**

- Verify same-origin/Origin checks, secure path-scoped cookie attributes,
  tokenless invite bootstrap URL, cache policies, no raw access logs, and
  sanitized API/Lambda logs against a canary invite value.
- Exercise cross-town ID/session/cookie misuse at API and database boundaries;
  every request/query must remain town-scoped.
- Verify runtime and inspection roles cannot assume migration/admin authority,
  retrieve unauthorized secrets, or mutate inspection data.
- Trigger safe test signals for alarm paths without corrupting live demo towns:
  a synthetic warmup failure metric, DLQ test resource/message procedure, and
  known terminal action/ambient metrics where supported.
- Review the synthesized/deployed configuration against every exact Phase 7
  timeout, concurrency, retention, retry, and budget value.

**Deliverables**

- Signed-off cloud configuration checklist, sanitized leakage-scan evidence,
  privilege matrix, alarm delivery evidence, and public smoke result.

## 5. Artifacts

Phase 7 is expected to produce or complete:

- typed CDK stacks/constructs and synth assertions;
- environment/configuration schema and release manifest;
- web asset publication and cache invalidation workflow;
- CockroachDB production bootstrap, grants, migrations, seed/bootstrap, and
  resource-limit documentation;
- Secrets Manager bootstrap/rotation guide and IAM privilege matrix;
- prompt prewarm runner and warmup schedule;
- structured logging/metrics contracts, redaction tests, dashboards, alarms,
  log-retention policies, AWS Budget, and internal cost controls;
- Managed MCP configuration, read-only inspection grants, view contract tests,
  and causal inspection runbook;
- deployment, rollback, smoke-test, and incident-response runbooks;
- sanitized deployment/smoke/security evidence.

## 6. Dependencies and sequencing

```text
P7-01 -> P7-02 -> P7-03
P7-01 -> P7-04 -> P7-05
P7-02 + P7-04 -> P7-06
P7-05 + P7-06 -> P7-07
P7-02 + P7-03 + P7-05 + P7-06 -> P7-08
P7-05 -> P7-09
P7-03 + P7-05 + P7-06 + P7-08 -> P7-10
P7-07 + P7-09 + P7-10 -> P7-11
```

- CDK can be synthesized before credentials exist, but deployment validation
  cannot pass with placeholder secret/model configuration.
- Database migrations precede runtime traffic; least-privilege grants and
  inspection views are validated before publishing the public URL.
- Observability and cost controls deploy with the resources they monitor, not
  after the first real traffic.
- Managed MCP is operationally separate from the player request path. A failure
  to configure inspection does not grant fallback access through the API; it
  fails the Phase 7 gate.
- Phase 8 starts only after P7-11 provides a known deployed release and
  repeatable fresh-town procedure.

## 7. Verification matrix

Commands below are **planned or contract-mandated command surfaces**. Reconcile
their exact scripts with the Phase 0 workspace rather than assuming they exist.

| Concern | Boundary and evidence | Planned command |
|---|---|---|
| CDK correctness | Synth assertions for all exact timeouts, queue, schedules, IAM, cache/logging, retention, alarms, and budgets | `pnpm cdk:synth` and `pnpm test:infra` |
| Deployment review | Human-readable resource/policy change before apply | `pnpm cdk:diff` |
| Production deploy | Repeatable stack update from operator machine | `pnpm cdk:deploy` |
| Database bootstrap | TLS connection, migrations, grants, inspection views, seed, vector indexes | `pnpm db:migrate` and `pnpm db:seed-demo` |
| Prompt readiness | Four exact model/schema grammar pairs warm successfully | `pnpm prompts:prewarm` |
| Public smoke | Health plus authenticated create/join/action/leave/resume over CloudFront | `pnpm smoke-test` |
| Security headers/cache | Public probes verify Origin, headers, cache, cookies, and tokenless URLs | `pnpm test:security --target production` |
| Tenant isolation | Cross-town API/database fixtures and composite-key checks | `pnpm test:integration --grep tenant-isolation` |
| Log leakage | Canary invite/join/session values absent from accessible logs and notifications | `pnpm test:log-redaction --target production` |
| Queue/recovery | FIFO/DLQ configuration plus deployed duplicate/terminal behavior | `pnpm test:cloud --grep ambient` |
| IAM/DB/MCP privilege | Runtime and inspection identities pass allowed reads and fail forbidden mutation/admin operations | `pnpm test:privileges --target production` |
| Alarms | Safe synthetic trigger reaches operator and returns to OK | `pnpm test:alarms` |
| Cost modes | Threshold transitions, concurrency, player-safe errors, budget resources | `pnpm test:cost-controls` |
| Complete gate | Accepted pre-submission sequence plus inspection reconstruction | `pnpm test && pnpm cdk:deploy && pnpm db:migrate && pnpm db:seed-demo && pnpm prompts:prewarm && pnpm smoke-test` |

Do not include raw secrets or invite capabilities in command output retained as
evidence. A test that needs a canary secret must compare a hash or perform a
bounded absence scan without printing the value.

## 8. Risks, decisions, and fallback strategy

| Risk or decision | Required response | Safe fallback |
|---|---|---|
| First-use structured grammar compilation exceeds the player budget | Run all four exact warmups after deploy and every 20 hours; alarm on failure | Normal dialogue uses authored fallback; normalization returns its accepted terminal retry-new-action error |
| Public CockroachDB networking expands exposure | Enforce verify-full TLS, random credentials, smallest grants, timeouts, pool/concurrency caps, and rotation | Stop public traffic if credential/TLS assurance is lost; do not downgrade verification |
| Invite token leaks through edge or logs | Disable URI-bearing access logs, strip route token before fetch, prohibit third-party invite resources, scan with a canary | Invalidate/rotate affected capability/security key as documented and suspend creation if exposure is unresolved |
| SQS send acknowledgement is uncertain | Leave durable outbox state retryable; Recovery republishes the original identity | Duplicate publication is absorbed by FIFO plus database execution ledger |
| Queue/model work misses five-minute transition deadline | Recovery abandons/quarantines and alarms; late deliveries no-op | Player sees `complete` and can re-enter; never expose or manually patch hidden state |
| Alarm or dashboard cardinality drives cost | Keep standard metrics and bounded dimensions; log detailed IDs in short-retention structured records | Remove non-actionable custom metrics, not required failure signals |
| Billing data is delayed | Use application token ledger and threshold state as immediate control | Switch to cheaper model/tighter limits/authored fallback at accepted thresholds |
| Cost ledger/config switch fails | Treat as release-blocking because uncapped Sonnet exceeds the ceiling | Force authored fallback and stop new towns while retained data stays readable |
| CockroachDB RU/storage exceeds allowance | Measure after smoke and first real visits; enforce Basic resource limit | Stop new towns before corrupting existing play; keep read access available |
| A migration is not backward compatible with the previous Lambda | Gate deploy on compatibility and document forward/rollback ordering | Roll application forward to a compatible build; never destructively reverse causal history blindly |
| MCP is mistakenly granted base-table/admin access | Privilege tests and grants must fail the release | Disable the MCP connection until least privilege is restored; never expose inspection through player API |
| Service quotas/model access differ by account | Validate before deploy and report exact missing permission/quota | Keep environment unpublished until resolved; local mocks are not production proof |

## 9. Exit checklist

- [ ] A clean operator environment can validate config, bootstrap CDK, deploy,
      migrate, seed/bootstrap, prewarm, and smoke the system using documented
      commands.
- [ ] S3/CloudFront/API Gateway/Game/Ambient/Recovery/SQS/EventBridge resources
      match the accepted topology and exact reliability values.
- [ ] Static and API cache behavior, Origin validation, referrer policy,
      path-scoped secure cookies, and tokenless invite bootstrap pass public
      probes.
- [ ] CloudFront/S3 URI access logs are disabled; API/Lambda logs and alarms
      contain no canary invite, cookie, join, authorization, player text, raw
      prompt/output, or connection secret.
- [ ] Only the required three application secrets exist in AWS and IAM access
      is least privilege; migration and inspection credentials remain outside
      Lambda authority.
- [ ] CockroachDB uses verify-full TLS, bounded pools/timeouts, separate roles,
      app DML-only grants, a Basic resource limit, and validated vector indexes.
- [ ] All four Bedrock model/schema pairs prewarm; warmups create no town or
      `agent_runs` state and failures alarm.
- [ ] Internal cost thresholds are concurrency-safe, AWS Budget alerts exist at
      `$5`, `$9`, and `$11`, and CockroachDB usage is separately observable.
- [ ] Required logs, p50/p95/p99 metrics, dashboards, retention, and alarm
      delivery are present for API, models, DB, queue, retries, terminal states,
      and cost.
- [ ] The Managed MCP identity can read every accepted inspection view, cannot
      mutate or access secrets, and reconstructs the public smoke action's
      causal chain.
- [ ] Cross-town and cross-role isolation tests pass at public API, database,
      IAM, and MCP boundaries.
- [ ] Deployment and rollback runbooks distinguish web, runtime, prompt/model,
      migration, and credential failures without claiming unsafe data rollback.
- [ ] A public smoke test completes creation/join/action/leave/re-entry and
      records only sanitized evidence for the exact deployed release.

## 10. Handoff to Phase 8

Phase 8 receives:

- one known-good deployed release and a release manifest containing commit,
  content/rules/prompt/schema versions, model profiles, migration version, and
  public URL;
- fresh-town bootstrap and safe rollback/rotation procedures;
- dashboards, alarms, cost controls, and an operator contact path;
- a working read-only Managed MCP connection and causal inspection runbook;
- public smoke, privilege, tenant-isolation, and leakage-scan evidence; and
- the list of measured smoke latencies/costs plus any accepted tunable-parameter
  changes.

Phase 8 may exercise and tune the deployed system, but must update every
coupled contract and configuration when a reliability value changes. It must
not disable alarms, inspection restrictions, grounding, or cost controls to
make a rehearsal pass.
