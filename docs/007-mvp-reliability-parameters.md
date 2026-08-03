# MVP Reliability Parameters

- **Project:** The Town Remembers
- **Status:** Accepted implementation baseline; measured tuning pending
- **Date:** 2026-08-02
- **Scope:** Time budgets, processing claims, retries, queue delivery, recovery,
  concurrency, database limits, and terminal fallbacks

## Purpose and authority

This document turns the reliability behavior already defined by the product,
schema, and HTTP contracts into concrete runtime configuration.

The values below are the implementation baseline. A value marked **tunable**
may change after an instrumented smoke test if its surrounding invariant still
holds. Protocol behavior, operation identity, terminal states, and atomicity do
not change merely because measured latency changes.

When duplicated summaries disagree, the detailed schema and HTTP contracts
remain authoritative for data and response shape, while this document is
authoritative for runtime parameter values.

## Reliability invariants

1. A processing claim outlives the maximum lifetime of its worker.
2. Only the current processing token may commit an operation.
3. SQS visibility is at least six times the Ambient Tick Lambda timeout.
4. Every retry of one logical operation reuses its original idempotency or job
   key.
5. Player effects and their saved response commit atomically. Ambient effects
   and job completion commit atomically.
6. An ambiguous commit is resolved by reading the durable operation record; it
   is never followed by a blind write retry.
7. Model calls, embeddings, and SQS publications never run inside a database
   transaction.
8. A retry or repair starts only when its complete worst-case bound fits before
   the operation deadline.
9. Failure always reaches a bounded outcome: saved fallback, retryable action,
   terminal failure, completed `do_nothing`, abandoned delivery, or quarantined
   ambient execution.

Use CockroachDB time for claim expiry, send expiry, retry timestamps, and
transition deadlines. Browser and Lambda clocks do not authorize takeover or
completion.

## Parameter summary

| Area | Parameter | MVP value |
|---|---|---:|
| Player API | API Gateway integration timeout | 30 seconds |
| Player API | Game Lambda hard timeout | 28 seconds |
| Player API | Application completion budget | 24 seconds |
| Player API | Reserved validation, fallback, and commit window | Final 4 seconds |
| Player API | Response serialization reserve | 500 milliseconds |
| Player API | Processing claim | 35 seconds; no renewal |
| Player API | Processing response | `202`, `Retry-After: 2` |
| Player API | Automatic browser recovery window | 70 seconds |
| Player API | Simultaneous processing actions | One per player |
| Ambient queue | Type | SQS FIFO |
| Ambient queue | Queue delivery delay | 20 seconds |
| Ambient queue | Message group | `town_id` |
| Ambient queue | Deduplication ID | `job_key` |
| Ambient queue | Lambda batch size | 1 |
| Ambient queue | Event-source maximum concurrency | 5 |
| Ambient queue | Function reserved concurrency | 5 |
| Ambient worker | Lambda hard timeout | 30 seconds |
| Ambient worker | Application completion budget | 24 seconds |
| Ambient worker | Reserved validation and commit window | Final 4 seconds |
| Ambient worker | Processing claim | 45 seconds; no renewal |
| Ambient queue | Visibility timeout | 180 seconds |
| Ambient queue | Maximum receives before DLQ | 5 |
| Ambient queue | Source retention | 4 days |
| Ambient queue | DLQ retention | 14 days |
| Ambient transition | Hard deadline after departure | 5 minutes |
| Initial outbox send | Total publication budget | 2 seconds |
| Outbox send claim | Expiry | 30 seconds |
| Recovery | EventBridge schedule | Once per minute |
| Recovery | Lambda hard timeout | 30 seconds |
| Recovery | Rows per invocation | 25 |
| Recovery | Failed-send backoff | 1 minute, then 2 minutes |
| CockroachDB | Connection timeout | 3 seconds |
| CockroachDB | Statement timeout | 3 seconds or remaining budget, whichever is less |
| CockroachDB | Transaction deadline | 5 seconds or remaining budget, whichever is less |
| CockroachDB | Pool size per warm Lambda environment | 2 |
| CockroachDB | Serialization retries | At most 3 retries |
| Town revision | Model-backed reload and rerun | At most 1 |
| Model transport | Retryable throttling/5xx retry | At most 1 |
| Model validation | Semantic repair | At most 1 |
| Model schemas | Structured-output warmup | Four model/schema pairs every 20 hours during live judging |

## Player-action execution

### Time budget

The Game Lambda records an absolute application deadline when it begins. All
pre-commit database reads, Titan calls, and Bedrock calls must end before the
final four-second reserve. The final transaction uses no more than the smaller
of its five-second transaction budget and the remaining application budget,
while leaving 500 milliseconds to serialize the response.

