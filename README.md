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

> **Project status:** the MVP product direction, system architecture, logical
> schema, HTTP API, reliability, deterministic rules, and authored game content
> are accepted. SQL migrations and application implementation are the next
> phase.

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
with a controlled language-generation layer.

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
4. **Render** short dialogue from an approved bundle using Amazon Bedrock.
5. **Validate** every model result against canonical entities and allowed claims.
6. **Persist** the event, memory, provenance, and telemetry transactionally.

Models may interpret language and phrase approved information. They may not
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

> **Lambda runs the work. Bedrock provides language. CockroachDB remembers. SQS waits and retries.**

## Hackathon proof

CockroachDB is not used as a passive transcript store. It holds both current
simulation state and the causal history behind NPC behaviour.

- **Distributed Vector Indexing** retrieves semantically relevant episodes
  within one NPC and one town.
- **CockroachDB Cloud Managed MCP Server** provides judges with read-only views
  of beliefs, evidence, provenance, promises, object history, and agent runs.

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

The schema, HTTP API, deterministic rules, authored content, Bedrock prompt,
and interface contracts are implementation-ready. SQL migrations and local
development commands will be added with the implementation.
