# Infrastructure Cost Estimate

Current-state monthly operating estimate for **The Town Remembers** MVP architecture.

| Estimate detail | Value |
|---|---|
| Estimate date | 2 August 2026 |
| Region | AWS `us-east-1`; CockroachDB Basic in `us-east-1` |
| Currency | USD, excluding tax, foreign exchange, and paid support |
| Confidence | Planning estimate; implementation and measured traffic are not yet available |

> **Planning result: approximately $10.65 per month at 250 player visits.**
>
> This assumes the accepted cost mode switches dialogue from Claude Sonnet 4.6
> to Claude Haiku 4.5 when the internal model-cost ledger reaches $8. If that
> switch fails and Sonnet remains active, the same traffic is approximately
> $12.55 after ongoing allowances.

The architecture is economically viable for a small judging or demo workload,
but the **$12.50 monthly ceiling is tight**. Bedrock remains the main variable
cost. Three Secrets Manager secrets create an approximately $1.20 monthly
floor, while the remaining serverless services should stay within low-volume
allowances.

## 1. Scope and estimation basis

The repository currently contains accepted architecture and logical-schema decisions; application infrastructure has not yet been implemented. This is therefore a design estimate, not a forecast derived from deployed usage. It covers every paid or potentially paid component named in the accepted architecture.

- **Included:** S3, CloudFront, API Gateway HTTP API, three Lambda roles, SQS, EventBridge, Bedrock, Secrets Manager, CloudWatch, AWS Budgets, CDK deployment assets, CockroachDB Basic, vector indexing, and the managed MCP inspection surface.
- **Pricing basis:** public on-demand or list prices accessed on 1 August 2026, using `us-east-1` and in-region Bedrock rates where the architecture does not specify an inference profile.
- **Expected invoice:** applies ongoing service allowances and the selected CloudFront Free flat-rate plan; it does not rely on temporary new-account credits.
- **Not included:** taxes, foreign exchange, paid AWS support, developer time or hardware, custom domains outside the CloudFront plan, CI/CD runners, extra environments, and deferred production networking.

### Baseline workload assumptions

| Driver | Baseline | Assumption |
|---|---:|---|
| Player traffic | 250 visits/month | 10–15 minutes per visit; 12 actions plus about 120 conditional player-view polls per visit |
| Sonnet dialogue | 6 calls/visit | 1,200 input and 120 output tokens per call |
| Haiku mechanics | 5 calls/visit | 600 input and 80 output tokens per call, including ambient work |
| Titan embeddings | 1,200 input tokens/visit | Query plus newly stored episode embeddings; 256 dimensions |
| Repair/retry reserve | +10% model cost | Covers bounded repair attempts and occasional retries |
| Lambda | ~77,000 invocations; ~20K GB-s | Actions, conditional views, Ambient, and Recovery every minute for outbox repair plus expired join-secret cleanup |
| Observability | 0.25 GB logs/month | Short retention; standard service metrics only |
| CockroachDB | 1.25M RU; 0.25 GiB | Directional until vector queries and migrations are benchmarked |
| Secrets | 3 secrets | Runtime database credential, judge code, and versioned application security key; migration admin is operator-held and inspection auth is CockroachDB-managed |

## 2. Cost model

### Model prices used

- Claude Sonnet 4.6 in-region: **$3.30/M input tokens** and **$16.50/M output tokens**.
- Claude Haiku 4.5 in-region: **$1.10/M input tokens** and **$5.50/M output tokens**.
- Titan Text Embeddings V2: **$0.02/M input tokens**.
- Global cross-region Claude inference is approximately 9% cheaper, but this estimate conservatively follows the specified region.

Per-call model cost is calculated as:

```text
(input tokens × input rate + output tokens × output rate) / 1,000,000
```

The visit estimates then add a 10% repair and retry reserve.

| Measure | Calculation | Result |
|---|---|---:|
| Normal visit | Sonnet dialogue + Haiku mechanics + Titan | $0.04528 |
| Reduced-cost visit | Haiku dialogue + Haiku mechanics + Titan | $0.01914 |
| Normal-to-Haiku switch | $8.00 / $0.04528 | ~177 visits |
| Tighten/stop-new-towns point | $9.50 with reduced mode after $8 | ~255 visits |
| Authored-fallback point | $10.35 with reduced mode after $8 | ~300 visits |

