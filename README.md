# The Town Remembers

**An asynchronous multiplayer mystery where NPCs remember what players said—even when it was a lie.**

The Town Remembers is a small social-deduction game built around persistent,
explainable NPC memory. Players visit the same town at different times. What one
player tells an NPC can change that NPC's beliefs, relationships, and dialogue
for the next player.

The MVP mystery begins when the town's festival bell disappears. Solving it
requires more than finding clues: players must understand who observed what,
who trusts whom, how rumours spread, and which parts of the public story are
actually true.

> **Project status:** Phases 0–4 are merged: workspace, CockroachDB persistence,
> deterministic rules, playable HTTP/browser slice, and bounded NPC memory loop.
> Phase 5 ambient propagation and recovery is in progress. See the
> [phase map](implementation-plans/README.md) for current routing.

## The three-minute explanation

1. Player A tells an NPC a plausible but false claim.
2. Player A leaves town, triggering a bounded ambient world tick.
3. The NPC may repeat that existing claim to a contactable NPC.
4. CockroachDB preserves the communication path and resulting belief evidence.
5. Player B later receives different dialogue because the town remembers what
   Player A did.
6. Player B presents contradictory evidence.
7. Deterministic rules update the belief, while a read-only inspection surface
   shows judges exactly why it formed and why it changed.

This is not an unrestricted chatbot. It is a deterministic mystery simulation
with a controlled language-selection layer.

## What players do

Players enter an isolated town through an unguessable invite link, choose a
guest display name, and take short visits of roughly 10–15 minutes.

They can:

- Travel between four authored locations.
- Inspect authored objects and areas.
- Ask NPCs natural-language questions.
- Tell truths or deliberate lies.
- Show discovered clues or physical items you currently carry.
- Give unique items.
- Accept mechanically verifiable promises.
- Leave attributed notes on a shared case board.
- Submit a final culprit, motive, and location theory.

There are no accounts, player chat, real-time avatars, combat, or unrestricted
"do anything" commands in the MVP.

## Why NPC memory matters

The game deliberately separates reality from what people say about it:

| Layer | Example | Meaning |
|---|---|---|
| Objective state | The bell is physically in the Old Chapel | Canonical simulation state |
| Episode | Nessa saw Corin's cart heading toward the chapel | Something an NPC personally experienced |
| Claim | "The bell is in Reed's Garden" | A proposition someone asserted; it may be false |
| Transmission | Player → Nessa → Mara | Who communicated a claim to whom |
| Belief | Mara is leaning toward the garden claim | A deterministic interpretation of evidence |

A lie can change an NPC's belief without changing the physical world. The
`items` state still controls where the bell can actually be found.

NPC-to-NPC communication happens only during a bounded off-screen world tick.
NPCs do not roam continuously. Application code supplies allowed
`(claim, recipient)` choices from an authored contact graph; the model may select
one or choose `do_nothing`.

## The agent boundary

Every NPC turn follows a finite loop:

1. **Observe** the player action and current town revision.
2. **Recall** relevant NPC memories from CockroachDB vector search.
3. **Decide** beliefs, gates, and permitted disclosures with deterministic code.
4. **Select** short, exact voiced renderings from an approved bundle using Amazon Bedrock.
5. **Validate** every selected ID against canonical claims, outcomes, and memories.
6. **Persist** the event, memory, provenance, and telemetry transactionally.

Models may interpret language and select among approved voiced renderings. They may not
change objective truth, calculate belief scores, resolve promises, or write to
the database.

The design principle is:

> **Variable storytelling, invariant game truth.**

## Technology

| Area | Choice |
|---|---|
| Language | TypeScript |
| Web client | React + Vite |
| Infrastructure | AWS CDK |
| Static delivery | Amazon S3 + CloudFront |
| API and compute | API Gateway HTTP API + AWS Lambda |
| Delayed work | Amazon SQS FIFO |
| Recovery scheduling | Amazon EventBridge |
| Language models | Claude Haiku 4.5 and Claude Sonnet 4.6 through Amazon Bedrock |
| Embeddings | Amazon Titan Text Embeddings V2 |
| Persistent state and vector memory | CockroachDB Basic |
| SQL access | `pg` + Kysely |
| Validation | Zod + Bedrock structured output |
| Tests | Vitest + Playwright |
| Operations | CloudWatch + Secrets Manager |

The short version is:

> **Lambda runs the work. Bedrock selects the voice. CockroachDB remembers. SQS waits and retries.**

## Development toolchain

The repository pins Node.js `24.18.0` LTS and pnpm `11.20.0`. Node is fixed to
an LTS release for a stable implementation baseline, and pnpm is fixed with its
package integrity hash so every contributor and CI job uses the same package
manager build.

After installing the pinned Node version, bootstrap a clean checkout without a
global pnpm installation:

```sh
corepack pnpm install --frozen-lockfile
```

