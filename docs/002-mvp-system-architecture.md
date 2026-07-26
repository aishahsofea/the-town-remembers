# Decision 002: MVP System Architecture

- **Project:** The Town Remembers
- **Status:** Accepted
- **Date:** 2026-07-26
- **Scope:** Application stack, agent loop, data flow, deployment, security, cost, and hackathon proof

## Purpose

This document explains how the MVP works.

The short version is:

> Lambda runs the work. Bedrock provides language. CockroachDB remembers. SQS waits and retries.

The system is small on purpose. One developer must be able to build it in ten days and keep it online through judging.

## Hackathon fit

The project meets the main requirement:

> Build an agentic application on AWS with CockroachDB as its persistent memory.

It uses two required CockroachDB tools:

1. **Distributed Vector Indexing**
   - Used during NPC conversations and ambient ticks.
   - Finds memories that are semantically related to the current situation.
   - Runs inside CockroachDB. There is no separate vector database.

2. **CockroachDB Cloud Managed MCP Server**
   - Gives judges a read-only inspection path.
   - Shows beliefs, evidence, provenance, promises, relationships, and agent runs.
   - Does not take part in normal player requests.

It uses these AWS services:

- Amazon Bedrock
- AWS Lambda
- Amazon SQS
- Amazon API Gateway
- Amazon S3
- Amazon CloudFront
- AWS Secrets Manager
- Amazon CloudWatch
- Amazon EventBridge

We will not claim the `ccloud` CLI or Agent Skills as hackathon integrations.

## System map

```mermaid
flowchart LR
    Player["Player browser"] --> CF["CloudFront"]
    CF --> Web["S3: React application"]
    CF --> API["API Gateway: /api"]
    API --> Game["Game API Lambda"]

    Game --> Bedrock["Amazon Bedrock"]
    Bedrock --> Haiku["Haiku: claims and choices"]
    Bedrock --> Sonnet["Sonnet: dialogue"]
    Bedrock --> Titan["Titan: embeddings"]

    subgraph CRDB["CockroachDB Basic"]
        direction TB
        State["Town state and events"]
        Memory["Episodes and vector memories"]
        Outbox["outbox table<br/>pending delivery jobs"]
    end

    Game -->|"read and write"| State
    Game -->|"insert job with event transaction"| Outbox
    Game -->|"publish job after commit"| Queue["SQS: delayed ambient jobs"]
    Queue --> Tick["Ambient Tick Lambda"]
    Tick --> Bedrock
    Tick --> State
    Tick --> Memory

    EventBridge["EventBridge schedule"] -->|"invoke"| Recovery["Recovery Lambda"]
    Recovery -->|"find and mark unsent jobs"| Outbox
    Recovery -->|"publish missed jobs"| Queue

    MCP["Managed MCP: read-only inspection"] --> State
    MCP --> Memory
```

## Main technology choices

| Area | Choice | Reason |
|---|---|---|
| Language | TypeScript | One language across the project |
| Web app | React and Vite | Small and fast to build |
| Infrastructure | AWS CDK in TypeScript | Repeatable AWS setup |
| API | API Gateway HTTP API | Simple Lambda entry point |
| Compute | AWS Lambda | No server to keep running |
| Async work | Amazon SQS | Reliable delayed ambient ticks |
| Database | CockroachDB Basic | Persistent SQL and vector memory |
| Models | Amazon Bedrock | Required AWS-powered agent environment |
| Validation | Zod and Bedrock structured output | Reject malformed model results |
| SQL access | `pg` with Kysely | Typed queries with standard PostgreSQL drivers |
| Tests | Vitest and Playwright | Unit, integration, and browser tests |

## What “agentic” means here

An NPC does more than return chat text.

Each turn follows a bounded loop:

1. **Observe:** Read the player action and current town state.
2. **Recall:** Retrieve relevant memories from CockroachDB.
3. **Decide:** Choose from allowed claims, disclosures, or ambient actions.
4. **Validate:** Reject invented facts or invalid actions.
5. **Act:** Update deterministic game state.
6. **Persist:** Save the event, memory, evidence, and provenance.

The loop ends after one player response or one ambient tick. It cannot run forever.

Lambda is temporary. A Lambda invocation starts, does this work, and ends. It never acts as permanent memory.

## Model responsibilities

### Claude Haiku 4.5

Use Haiku for small, structured tasks:

- Normalize a natural-language claim.
- Classify player intent.
- Choose a bounded ambient action.
- Repair one invalid structured response.

### Claude Sonnet 4.6

Use Sonnet for player-facing dialogue:

- Speak in the NPC's voice.
- Express doubt, trust, fear, or suspicion.
- Mention only approved memories and claims.

### Titan Text Embeddings V2

Use Titan for semantic memory search:

- Embed each episode once.
- Embed the current query once.
- Store 256-dimensional vectors in CockroachDB.