### Baseline monthly estimate by component

| Component | Baseline use | Before allowance | Expected invoice | Basis |
|---|---|---:|---:|---|
| Bedrock — Claude Sonnet 4.6 | Dialogue until the $8 switch | $6.93 | $6.93 | Variable; [2] |
| Bedrock — Claude Haiku 4.5 | Mechanics plus post-switch dialogue | $2.47 | $2.47 | Variable; [2] |
| Bedrock — Titan V2 | ~300K embedding tokens | $0.01 | $0.01 | Rounded up; [3] |
| Secrets Manager | 3 secrets; low API volume | $1.20 | $1.20 | Fixed floor; [10] |
| S3 + CDK assets | ~0.6 GiB plus requests | $0.02 | $0.02 | Static and deployment assets; [7] |
| CloudFront | Free plan; <1M requests and <100 GB | $0.00 | $0.00 | Plan must be selected; [4] |
| API Gateway HTTP API | ~35,000 calls | ~$0.04 | ~$0.04 | $1/M calls; [6] |
| Lambda — Game, Ambient, Recovery | ~20K GB-s; ~77K invocations | ~$0.35 | $0.00 | Within ongoing allowance; [5] |
| SQS | ~1,000 Standard requests | <$0.01 | $0.00 | First 1M free; [8] |
| EventBridge Scheduler | 43,200 invocations | ~$0.04 | $0.00 | One-minute recovery; first 14M free; [9] |
| CloudWatch | 0.25 GB logs; standard metrics | $0.13 | $0.00 | First 5 GB logs free; [11] |
| CockroachDB Basic + vector + MCP | 1.25M RU; 0.25 GiB | $0.38 | $0.00 | Monthly resource benefit; [12–13] |
| AWS Budgets | 1 monitoring budget; 3 alerts | $0.00 | $0.00 | Monitoring is free; [14] |
| **Total** | **Governed baseline** | **~$11.60** | **~$10.65** | Rounded planning total |

> **Allowance risk:** if the AWS Lambda and CloudWatch allowances are already
> consumed by other workloads and the CockroachDB organization is not eligible
> for its monthly benefit, the governed baseline rises by roughly another
> dollar. The hard model ledger remains the controlling guardrail.

## 3. Monthly scenarios

| Visits | Cost mode | Model cost | Other cost | Expected total | Interpretation |
|---:|---|---:|---:|---:|---|
| 0 | Idle deployment | $0.00 | $1.22 | $1.22 | Three secrets dominate |
| 50 | Normal Sonnet mode | $2.26 | $1.25 | ~$3.51 | Low-volume demo |
| 100 | Normal Sonnet mode | $4.53 | $1.25 | ~$5.78 | Comfortable buffer |
| 250 | Switch to Haiku after ~$8 | $9.40 | $1.25 | **~$10.65** | Planning baseline |
| 350 | Authored fallback after ~$10.35 | $10.35 cap* | $1.25+ | ~$11.60+* | Controlled mode |
| 500+ | Authored fallback after ~$10.35 | $10.35 cap* | $1.25+ | ~$11.60+* | Depends on cutoff |

\* The cap is an application control, not a real-time billing guarantee. In-flight requests, retry bursts, delayed provider metering, and non-model costs can produce small overruns.

### Sensitivity if the Sonnet switch fails

- 250 visits: approximately **$12.55** after ongoing allowances.
- 500 visits with uncapped Sonnet: approximately **$23.90**.
- 1,000 visits with uncapped Sonnet: approximately **$46.50**.

The cost-mode implementation and token ledger are therefore budget-critical, not optional optimizations.

## 4. Findings and recommendations

1. **Reserve non-model spend explicitly.** Three AWS secrets consume $1.20 before
   traffic. The accepted hard model fallback is therefore **$10.35**, leaving
   $0.95 for platform variance, CockroachDB overage, and contingency.
