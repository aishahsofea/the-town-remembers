# Phase 3 local latency baseline

- **Project:** The Town Remembers
- **Status:** Accepted
- **Date:** 2026-08-12
- **Scope:** p50/p95/p99 latency for the four route shapes Phase 3 actually
  serves, measured locally (`P3-18` acceptance 4), and what these numbers do
  and do not tell us.

## The numbers

Measured against a local, single-node CockroachDB instance (`pnpm db:up`),
calling `packages/game-server/src/http/router.ts#routeRequest` directly —
no HTTP/TLS layer, no network hop, no cold start, one machine with nothing
else contending for it. 50 samples per route (30 for join, since each
consumes a fresh invite-token join slot), each one full serializable
transaction against real tables in a freshly seeded town.

| Route | p50 | p95 | p99 |
|---|---|---|---|
| `GET /health` | <1 ms | <1 ms | 9 ms |
| `POST /invites/{token}/join` | 96 ms | 110 ms | 112 ms |
| `GET /player-view` | 33 ms | 43 ms | 51 ms |
| `POST /towns/{townId}/actions` (`travel`) | 47 ms | 58 ms | 145 ms |

`join`'s cost sits mostly in `bootstrapStartVisit` (`persistence/players.ts`):
one first-time player join writes the actor, player, session, every NPC
relationship row, and the synthetic bootstrap `start_visit` action/visit/
event, all in one transaction — by far the heaviest single write path in
Phase 3, which is exactly why its own p50 is roughly triple `player-view`'s
and `actions`'s.

## What Phase 7 must do differently

These numbers are a **local development-machine baseline**, not a
production SLO and not a capacity plan. Three things are true here that will
not be true once this deploys (Phase 7):

1. **No network hop.** `routeRequest` is called in-process against a local
   database on the same machine. A deployed API Gateway → Lambda → RDS/
   CockroachDB Cloud path adds real network latency this baseline cannot see.
2. **No cold start.** Every sample here runs against an already-initialized
   process and an already-warm connection pool. Lambda cold starts (or
   whatever Phase 7's actual compute model turns out to be) are not
   represented at all.
3. **No concurrent load.** Every sample above ran alone, serially. None of
   these numbers say anything about tail latency under concurrent
   `travel`/`inspect` submissions from many players in the same town, which
   is exactly the scenario `P3-09`'s town-revision retry budget exists for.

**Phase 7 must re-measure p50/p95/p99 against the actual deployed stack**,
under realistic concurrency, before this baseline is used for anything but
"did we regress in local development." `packages/game-server/src/observability/metrics.ts`'s
`recordHttpLatency`/`recordActionProcessing` already emit exactly the two
numbers (`latencyMs`, `ageMs`) this table is built from — Phase 7's job is to
point a real metrics backend at that same emission, not to build a new one.