The model client must receive an abort deadline rather than merely relying on
the Lambda timeout. Dialogue that cannot finish safely uses the authored
fallback. Claim normalization has no semantic fallback and stores the accepted
terminal `503 MODEL_UNAVAILABLE_RETRY_ACTION` response.

Bedrock structured-output schemas are stable and prewarmed because first-time
grammar compilation can exceed the application budget. Deployment and smoke
testing warm Haiku with normalization, ambient, and dialogue schemas and Sonnet
with the dialogue schema. During live judging, EventBridge invokes the Game
Lambda's non-player warmup path every 20 hours. Warmups create no town or
`agent_runs` rows; CloudWatch records their cost, latency, and failures.

### Claim and browser recovery

A player processing claim lasts 35 seconds and does not renew. This is longer
than the 28-second Lambda lifetime, so a live worker cannot lose its claim. It
also lets a replacement start soon after a timed-out worker is certainly dead.

While the claim is active, a duplicate `POST` returns `202` and the browser
polls the private action-status route every two seconds. Poll requests never
start work. If the action is still processing when the 35-second claim can have
expired, the browser resends the original `POST`, body, and idempotency key once
to permit conditional takeover. It continues polling for a total automatic
recovery window of 70 seconds. After that it shows a manual retry control that
still reuses the same key.

The server allows at most one `processing` player action per
`(town_id, player_id)`. A different new action encountered while a live claim
exists returns `409 ACTION_IN_PROGRESS`, `Retry-After: 2`, and the blocking
action's status location without creating a new action record. If the blocking
claim has expired, the server may atomically fail that abandoned action with
saved `409 ACTION_SUPERSEDED` and no effects, then accept the new action in the
same transaction. A same-key replay is resolved before this check.

### Retry classes

- **Transport:** A Bedrock or Titan throttling/5xx failure receives at most one
  retry, and only if that complete call fits before the reserved window.
- **Semantic:** Invalid structured model output receives at most one repair,
  validated again from scratch. Dialogue then falls back; an invalid ambient
  choice becomes `do_nothing`.
- **Town revision:** Relevant state is reloaded and model work rerun once. A
  second conflict stores the accepted retryable `409 ACTION_CONFLICT` under the
  same key.
- **Processing takeover:** After three claimed attempts without a committed
  result, the next owner stores `ACTION_PROCESSING_EXHAUSTED` with no effects.
- **Dependency failure:** A terminal dependency failure is saved and replayed.
  An intentional later attempt uses a new key only when the saved error contract
  explicitly says to do so.

Automatic retries do not stack blindly. For example, a transport retry followed
by semantic repair followed by a revision rerun is allowed only when every step
still fits within the same 24-second application budget.

## CockroachDB execution

Use `SERIALIZABLE` transactions. Retry SQLSTATE `40001` at most three times with
jittered delays of approximately 25 ms, 75 ms, and 225 ms. Re-execute the full
transaction body and re-check every conditional write.

Set the `pg` connection timeout to three seconds and keep at most two database
connections in each warm Lambda environment. Set `statement_timeout` to the
smaller of three seconds and the remaining operation budget. Application code
also enforces a five-second maximum transaction deadline.

A connection failure before a transaction may receive one operation-level
retry if the deadline permits. A connection loss during `COMMIT` is ambiguous:
the worker first reads `player_actions` or `ambient_job_executions` by stable
identity. A completed record is replayed; only a proven non-commit may be
retried.

## Ambient queue and worker

Use one SQS FIFO queue with a queue-level 20-second delay:

- `MessageGroupId = town_id` serializes ambient work within one town.
- `MessageDeduplicationId = job_key` suppresses uncertain duplicate sends
  within SQS's deduplication window.
- The durable outbox, execution record, and numbered effect keys remain
  necessary because queue deduplication is time-bounded and Lambda processing
  remains retryable.
- Batch size is one, so one failed job cannot replay an otherwise successful
  neighbor in the same Lambda batch.
- Maximum event-source concurrency and reserved function concurrency are both
  five. Different towns may run concurrently; one town remains ordered.
- Provisioned polling and provisioned concurrency remain disabled.

FIFO queues do not support per-message timers. Both initial and recovery
publications therefore use the queue's 20-second delay. `not_before` remains in
the authoritative outbox row, and the worker refuses premature application.

The Ambient Tick Lambda has a 30-second hard timeout and a 24-second application
budget. Its final four seconds are reserved for validation, `do_nothing` or
quarantine selection, and atomic commit. Its processing claim lasts 45 seconds
and does not renew.