Toolchain upgrades must update `package.json`, `pnpm-workspace.yaml`,
`.node-version`, the package-manager integrity pin, and `pnpm-lock.yaml`
together. See [CONTRIBUTING.md](CONTRIBUTING.md) for workspace ownership,
dependency direction, and boundary-checking commands.

## Run it locally

No secret is needed to build, test, or run what exists today.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm validate
```

`pnpm validate` is the whole gate: formatting, lint, workspace boundaries,
strict type-checking, contract and runtime tests, every build, deterministic
CDK synthesis, and the browser health journey. CI runs the identical command.

To see the page:

```sh
corepack pnpm build
corepack pnpm dev
```

Open `http://127.0.0.1:5173`. Current routes cover health, town creation,
invite/join, player views, deterministic actions, and NPC encounters. Phase 5
adds ambient queue processing and between-visit recovery.

## Run the database locally

CockroachDB is the durable memory, and the tests prove it against a real one.

```sh
corepack pnpm build
corepack pnpm db:up
export TTR_MIGRATION_DATABASE_URL="postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable"
corepack pnpm db:migrate
corepack pnpm db:seed
```

`db:up` downloads a pinned CockroachDB build into an ignored `.cockroach/` and
starts a single node; no Docker daemon is involved. The build has to come first
because the operator commands import workspace packages through `dist`, and the
migration credential has to be named explicitly because it is the one identity
that can reshape the schema — it never defaults, so a mistyped command fails
closed instead of migrating something you did not choose. The last
prints one town's opaque ID and the beliefs its three residents start with —
Mara convinced her sister damaged the bell, Nessa leaning toward a cover story
she was told, Corin quietly disbelieving the story he invented.

## Hackathon proof

CockroachDB is not used as a passive transcript store. It holds both current
simulation state and the causal history behind NPC behaviour.

- **Distributed Vector Indexing** retrieves semantically relevant episodes
  within one NPC and one town.
- **CockroachDB Cloud Managed MCP Server**, configured from the Cloud Console at
  `https://cockroachlabs.cloud/mcp`, provides judges with read-only views of
  beliefs, evidence, provenance, promises, object history, and agent runs.

AWS supplies the agent environment, language and embedding models, synchronous
compute, delayed work, recovery, hosting, secrets, and observability.

## Intended judge demo

The repeatable demo uses two browser sessions and one inspection session:

1. Player A gives Mara a misleading claim.
2. Player A leaves town.
3. The ambient tick propagates the claim.
4. Player B encounters dialogue changed by Player A's contribution.
5. Player B presents contradictory evidence.
6. The inspection views reveal the complete causal path.

All interactions are intended to run live against a pre-seeded mystery.

## Documentation

- [MVP product direction](docs/001-mvp-product-direction.md) — player experience,
  mystery rules, memory semantics, promises, and scope.
- [Accepted system architecture](docs/002-mvp-system-architecture.md) — AWS
  topology, CockroachDB usage, model responsibilities, security, costs,
  deployment, and testing decisions.
- [Technical architecture and runtime flows](docs/003-technical-architecture-and-schema.md)
  — request flows, information boundaries, model roles, idempotency, and
  ambient propagation.
- [Infrastructure cost estimate](docs/004-infrastructure-cost-estimate.md) —
  workload assumptions, cost scenarios, budget controls, and deployment risks.
- [Logical data model and schema contract](docs/005-logical-data-model-and-schema-contract.md)
  — table responsibilities, value domains, invariants, indexes, inspection
  views, and database verification priorities.
- [HTTP API contract](docs/006-http-api-contract.md) — routes, sessions,
  player-safe projections, actions, idempotency, rate limits, errors, visits,
  and ambient transition behavior.
- [MVP reliability parameters](docs/007-mvp-reliability-parameters.md) — runtime
  time budgets, claims, retries, FIFO delivery, recovery, database limits, and
  verification requirements.
- [Deterministic game rules](docs/008-deterministic-game-rules.md) — numerical
  beliefs, relationships, gates, recall, promises, ambient propagation, and
  case progression.
- [Authored game content](docs/009-authored-game-content.md) — objective canon,
  versioned seed keys, NPC knowledge and voices, clue graph, access routes,
  promise offers, case-board visibility, fallbacks, confrontation, and endings.
- [Bedrock prompt and structured-output contracts](docs/010-bedrock-prompt-contracts.md)
  — versioned normalization, dialogue, ambient-choice, and repair prompts;
  machine-readable schemas; validators; fallbacks; and evaluation gates.
- [Interface and interaction design](docs/011-interface-and-interaction-design.md)
  — screen hierarchy, visual system, claim confirmation, pending-action
  recovery, time-passes transition, shared case board, and accessibility.
- [Phased MVP implementation plan](implementation-plans/README.md) —
  implementation sequence, dependencies, outcomes, and phase exit gates from
  engineering foundation through demo readiness.

The schema, HTTP API, deterministic rules, authored content, Bedrock prompt,
and interface contracts are implementation-ready. SQL migrations and local
development commands will be added with the implementation.