### Model boundary

Models may:

- Interpret language.
- Select from allowed choices.
- Render short dialogue.

Models may not:

- Change objective truth.
- Invent people, places, objects, or evidence.
- Calculate belief scores.
- Decide whether a promise was kept.
- Commit directly to the database.

The application validates every model result before saving it.

Responses are not streamed. The full response is generated, checked, saved, and then shown to the player.

## Player action flow

```mermaid
sequenceDiagram
    participant P as Player
    participant L as Game Lambda
    participant C as CockroachDB
    participant B as Bedrock

    P->>L: Ask, tell, show, give, or promise
    L->>C: Load town and NPC snapshot
    L->>B: Normalize intent or claim
    L->>C: Search relevant vector memories
    L->>L: Apply deterministic rules
    L->>B: Render approved dialogue
    L->>L: Validate result
    L->>C: Check revision and commit
    L-->>P: Return complete response
```

Bedrock calls happen outside database transactions. This avoids holding a transaction open while waiting for a model.

Before committing, Lambda checks the town revision. If relevant state changed, it reloads and tries once more.

## Ambient tick flow

Pressing **Leave Town** creates an ambient tick.

1. The Game Lambda writes a departure event and an outbox row in one transaction.
2. The outbox job is sent to SQS with a 20-second delay.
3. SQS wakes the Ambient Tick Lambda.
4. The tick loads new events and relevant NPC memories.
5. Haiku chooses an allowed action or `do_nothing`.
6. Application code validates and applies the choice.
7. CockroachDB stores the new episode, provenance, and belief evidence.

A tick may perform at most two ambient actions.

SQS may deliver a job more than once. Each job has a unique idempotency key, so duplicate delivery cannot advance the town twice.

The Recovery Lambda checks for unsent outbox rows. EventBridge runs it on a short schedule. This repairs the gap if Lambda stops after the database commit but before sending the SQS message.

## CockroachDB as persistent memory

CockroachDB stores both current state and history.

### Current-state tables

- `towns`
- `players`
- `npcs`
- `npc_beliefs`
- `belief_evidence`
- `relationships`
- `promises`
- `items`
- `case_board_entries`

These tables answer: “What is true now?”

### History tables

- `world_events`
- `episodes`
- `claims`
- `claim_transmissions`
- `agent_runs`
- `outbox`

These tables answer: “How did we get here?”

Episodes and world events are append-only. New evidence does not erase old evidence.

### Tenant isolation

Every town-owned row includes `town_id`.

Composite keys and foreign keys include `town_id`. A query for one town must not reach another town.

### Vector memory

Each memory row includes:

- `town_id`
- `npc_id`
- Episode text
- Importance
- Event time
- Related claim and entity IDs
- `embedding VECTOR(256)`

The vector index uses `town_id` and `npc_id` as prefix columns. Retrieval stays inside one NPC in one town.

Vector similarity only finds candidates. Application code reranks them using:

- Semantic similarity
- Recency
- Importance
- Direct observation
- Open promises or grievances
- Contradictions

Usually, only six to ten memories enter a prompt.

## Beliefs and provenance

Beliefs use an integer evidence ledger. They are not fake probabilities.

Evidence can add or remove weight based on:

- Direct observation
- Trust at the time testimony was heard
- Number of hearsay hops
- Independent support
- Contradictory evidence
- Caught lies
- Broken promises

Trust is saved with the testimony. A later argument does not rewrite old testimony.

Only an explicit `source_discredited` event can trigger a targeted review of past testimony.

Players see simple labels:

- Doubtful
- Leaning
- Convinced

Players do not see numeric scores.

The case board may show a spoiler-safe path:

> You told Mara → Mara spoke with Nessa → Nessa mentioned it to another player

It does not reveal hidden truth or private NPC reasoning.

## Judge inspection

Managed MCP uses a separate, read-only inspection surface.

The `inspection` schema exposes views such as:

- `inspection.npc_beliefs`
- `inspection.belief_evidence`
- `inspection.claim_paths`
- `inspection.relationship_timeline`
- `inspection.promise_status`
- `inspection.object_history`
- `inspection.agent_runs`

These views make the system explainable without granting write access.

## Reliability rules

- Use short CockroachDB transactions.
- Retry bounded serialization conflicts.
- Use conditional updates for unique items.
- Add idempotency keys to player actions and queue jobs.
- Validate all model output.
- Retry one invalid model result.
- Use an authored fallback if the retry fails.
- Do not commit a claim that failed normalization.
- Do nothing if an ambient choice remains invalid.
- Store model name, prompt version, token use, latency, and outcome in `agent_runs`.

## Security

### Player access

- A shared judge code is required to create a town.
- The code lives in AWS Secrets Manager.
- Joining an existing town only requires its unguessable invite link.
- A secure, HTTP-only cookie identifies a guest player.
- Only a hash of the player token is stored.

