# Observability and access-logging checklist

- **Project:** The Town Remembers
- **Status:** Accepted
- **Date:** 2026-08-12
- **Scope:** What Phase 7 (cloud deployment) must and must not turn on for
  CloudFront, S3, and API Gateway access logging, and why. Recorded now
  (`P3-17` acceptance 9) so the constraint exists before there is any real
  infrastructure to misconfigure, rather than being discovered as a gap
  during a Phase 7 security review.

## The constraint

Application-level structured logging (`packages/game-server/src/observability/events.ts`,
`apps/game-api/src/observability/log.ts`) is the only logging layer in this
system that is verified redaction-safe: every event type is a closed union
whose field names are checked against `FORBIDDEN_LOG_PROPERTIES`
(`packages/test-support/src/redaction.ts`), and every request's headers are
filtered through `HEADER_ALLOWLIST` (`packages/game-server/src/http/request.ts`)
before a route handler — the one place `logEvent` is called from — ever sees
them. `packages/game-server/src/security/log-redaction.test.ts` and
`apps/game-api/src/local-server.test.ts` enforce this continuously.

**Raw transport-level access logs have no such filter.** A CloudFront or S3
access log line is the untouched request line and headers the edge actually
received — cookies, `Authorization`, the full query string, the full request
body is never in an access log, but the URL and headers are. Turning either
on would put session tokens, judge codes, and invite tokens into a log
storage tier this codebase's redaction tests do not reach and cannot verify.
API Gateway's own default access-log format carries the same risk if left at
its default (which includes the full request path with query string).

## The checklist, for whoever builds the Phase 7 CDK stack

1. **CloudFront distribution access logging: stays disabled.** Do not set
   `logBucket`/`logFilePrefix` (CDK: leave `Distribution`'s logging config
   unset). If a future phase genuinely needs edge-level traffic analytics,
   that is a new decision with its own redaction review — not a default to
   flip on.
2. **S3 bucket access logging: stays disabled.** Do not set
   `serverAccessLogsBucket` on any bucket serving the web build or backing
   CloudFront. Same reasoning as above — an S3 access log line carries the
   full request URI.
3. **API Gateway access logs: enabled, but with an explicit, narrow format.**
   Unlike CloudFront/S3, API Gateway access logs are useful for latency and
   error-rate operations work and are worth keeping — but only with a format
   string that names exactly four fields, all of them already safe by
   construction elsewhere in this codebase:
   - the request ID (`$context.requestId`, the same identifier
     `apps/game-api`'s own `logEvent` calls already carry as `requestId`)
   - the route template it matched (not the raw resolved path — the closed
     `RouteTemplate` union `routes.ts` already exports, matching
     `routeTemplate` in `HttpRequestLogEvent`)
   - the response status (`$context.status`)
   - the latency (`$context.responseLatency` or equivalent)

   Do **not** add `$context.path`, `$context.querystring`, `$context.identity.*`,
   or any header/cookie/body accessor to the format string — that is exactly
   the class of field `FORBIDDEN_LOG_PROPERTIES` exists to keep out of
   application-level logs, and API Gateway's own access log has no
   equivalent enforcement, so the format string itself is the only gate.
4. Whoever writes Phase 7's own execution-detail plan should copy this
   checklist's four items into that plan's acceptance criteria verbatim, so
   the CDK stack change that wires up API Gateway access logging is itself
   reviewed against this list — this document is normative, not merely
   informational.

## Why API Gateway is treated differently from CloudFront and S3

CloudFront and S3 sit in front of the static web bundle and have no reason to
carry a session token or invite token in a request line worth keeping —
nothing about serving `index.html` or a JS bundle needs per-request
diagnostics that granular. API Gateway sits in front of the actual game API,
where operational visibility (which route is slow, which route is erroring)
is genuinely useful for running the service — the request-ID/route-template/
status/latency tuple gives that, without ever writing a cookie, header, or
query value to a log store this codebase's redaction tests cannot see.