The queue visibility timeout is 180 seconds, six times the Lambda timeout. With
the initial 20-second delay, one failed invocation can become visible again
around 200 seconds after departure, leaving roughly 100 seconds for a useful
second attempt before the five-minute transition deadline. A later delivery
observes abandonment or quarantine and exits without effects.

Set `maxReceiveCount` to five. The source queue retains messages for four days;
the DLQ retains them for 14 days. Any visible DLQ message raises an immediate
alarm. Manual redrive must preserve the original message body and keys.

## Outbox publication and Recovery Lambda

The request that commits Leave Town makes one best-effort post-commit SQS send
with a total two-second budget. It marks the outbox row `sent` only after an
acknowledgement. Timeout or uncertain acknowledgement leaves retryable durable
state; it never rolls back the already-committed departure.

An outbox sender uses the accepted 30-second send claim. Recovery runs once per
minute, scans at most 25 due `pending` or expired `sending` rows, and republishes
the original job identity. A failed send waits one minute before the next
attempt and two minutes thereafter, always bounded by the five-minute
transition deadline.

The transition deadline, rather than a long send-attempt count, is the terminal
stop condition. At or after five minutes:

- unsent delivery becomes `abandoned`;
- nonterminal execution becomes `quarantined` with no effects;
- the departing player may start another visit; and
- late queue delivery becomes an acknowledged no-op.

Recovery Lambda has a 30-second hard timeout and handles at most 25 rows per
invocation. It performs bounded parallel sends without allowing one invocation
to exceed the database pool or its own deadline.

## Observability and tuning

Record enough information to explain each retry without logging secrets or raw
rejected model output:

- operation or job identity;
- attempt number and processing-token suffix or hash;
- model and prompt version;
- dependency latency and timeout category;
- transaction retry count;
- claim takeover, stale-worker rejection, and ambiguous-commit resolution;
- outbox send attempt, acknowledgement state, and queue receive count; and
- terminal outcome and stable error code.

Alarm on any DLQ message, transition quarantine caused by infrastructure,
outbox abandonment, `ACTION_PROCESSING_EXHAUSTED`, repeated Lambda timeout, or
operation whose processing age exceeds twice its claim duration.

The following values are tunable only after the first instrumented vertical
slice:

- individual Titan, Haiku, and Sonnet call deadlines;
- Game Lambda global concurrency;
- Lambda memory allocation;
- the two-connection pool maximum; and
- claim durations, but only while they remain longer than their worker timeout.

Measure p50, p95, and p99 latency separately for database reads, embeddings,
model generation, validation, and commit. Any timeout change must update the
coupled claim, SQS visibility, transition-deadline analysis, tests, CDK
configuration, and this document together.

## Required verification

Before deployment, automated tests must prove:

1. A worker cannot commit after its claim expires or is replaced.
2. A lost HTTP response replays the stored response without duplicate effects.
3. Polling cannot restart work; the same-key `POST` can take over only after
   expiry.
4. A different action cannot run concurrently for one player, and stale-action
   cleanup cannot race a late commit.
5. Transaction retries stop after the configured bound.
6. Ambiguous commit recovery reads the ledger before any retry.
7. FIFO jobs are ordered per town and parallel across towns.
8. Duplicate publication inside and outside the FIFO deduplication window
   produces no duplicate effects.
9. A failed ambient invocation gets one useful retry opportunity before the
   transition deadline.
10. Deadline, abandonment, and quarantine always unblock the next visit.
11. DLQ redrive preserves the original job key and effect identities.
12. Every model retry, repair, and revision rerun respects the absolute
    application deadline and reserved commit window.

## References

- [API Gateway HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
- [AWS Lambda with SQS configuration](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- [SQS FIFO message groups](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html)
- [SQS FIFO deduplication](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-key-terms.html)
- [SQS delay queues and message timers](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)
- [EventBridge scheduled rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html)
- [CockroachDB transaction retry errors](https://www.cockroachlabs.com/docs/stable/transaction-retry-error-reference)

## Related decisions

- [Decision 002: MVP System Architecture](002-mvp-system-architecture.md)
- [Technical Architecture and Runtime Flows](003-technical-architecture-and-schema.md)
- [Infrastructure Cost Estimate](004-infrastructure-cost-estimate.md)
- [Logical Data Model and Schema Contract](005-logical-data-model-and-schema-contract.md)
- [HTTP API Contract](006-http-api-contract.md)
- [Decision 010: Bedrock Prompt and Structured-Output Contracts](010-bedrock-prompt-contracts.md)