### Database access

The MVP uses default Lambda internet access and the public CockroachDB Basic endpoint. It does not use a VPC or NAT Gateway.

This is acceptable for a temporary, low-sensitivity demo. It is not the intended production network design.

Required controls:

- Use `sslmode=verify-full`.
- Store database credentials in Secrets Manager.
- Use a random 256-bit password.
- Use separate `migration_admin`, `app_runtime`, and read-only inspection access.
- Give `app_runtime` only required DML permissions.
- Use parameterized SQL.
- Set query and connection timeouts.
- Keep database pools small.
- Cap Lambda concurrency.
- Rate-limit API and access-code attempts.
- Never log secrets or connection strings.
- Rotate credentials after recording and after judging.

A production version should use private networking.

## Cost controls

The monthly operating ceiling is **$12.50**.

The application records estimated model cost from actual input and output tokens.

Cost modes:

| Estimated monthly use | Behavior |
|---|---|
| Below $8 | Sonnet dialogue; Haiku mechanics |
| $8 to $10 | Haiku handles all dialogue |
| $10 to $11.50 | Stop new towns and tighten action limits |
| $11.50 and above | Use authored fallbacks; keep data readable |

AWS Budget alerts are set at:

- $5
- $9
- $11

AWS billing alerts can be delayed. The internal ledger is the immediate control.

Other controls:

- Keep prompts short.
- Retrieve at most ten memories.
- Keep dialogue short.
- Embed each episode once.
- Apply per-player, per-town, and global action limits.
- Set a CockroachDB Basic resource limit.

## Deployment

Deployment is run from the developer's laptop.

### One-time setup

1. Create a CockroachDB Basic cluster in `us-east-1`.
2. Configure AWS credentials.
3. Run `pnpm cdk:bootstrap`.
4. Run `pnpm cdk:deploy`.
5. Add the database credentials and judge code to Secrets Manager.

### Before submission

```bash
pnpm test
pnpm cdk:deploy
pnpm db:migrate
pnpm db:seed-demo
pnpm smoke-test
```

Run migrations only when the schema changes. Seed the demo town before recording.

Judges use the live URL and access code. They do not need to deploy the project.

Keep the project online through the judging period. Keep all towns until the project is retired.

## Test plan

The minimum test set is:

- Unit tests for claims, beliefs, promises, gates, and reducers.
- Database tests for town isolation and conflicting item transfers.
- Agent evaluations for valid structure and allowed claims.
- Two-browser tests for asynchronous multiplayer behavior.
- Queue tests for duplicate delivery.
- A production smoke test.
- A repeatable demo seed.

## Demo proof

The short demo uses two browser sessions and one MCP inspection.

1. Player A tells Mara a misleading claim.
2. Player A leaves town.
3. The ambient tick propagates the claim.
4. Player B receives changed dialogue.
5. Player B presents contradictory evidence.
6. MCP shows why the belief formed and why it changed.

All shown actions are live. The mystery data is pre-seeded for reliability.

## Main trade-offs

### Chosen

- Small, bounded agent loops
- Deterministic game rules
- Persistent and explainable memory
- Serverless AWS compute
- Public CockroachDB endpoint with strong credentials
- Manual, repeatable deployment

### Deferred

- Bedrock Agents
- ECS or EKS
- PrivateLink or a NAT Gateway
- Continuous simulation
- User accounts
- Admin dashboard
- CI/CD pipeline
- A separate vector database
- More mysteries

## Glossary

- **API Gateway:** The public door to the backend.
- **Bedrock:** AWS service that provides the language and embedding models.
- **CDK:** TypeScript code that creates AWS resources.
- **CloudFront:** The public web address and content delivery layer.
- **CockroachDB:** The permanent town database and vector memory.
- **Embedding:** A list of numbers used to find text with similar meaning.
- **Idempotent:** Safe to run again without applying the same change twice.
- **Lambda:** Temporary code that wakes for one task and then stops.
- **MCP:** A standard way for an AI tool to inspect approved external data and tools.
- **Outbox:** A database list of messages that still need to be sent.
- **Provenance:** The recorded path showing where a claim came from.
- **SQS:** A reliable AWS queue that holds work until Lambda can process it.
- **Vector index:** A database index used to find semantically similar memories.

## References

- [CockroachDB vector indexes](https://www.cockroachlabs.com/docs/stable/vector-indexes)
- [CockroachDB Cloud Managed MCP Server](https://www.cockroachlabs.com/docs/cockroachcloud/connect-to-the-cockroachdb-cloud-mcp-server)
- [CockroachDB Basic clusters](https://www.cockroachlabs.com/docs/cockroachcloud/plan-your-cluster-basic)
- [Amazon Bedrock structured output](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html)
- [AWS Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Titan Text Embeddings V2](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