2. **Track the invoice dimension, not only the model name.** Record model, inference-profile scope, input tokens, output tokens, cache tokens, retries, and calculated cost in `agent_runs`; global and in-region Claude rates differ.
3. **Prefer global cross-region inference when data-routing requirements allow it.** Current global Claude rates are about 9% below in-region rates and would reduce the 250-visit Sonnet-only sensitivity by about $1.00.
4. **Select the CloudFront Free flat-rate plan deliberately.** Attach the distribution and confirm its 1M-request, 100 GB transfer, and 5 GB S3 allowances.
5. **Keep CloudWatch bounded.** Set 7–14 day log retention, avoid verbose prompt/response logging, and use standard service metrics unless a custom metric has a clear operational decision attached.
6. **Cap CockroachDB separately.** AWS Budgets cannot enforce a vendor-external CockroachDB invoice. Configure a Basic resource limit and review RU/storage usage after load tests and the first 50 real visits.
7. **Re-estimate from telemetry.** Replace every traffic and token assumption after the first production smoke test; publish actual cost per visit and the 95th-percentile token count, not only the mean.

### Recommended guardrail allocation

| Budget bucket | Monthly allocation | Purpose |
|---|---:|---|
| Bedrock model ledger | $10.35 | Hard authored-fallback threshold |
| Secrets Manager | $1.20 | Runtime database credential, judge code, and application security key |
| AWS platform reserve | $0.45 | S3, API, logging, Lambda variance, or shared allowance usage |
| CockroachDB paid overage | $0.25 | Separate vendor cap; monthly benefit should normally cover usage |
| Unallocated contingency | $0.25 | Token drift, retries, and delayed metering |
| **Total** | **$12.50** | **Operating ceiling** |

## 5. Exclusions and change triggers

The following are not present in the accepted MVP architecture and are excluded from the estimate. Adding any one of them requires a revised cost model.

- VPC, NAT Gateway, PrivateLink, or other private networking; the current design intentionally uses public CockroachDB access with TLS.
- Provisioned concurrency, provisioned Bedrock throughput, always-on containers, ECS, EKS, EC2, or a separate vector database.
- Multiple persistent environments, CI/CD runners, artifact retention beyond small CDK assets, or load-testing traffic.
- A custom domain or DNS setup not covered by the selected CloudFront flat-rate plan.
- Paid AWS Support, third-party observability, taxes, currency conversion, developer hardware, and engineering labor.
- Production-grade private networking and higher data-sensitivity controls, which the architecture explicitly defers.

## 6. Sources

Prices are public list prices and allowances accessed on 1 August 2026. They can change, may vary by account agreement, and are not a vendor quote. Repository scope comes from the local architecture documents.

1. [Repository README](../README.md), [Decision 002](002-mvp-system-architecture.md), [runtime architecture](003-technical-architecture-and-schema.md), [schema contract](005-logical-data-model-and-schema-contract.md), and [HTTP API contract](006-http-api-contract.md) — services, region, models, traffic, data responsibilities, and the $12.50 ceiling.
2. [Anthropic model prices — all platforms](https://www-cdn.anthropic.com/files/4zrzovbb/website/3684c2faafb97418665782cea0001f439f74b1d2.pdf) — AWS Bedrock global and in-region rates for Claude Sonnet 4.6 and Haiku 4.5.
3. [AWS Titan Text Embeddings V2](https://aws.amazon.com/blogs/machine-learning/get-started-with-amazon-titan-text-embeddings-v2-a-new-state-of-the-art-embeddings-model-on-amazon-bedrock/) — $0.02 per million input tokens and 256-dimension support.
4. [Amazon CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) — Free flat-rate plan allowances.
5. [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) — request and compute rates plus monthly allowance.
6. [Amazon API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) — HTTP API request pricing.
7. [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) — S3 Standard storage and request pricing.
8. [Amazon SQS pricing](https://aws.amazon.com/sqs/pricing/) — Standard queue request pricing and monthly allowance.
9. [Amazon EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/) — Scheduler invocation pricing and monthly allowance.
10. [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) — secret-month and API-call pricing.
11. [Amazon CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) — Logs ingestion and monthly allowance.
12. [CockroachDB pricing](https://www.cockroachlabs.com/pricing/) — Basic resource benefit, vector integration, and MCP availability.
13. [CockroachDB Basic planning](https://www.cockroachlabs.com/docs/cockroachcloud/plan-your-cluster-basic) — RU and storage pricing beyond the monthly benefit.
14. [AWS Budgets FAQ](https://aws.amazon.com/aws-cost-management/aws-budgets/faqs/) — free monitoring budgets and alert thresholds.

## Decision summary

Proceed with the architecture for the MVP and treat **$10.35 as the hard
model-cost fallback** until measured operating data proves that a higher limit
still leaves enough room for three secrets, platform variance, and CockroachDB
overage.
